import { randomUUID } from 'crypto';
import { getPool } from '../storage/pg-pool.ts';
import { TemplateMatcher }  from './template-matcher.ts';
import { TemplatePopulator } from './template-populator.ts';
import { MacroExpander }    from './macro-expander.ts';
import type { ParsedEmail, AgentResponse, EmailTemplate } from '../types/index.ts';

export class TemplateEngine {
  private matcher:   TemplateMatcher;
  private populator: TemplatePopulator;
  private macros:    MacroExpander;

  constructor(llm?: { complete(p: string): Promise<string> }) {
    this.matcher   = new TemplateMatcher();
    this.populator = new TemplatePopulator(llm);
    this.macros    = new MacroExpander();
  }

  async tryApply(email: ParsedEmail, analysis: AgentResponse): Promise<string | null> {
    const template = await this.matcher.findBest(email, analysis);
    if (!template) return null;
    const { body, missingRequired } = await this.populator.populate(template, email);
    if (missingRequired.length) return null;
    await this.recordUsage(template.id);
    return body;
  }

  async expandMacros(text: string, userId: string, accountId?: string): Promise<string> {
    return this.macros.expand(text, userId, accountId);
  }

  async createTemplate(data: Omit<EmailTemplate, 'id' | 'stats'>): Promise<string> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO email_templates
         (id, user_id, account_id, name, description, body_template, tone)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        data.userId,
        data.accountId ?? null,
        data.name,
        data.description ?? null,
        data.content.bodyTemplate,
        data.content.tone,
      ]
    );
    return id;
  }

  private async recordUsage(templateId: string): Promise<void> {
    await getPool().query(
      `UPDATE email_templates SET times_used = times_used + 1 WHERE id = $1`,
      [templateId]
    );
  }
}
