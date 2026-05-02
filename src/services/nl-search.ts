/**
 * Natural Language Search — convert a query to SQL and search email_log.
 */

import { getPool } from '../storage/pg-pool.ts';
import type { LLMConfig } from '../types/index.ts';

// ── Semantic pattern table ────────────────────────────────────────────────────
// Maps regex patterns → direct SQL WHERE clauses (no LLM needed).
// Checked before keyword search. First match wins.
const SEMANTIC_PATTERNS: Array<{
  pattern: RegExp;
  where: string;
  params: (match: RegExpMatchArray) => unknown[];
}> = [
  // Unanswered / pending / no reply
  {
    pattern: /\b(unanswer|no.?repl|بی.?پاسخ|پاسخ.?ندا|بی.?جواب|pending|نخواند|unread|waiting|منتظر)\b/i,
    where: 'user_action IS NULL',
    params: () => [],
  },
  // Ignored / dismissed / rejected
  {
    pattern: /\b(ignor|dismiss|رد.?شد|نادید|reject)\b/i,
    where: "user_action IN ('ignored','rejected')",
    params: () => [],
  },
  // Approved / replied / sent
  {
    pattern: /\b(approv|replied|sent|ارسال.?شد|پاسخ.?داد|answer)\b/i,
    where: "user_action = 'approved'",
    params: () => [],
  },
  // Critical priority
  {
    pattern: /\b(critical|بحران|فوری.?ترین|خیلی.?مهم|acil|urgent)\b/i,
    where: "priority = 'critical'",
    params: () => [],
  },
  // High priority (important)
  {
    pattern: /\b(high.?prior|important|مهم(?!.?ترین)|اولویت.?بالا|اولویت)\b/i,
    where: "priority IN ('critical','high')",
    params: () => [],
  },
  // Action required
  {
    pattern: /\b(action.?required|نیاز.?به.?اقدام|باید.?انجام|todo|to.do)\b/i,
    where: "intent = 'action_required' OR priority IN ('critical','high')",
    params: () => [],
  },
  // Newsletters / marketing / subscriptions
  {
    pattern: /\b(newsletter|subscri|خبرنامه|تبلیغ|بازاریاب|marketing|spam|اشتراک)\b/i,
    where: "intent IN ('newsletter','marketing')",
    params: () => [],
  },
  // Invoice / payment / financial
  {
    pattern: /\b(invoice|payment|فاکتور|پرداخت|صورت.?حساب|billing|مالی|حساب)\b/i,
    where: "intent IN ('payment','invoice') OR LOWER(subject) LIKE '%invoice%' OR LOWER(subject) LIKE '%payment%' OR LOWER(summary) LIKE '%invoice%' OR LOWER(summary) LIKE '%فاکتور%'",
    params: () => [],
  },
  // Meeting requests / scheduling
  {
    pattern: /\b(meeting|schedule|جلسه|قرار.?ملاقات|وقت.?ملاقات|calendar|appointment)\b/i,
    where: "intent = 'meeting_request' OR LOWER(subject) LIKE '%meeting%' OR LOWER(subject) LIKE '%جلسه%'",
    params: () => [],
  },
  // Support / complaints / tickets
  {
    pattern: /\b(support|complaint|ticket|شکایت|پشتیبانی|help.?desk|problem|مشکل)\b/i,
    where: "intent IN ('complaint','support','action_required')",
    params: () => [],
  },
  // Security alerts
  {
    pattern: /\b(security|alert|hack|breach|امنیت|هشدار|خطر)\b/i,
    where: "priority = 'critical' OR LOWER(subject) LIKE '%security%' OR LOWER(subject) LIKE '%alert%'",
    params: () => [],
  },
  // AWS / cloud / infrastructure
  {
    pattern: /\b(aws|azure|cloud|gcp|server|infrastructure|billing.?alert)\b/i,
    where: "LOWER(from_address) LIKE '%aws%' OR LOWER(from_address) LIKE '%amazon%' OR LOWER(subject) LIKE '%aws%' OR LOWER(subject) LIKE '%cloud%'",
    params: () => [],
  },
  // From a specific sender (English name or domain)
  {
    pattern: /\bfrom\s+([A-Za-z0-9][\w.\-]{1,40}?)(?:\s|$)/i,
    where: 'LOWER(from_address) LIKE $2 OR LOWER(sender_name) LIKE $2',
    params: (m) => [`%${m[1].trim().toLowerCase()}%`],
  },
  // از فرستنده فارسی
  {
    pattern: /از\s+([؀-ۿ\w]{2,30}?)(?:\s|$)/,
    where: 'LOWER(sender_name) LIKE $2 OR LOWER(from_address) LIKE $2',
    params: (m) => [`%${m[1].trim().toLowerCase()}%`],
  },
];

export class NLSearch {
  constructor(private llmConfig: LLMConfig) {}

  async search(accountId: string, query: string, limit = 20): Promise<any[]> {
    // 1. Semantic pattern match (fast, no LLM)
    const semanticRows = await this.semanticSearch(accountId, query, limit);
    if (semanticRows !== null) return semanticRows;

    // 2. Generic "all / recent / everything" → return recent emails
    if (this.isGenericQuery(query)) {
      return this.recentEmails(accountId, limit);
    }

    // 3. Keyword search
    const keywordRows = await this.keywordSearch(accountId, query, limit);
    if (keywordRows.length > 0) return keywordRows;

    // 4. LLM-parsed structured filters
    const llmRows = await this.llmSearch(accountId, query, limit);
    if (llmRows.length > 0) return llmRows;

    // 5. Final fallback for vague queries
    const cleanTerms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (cleanTerms.length <= 1) {
      return this.recentEmails(accountId, limit);
    }
    return [];
  }

  // ── Semantic pattern search ───────────────────────────────────────────────

  private async semanticSearch(accountId: string, query: string, limit: number): Promise<any[] | null> {
    for (const rule of SEMANTIC_PATTERNS) {
      const m = query.match(rule.pattern);
      if (!m) continue;

      const extraParams = rule.params(m);
      const params: unknown[] = [accountId, ...extraParams];
      // Shift $N placeholders if there are extra params
      const whereClause = extraParams.length
        ? rule.where  // already has $2, $3… placeholders
        : rule.where;

      try {
        const { rows } = await getPool().query(
          `SELECT id, from_address, sender_name, subject, priority, intent, summary,
                  received_at, user_action, labels
           FROM email_log
           WHERE account_id = $1 AND (${whereClause})
           ORDER BY received_at DESC LIMIT ${limit}`,
          params
        );
        return rows;
      } catch {
        return null;
      }
    }
    return null; // no pattern matched
  }

  // ── Generic query detection ───────────────────────────────────────────────

  private isGenericQuery(query: string): boolean {
    const GENERIC = /^(all|every|everything|recent|last|latest|newest|inbox|all emails|my emails|the emails|همه|ایمیل‌?ها|آخرین|اخیر|خلاصه)\s*(emails?|mail|inbox|ایمیل‌?ها?)?\s*$/i;
    return GENERIC.test(query.trim()) || query.trim().length < 5;
  }

  // ── Keyword search ────────────────────────────────────────────────────────

  private async keywordSearch(accountId: string, query: string, limit: number): Promise<any[]> {
    const STOP_WORDS = new Set([
      'the','a','an','and','or','in','on','at','to','for','of','with',
      'from','by','is','are','was','were','be','been','have','has','had','do','does','did',
      'all','any','can','will','this','that','these','those','my','your','their','its',
      'what','which','who','چه','که','این','آن','را','با','از','در','به','است',
    ]);

    const terms = query.toLowerCase().split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    if (!terms.length) return [];

    const perTermOr = (idx: number) => `(
      LOWER(subject) LIKE $${idx + 2} OR
      LOWER(from_address) LIKE $${idx + 2} OR
      LOWER(sender_name) LIKE $${idx + 2} OR
      LOWER(summary) LIKE $${idx + 2} OR
      LOWER(intent) LIKE $${idx + 2}
    )`;

    // Strict AND first
    const strictWhere = terms.map((_, i) => perTermOr(i)).join(' AND ');
    const { rows: strictRows } = await getPool().query(
      `SELECT id, from_address, sender_name, subject, priority, intent, summary,
              received_at, user_action, labels
       FROM email_log
       WHERE account_id = $1 AND ${strictWhere}
       ORDER BY received_at DESC LIMIT ${limit}`,
      [accountId, ...terms.map((t) => `%${t}%`)]
    );
    if (strictRows.length > 0) return strictRows;

    // Loose OR fallback
    const looseWhere = terms.map((_, i) => perTermOr(i)).join(' OR ');
    const { rows: looseRows } = await getPool().query(
      `SELECT id, from_address, sender_name, subject, priority, intent, summary,
              received_at, user_action, labels
       FROM email_log
       WHERE account_id = $1 AND (${looseWhere})
       ORDER BY received_at DESC LIMIT ${limit}`,
      [accountId, ...terms.map((t) => `%${t}%`)]
    );
    return looseRows;
  }

  // ── LLM structured search ─────────────────────────────────────────────────

  private async llmSearch(accountId: string, query: string, limit: number): Promise<any[]> {
    const { LLMRouter } = await import('../llm/router.ts');
    const llm = new LLMRouter(this.llmConfig);

    const prompt = `Convert this email search query into structured filters.

Query: "${query}"

Return JSON only:
{
  "priority": "critical|high|medium|low|null",
  "intent": "action_required|complaint|payment|meeting_request|newsletter|marketing|null",
  "senderContains": "string or null",
  "subjectContains": "string or null",
  "summaryContains": "string or null",
  "userAction": "ignored|approved|rejected|unanswered|null"
}
Use "unanswered" when the query asks for emails with no reply/action yet.
Return null for fields not clearly implied by the query.`;

    try {
      const raw  = await llm.complete(prompt, { maxTokens: 200, temperature: 0.1 });
      const m    = raw.match(/\{[\s\S]*\}/);
      const f: any = m ? JSON.parse(m[0]) : {};

      const wheres: string[] = ['account_id = $1'];
      const params: unknown[] = [accountId];
      let p = 2;

      if (f.priority && f.priority !== 'null') {
        wheres.push(`priority = $${p++}`); params.push(f.priority);
      }
      if (f.intent && f.intent !== 'null') {
        wheres.push(`intent = $${p++}`); params.push(f.intent);
      }
      if (f.senderContains) {
        wheres.push(`LOWER(from_address) LIKE $${p++}`);
        params.push(`%${f.senderContains.toLowerCase()}%`);
      }
      if (f.subjectContains) {
        wheres.push(`LOWER(subject) LIKE $${p++}`);
        params.push(`%${f.subjectContains.toLowerCase()}%`);
      }
      if (f.summaryContains) {
        wheres.push(`LOWER(summary) LIKE $${p++}`);
        params.push(`%${f.summaryContains.toLowerCase()}%`);
      }
      if (f.userAction === 'unanswered') {
        wheres.push('user_action IS NULL');
      } else if (f.userAction && f.userAction !== 'null') {
        wheres.push(`user_action = $${p++}`); params.push(f.userAction);
      }

      const { rows } = await getPool().query(
        `SELECT id, from_address, sender_name, subject, priority, intent, summary,
                received_at, user_action, labels
         FROM email_log WHERE ${wheres.join(' AND ')}
         ORDER BY received_at DESC LIMIT ${limit}`,
        params
      );
      return rows;
    } catch {
      return [];
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async recentEmails(accountId: string, limit: number): Promise<any[]> {
    const { rows } = await getPool().query(
      `SELECT id, from_address, sender_name, subject, priority, intent, summary,
              received_at, user_action, labels
       FROM email_log WHERE account_id = $1
       ORDER BY received_at DESC LIMIT $2`,
      [accountId, limit]
    );
    return rows;
  }
}
