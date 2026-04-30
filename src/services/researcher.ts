/**
 * Researcher — enriches reply context with sender/topic information.
 * Used before generating replies to provide grounded, relevant responses.
 */

import { logger } from '../utils/logger.ts';
import type { LLMConfig } from '../types/index.ts';

export interface ResearchResult {
  senderContext:  string;
  topicContext:   string;
  combined:       string;
}

export class Researcher {
  constructor(private llmConfig: LLMConfig) {}

  async research(email: {
    sender: string;
    senderName: string;
    subject: string;
    body: string;
    intent: string;
  }): Promise<ResearchResult> {
    // Extract domain for company lookup
    const domain = email.sender.split('@')[1] ?? '';
    const isPersonal = /gmail|yahoo|hotmail|outlook|icloud|proton/i.test(domain);

    const parts: string[] = [];

    // Company context from domain (no external search needed — LLM has training knowledge)
    if (!isPersonal && domain) {
      parts.push(`Sender domain: ${domain}`);
      const companyInfo = await this.inferCompanyContext(domain, email.senderName);
      if (companyInfo) parts.push(`Company context: ${companyInfo}`);
    }

    // Topic/subject context
    const topicContext = await this.inferTopicContext(email.subject, email.body, email.intent);
    if (topicContext) parts.push(`Topic context: ${topicContext}`);

    const combined = parts.join('\n');
    return {
      senderContext: isPersonal ? '' : (parts[0] ?? ''),
      topicContext:  topicContext ?? '',
      combined,
    };
  }

  private async inferCompanyContext(domain: string, senderName: string): Promise<string> {
    try {
      const { LLMRouter } = await import('../llm/router.ts');
      const llm = new LLMRouter(this.llmConfig);
      const prompt = `In one short sentence, what is "${domain}" (sender: "${senderName}")? If unknown, say "Unknown company". No speculation.`;
      const result = (await llm.complete(prompt, { maxTokens: 60, temperature: 0.1 })).trim();
      return result.length < 150 ? result : '';
    } catch { return ''; }
  }

  private async inferTopicContext(subject: string, body: string, intent: string): Promise<string> {
    if (['newsletter', 'marketing', 'fyi'].includes(intent)) return '';
    try {
      const { LLMRouter } = await import('../llm/router.ts');
      const llm = new LLMRouter(this.llmConfig);
      const prompt = `Given this email subject and intent, what key context should a reply consider?
Subject: "${subject}"
Intent: ${intent}
Body snippet: "${body.substring(0, 300)}"

Reply in one sentence with the most important thing to address. Be specific and brief.`;
      const result = (await llm.complete(prompt, { maxTokens: 80, temperature: 0.2 })).trim();
      return result.length < 200 ? result : '';
    } catch { return ''; }
  }

  formatForPrompt(research: ResearchResult): string {
    if (!research.combined.trim()) return '';
    return `## Research Context\n\n${research.combined}`;
  }
}
