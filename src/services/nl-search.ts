/**
 * Natural Language Search — convert a query to SQL and search email_log.
 */

import { getPool } from '../storage/pg-pool.ts';
import type { LLMConfig } from '../types/index.ts';

export class NLSearch {
  constructor(private llmConfig: LLMConfig) {}

  async search(accountId: string, query: string, limit = 20): Promise<any[]> {
    // Keyword search first; fall back to LLM-parsed filters only when nothing found
    const keywordResults = await this.keywordSearch(accountId, query, limit);
    if (keywordResults.length > 0) return keywordResults;

    // Zero keyword results → try LLM-structured filters
    return this.llmSearch(accountId, query, limit);
  }

  private async keywordSearch(accountId: string, query: string, limit: number): Promise<any[]> {
    const STOP_WORDS = new Set(['the','a','an','and','or','in','on','at','to','for','of','with',
      'from','by','is','are','was','were','be','been','have','has','had','do','does','did',
      'all','any','can','will','this','that','these','those','my','your','their','its']);

    const terms = query.toLowerCase().split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    if (!terms.length) return [];

    // Each term is an OR across fields; terms are ANDed together unless there's only one
    // Use OR between terms to maximise recall, then sort by number of matches
    const perTermOr = (idx: number) => `(
      LOWER(subject) LIKE $${idx + 2} OR
      LOWER(from_address) LIKE $${idx + 2} OR
      LOWER(sender_name) LIKE $${idx + 2} OR
      LOWER(summary) LIKE $${idx + 2} OR
      LOWER(intent) LIKE $${idx + 2}
    )`;

    // For multiple terms: try AND first (strict), fall back to OR (loose)
    const strictWhere = terms.map((_, i) => perTermOr(i)).join(' AND ');
    const { rows: strictRows } = await getPool().query(
      `SELECT id, from_address, sender_name, subject, priority, intent, summary,
              received_at, user_action, labels
       FROM email_log
       WHERE account_id = $1 AND ${strictWhere}
       ORDER BY received_at DESC LIMIT ${limit}`,
      [accountId, ...terms.map(t => `%${t}%`)]
    );
    if (strictRows.length > 0) return strictRows;

    // Loose OR fallback — any term matches
    const looseWhere = terms.map((_, i) => perTermOr(i)).join(' OR ');
    const { rows: looseRows } = await getPool().query(
      `SELECT id, from_address, sender_name, subject, priority, intent, summary,
              received_at, user_action, labels
       FROM email_log
       WHERE account_id = $1 AND (${looseWhere})
       ORDER BY received_at DESC LIMIT ${limit}`,
      [accountId, ...terms.map(t => `%${t}%`)]
    );
    return looseRows;
  }

  private async llmSearch(accountId: string, query: string, limit: number): Promise<any[]> {
    const { LLMRouter } = await import('../llm/router.ts');
    const llm = new LLMRouter(this.llmConfig);

    const prompt = `Convert this email search query into structured filters.

Query: "${query}"

Return JSON:
{
  "priority": "critical|high|medium|low|null",
  "intent": "action_required|complaint|payment|meeting_request|newsletter|marketing|null",
  "senderContains": "string or null",
  "subjectContains": "string or null",
  "summaryContains": "string or null",
  "userAction": "ignored|sent_as_is|null"
}
Only include filters that are clearly implied by the query. Return null for unknown fields.`;

    try {
      const raw  = await llm.complete(prompt, { maxTokens: 200, temperature: 0.1 });
      const m    = raw.match(/\{[\s\S]*\}/);
      const f: any = m ? JSON.parse(m[0]) : {};

      const wheres: string[] = ['account_id = $1'];
      const params: any[]    = [accountId];
      let   p = 2;

      if (f.priority)       { wheres.push(`priority = $${p++}`);               params.push(f.priority); }
      if (f.intent)         { wheres.push(`intent = $${p++}`);                 params.push(f.intent); }
      if (f.senderContains) { wheres.push(`LOWER(from_address) LIKE $${p++}`); params.push(`%${f.senderContains.toLowerCase()}%`); }
      if (f.subjectContains){ wheres.push(`LOWER(subject) LIKE $${p++}`);      params.push(`%${f.subjectContains.toLowerCase()}%`); }
      if (f.summaryContains){ wheres.push(`LOWER(summary) LIKE $${p++}`);      params.push(`%${f.summaryContains.toLowerCase()}%`); }
      if (f.userAction)     { wheres.push(`user_action = $${p++}`);            params.push(f.userAction); }

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
}
