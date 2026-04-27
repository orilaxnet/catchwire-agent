import type { EmailThread, LLMConfig } from '../types/index.ts';
import { logger } from '../utils/logger.ts';

const MAX_MESSAGES = 10;

export class SlidingWindow {
  constructor(private llmConfig?: LLMConfig) {}

  /**
   * Builds a context string for the Prompt Engine.
   * Short threads (≤10 messages): include all in full.
   * Long threads: LLM-generated summary of older messages + last 10 in full.
   */
  async build(thread: EmailThread): Promise<string> {
    if (thread.messageCount <= MAX_MESSAGES) {
      return this.formatFull(thread);
    }
    return this.formatSliding(thread);
  }

  /** Synchronous version — uses existing summary, skips LLM call */
  buildSync(thread: EmailThread): string {
    return thread.messageCount <= MAX_MESSAGES
      ? this.formatFull(thread)
      : this.formatSlidingSync(thread);
  }

  async summarizeOlderMessages(thread: EmailThread): Promise<string> {
    const older = thread.messages.slice(0, -MAX_MESSAGES);
    if (!older.length) return '';

    if (!this.llmConfig) {
      return `${older.length} older messages (summarization skipped — no LLM config)`;
    }

    const excerpt = older
      .map((m) => `[${m.from}]: ${(m.body || '').slice(0, 300)}`)
      .join('\n');

    const prompt = `Summarize the following email conversation in 3-5 concise sentences.
Focus on key decisions, commitments, deadlines, and unresolved issues.
Do NOT include greetings or closings.

Conversation:
${excerpt}

Summary:`;

    try {
      const { LLMRouter } = await import('../llm/router.ts');
      const llm     = new LLMRouter(this.llmConfig);
      const summary = await llm.complete(prompt, { maxTokens: 200, temperature: 0.2 });
      logger.debug('Thread summarized by LLM', { threadId: thread.id, messages: older.length });
      return summary.trim();
    } catch (err) {
      logger.warn('Thread summarization failed, using truncation', { err });
      return `${older.length} earlier messages — key context: ${older
        .map((m) => `${m.from}: ${(m.body || '').slice(0, 80)}`)
        .join(' | ')
        .slice(0, 500)}`;
    }
  }

  private formatFull(thread: EmailThread): string {
    const msgs = thread.messages
      .map((m) => `[${m.from}]: ${m.body || '(no body stored)'}`)
      .join('\n');

    return `## Conversation History (${thread.messageCount} messages)\n${msgs}`;
  }

  private async formatSliding(thread: EmailThread): Promise<string> {
    const recent  = thread.messages.slice(-MAX_MESSAGES);
    const older   = thread.messages.slice(0, -MAX_MESSAGES);

    const summary = thread.summary
      ? thread.summary
      : await this.summarizeOlderMessages(thread);

    return this.buildSlidingText(recent, older.length, summary, thread.entities);
  }

  private formatSlidingSync(thread: EmailThread): string {
    const recent = thread.messages.slice(-MAX_MESSAGES);
    const older  = thread.messages.slice(0, -MAX_MESSAGES);

    const summary = thread.summary
      ?? `${older.length} older messages (summary not yet generated)`;

    return this.buildSlidingText(recent, older.length, summary, thread.entities);
  }

  private buildSlidingText(
    recent:   { from: string; body?: string }[],
    olderLen: number,
    summary:  string,
    entities: { actionItems: string[] },
  ): string {
    const parts: string[] = [
      `## Conversation History`,
      ``,
      `### Older messages summary (${olderLen} messages):`,
      summary,
      ``,
      `### Last ${recent.length} messages:`,
      ...recent.map((m) => `[${m.from}]: ${m.body || '(no body stored)'}`),
    ];

    if (entities.actionItems.length) {
      parts.push(`\n### Pending action items:\n` + entities.actionItems.join('\n'));
    }

    return parts.join('\n');
  }
}
