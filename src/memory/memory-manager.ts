/**
 * Memory Manager — persistent agent memory across email sessions.
 * Stores three types:
 *   semantic   — facts about senders, relationships, preferences
 *   episodic   — what happened in past interactions
 *   procedural — how the user handles specific scenarios (learned from edits)
 */

import { getPool } from '../storage/pg-pool.ts';
import { logger }  from '../utils/logger.ts';
import type { LLMConfig } from '../types/index.ts';

export interface Memory {
  id:        string;
  accountId: string;
  type:      'semantic' | 'episodic' | 'procedural';
  content:   string;
  sourceId?: string;
  importance: number;
  createdAt: Date;
}

export class MemoryManager {
  constructor(private llmConfig?: LLMConfig) {}

  // Pull recent memories relevant to a sender / subject
  async retrieve(accountId: string, context: { sender?: string; subject?: string; intent?: string }, limit = 10): Promise<Memory[]> {
    try {
      const { rows } = await getPool().query(
        `SELECT * FROM memories WHERE account_id = $1
         ORDER BY importance DESC, created_at DESC LIMIT $2`,
        [accountId, limit]
      );
      // Simple relevance filter: sender name or intent appears in content
      const keywords = [context.sender, context.intent, context.subject]
        .filter(Boolean).map(s => s!.toLowerCase().split(/\s+|@/)[0]);

      return rows
        .filter((r: any) => !keywords.length || keywords.some(k => r.content.toLowerCase().includes(k)))
        .slice(0, 6)
        .map(this.mapRow);
    } catch {
      return [];
    }
  }

  // Extract and store memories from a processed email
  async extractAndStore(accountId: string, emailId: string, email: {
    sender: string; subject: string; body: string; intent: string;
  }, agentResponse: { summary: string; suggestedReplies: any[] }): Promise<void> {
    if (!this.llmConfig) return;
    try {
      const { LLMRouter } = await import('../llm/router.ts');
      const llm = new LLMRouter(this.llmConfig);

      const prompt = `Extract concise memories from this email interaction.

Email from: ${email.sender}
Subject: ${email.subject}
Intent: ${email.intent}
Summary: ${agentResponse.summary}

Return JSON:
{
  "semantic": ["fact about sender or relationship, e.g. 'Ali Rezaei is from company.ir and handles contracts'"],
  "episodic": ["what happened, e.g. 'Received contract signing request from Ali on May 2, deadline Friday'"],
  "procedural": []
}
Only include entries that are genuinely useful for future context. Max 2 items per type. Return {} if nothing meaningful.`;

      const raw = await llm.complete(prompt, { maxTokens: 300, temperature: 0.2 });
      let parsed: Record<string, string[]> = {};
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : {};
      } catch { return; }

      const entries: Array<{ type: string; content: string; importance: number }> = [];
      for (const [type, items] of Object.entries(parsed)) {
        if (!Array.isArray(items)) continue;
        for (const content of items) {
          if (typeof content === 'string' && content.trim().length > 10) {
            entries.push({ type, content: content.trim(), importance: type === 'semantic' ? 0.8 : 0.6 });
          }
        }
      }

      if (!entries.length) return;

      const pool = getPool();
      for (const e of entries) {
        // Avoid near-duplicates — skip if very similar content exists
        const { rows } = await pool.query(
          `SELECT 1 FROM memories WHERE account_id = $1 AND type = $2
           AND content ILIKE $3 LIMIT 1`,
          [accountId, e.type, `%${e.content.substring(0, 40)}%`]
        );
        if (rows.length) continue;

        await pool.query(
          `INSERT INTO memories (account_id, type, content, source_id, importance)
           VALUES ($1, $2, $3, $4, $5)`,
          [accountId, e.type, e.content, emailId, e.importance]
        );
      }
      logger.debug('Memories stored', { accountId, count: entries.length });
    } catch (err) {
      logger.debug('Memory extraction failed', { err });
    }
  }

  // Called when user edits a reply — learn from the difference
  async learnFromEdit(accountId: string, emailId: string, originalReply: string, editedReply: string): Promise<void> {
    if (!originalReply || !editedReply || originalReply === editedReply) return;
    try {
      // Store a procedural memory about what the user changed
      const pool = getPool();
      const content = `User edited reply: changed "${originalReply.substring(0, 80)}..." to "${editedReply.substring(0, 80)}..."`;
      await pool.query(
        `INSERT INTO memories (account_id, type, content, source_id, importance)
         VALUES ($1, 'procedural', $2, $3, 0.9)`,
        [accountId, content, emailId]
      );

      // Also extract a style preference if LLM available
      if (this.llmConfig && editedReply.length > 50) {
        const { LLMRouter } = await import('../llm/router.ts');
        const llm = new LLMRouter(this.llmConfig);
        const prompt = `A user edited an AI-generated email reply.

Original: "${originalReply.substring(0, 300)}"
Edited to: "${editedReply.substring(0, 300)}"

In one sentence, what writing preference or style rule can be learned from this edit?
Reply with just the rule, e.g. "User prefers shorter replies without formal closings."`;

        const rule = (await llm.complete(prompt, { maxTokens: 100, temperature: 0.3 })).trim();
        if (rule.length > 10 && rule.length < 200) {
          await pool.query(
            `INSERT INTO memories (account_id, type, content, source_id, importance)
             VALUES ($1, 'procedural', $2, $3, 0.95)
             ON CONFLICT DO NOTHING`,
            [accountId, rule, emailId]
          );
        }
      }
      logger.info('Learned from user edit', { accountId, emailId });
    } catch (err) {
      logger.debug('learnFromEdit failed', { err });
    }
  }

  formatForPrompt(memories: Memory[]): string {
    if (!memories.length) return '';
    const groups: Record<string, string[]> = {};
    for (const m of memories) {
      (groups[m.type] ||= []).push(`- ${m.content}`);
    }
    const lines = ['## Memory (past context)'];
    if (groups.semantic)   lines.push(`**Known facts:**\n${groups.semantic.join('\n')}`);
    if (groups.episodic)   lines.push(`**Past interactions:**\n${groups.episodic.join('\n')}`);
    if (groups.procedural) lines.push(`**User writing preferences (learned from edits):**\n${groups.procedural.join('\n')}`);
    return lines.join('\n\n');
  }

  private mapRow(r: any): Memory {
    return {
      id: r.id, accountId: r.account_id, type: r.type,
      content: r.content, sourceId: r.source_id,
      importance: parseFloat(r.importance), createdAt: new Date(r.created_at),
    };
  }
}
