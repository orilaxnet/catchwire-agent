import { getPool } from '../storage/pg-pool.ts';
import type { ParsedEmail, AgentResponse, EmailTemplate } from '../types/index.ts';

export class TemplateMatcher {
  async findBest(email: ParsedEmail, analysis: AgentResponse): Promise<EmailTemplate | null> {
    const { rows } = await getPool().query(
      `SELECT * FROM email_templates
       WHERE (account_id = $1 OR account_id IS NULL)
       ORDER BY account_id DESC NULLS LAST, times_used DESC`,
      [email.accountId]
    );

    const scored = rows
      .map((r) => ({ template: this.deserialize(r), score: this.score(email, analysis, r) }))
      .filter((x) => x.score > 0.3)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.template ?? null;
  }

  private score(email: ParsedEmail, analysis: AgentResponse, row: any): number {
    let s = 0;

    if (row.trigger_intents) {
      const intents: string[] = Array.isArray(row.trigger_intents) ? row.trigger_intents : JSON.parse(row.trigger_intents);
      if (intents.includes(analysis.intent)) s += 0.5;
    }

    if (row.trigger_keywords) {
      const kws: string[] = Array.isArray(row.trigger_keywords) ? row.trigger_keywords : JSON.parse(row.trigger_keywords);
      const bodyLower     = email.bodyText.toLowerCase();
      const matched       = kws.filter((k) => bodyLower.includes(k.toLowerCase())).length;
      if (kws.length) s += 0.3 * (matched / kws.length);
    }

    if (row.trigger_domain) {
      const domain = email.originalSender.split('@')[1] ?? '';
      if (domain === row.trigger_domain) s += 0.1;
    }

    if (row.trigger_subject && email.subject.toLowerCase().includes(row.trigger_subject.toLowerCase())) {
      s += 0.1;
    }

    return s;
  }

  private deserialize(row: any): EmailTemplate {
    const parseJson = (v: any) => Array.isArray(v) ? v : v ? JSON.parse(v) : undefined;
    return {
      id:          row.id,
      userId:      row.user_id,
      accountId:   row.account_id ?? undefined,
      name:        row.name,
      description: row.description ?? undefined,
      trigger: {
        intentMatch:     parseJson(row.trigger_intents),
        keywordMatch:    parseJson(row.trigger_keywords),
        senderDomain:    row.trigger_domain   ?? undefined,
        subjectContains: row.trigger_subject  ?? undefined,
      },
      content: {
        subjectTemplate: row.subject_template ?? undefined,
        bodyTemplate:    row.body_template,
        tone:            row.tone     as any,
        language:        row.language as any,
      },
      variables: parseJson(row.variables) ?? [],
      stats: {
        timesUsed:      row.times_used,
        acceptanceRate: row.acceptance_rate,
        lastUsedAt:     row.last_used_at ? new Date(row.last_used_at) : undefined,
      },
    };
  }
}
