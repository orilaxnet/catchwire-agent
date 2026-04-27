import type { LLMConfig } from '../types/index.ts';
import { logger } from '../utils/logger.ts';

export interface ResolvedReference {
  original:  string;
  resolved:  string;
  confidence: number;
  source:    'thread' | 'entity' | 'llm';
}

/**
 * Resolves vague references in email text to their actual values using thread context.
 *
 * Examples:
 *   "that document"  → "Q3 Budget Report.pdf (attached 2024-01-15)"
 *   "that price"     → "$4,500 (mentioned Jan 12)"
 *   "that meeting"   → "Thursday 3pm call (scheduled Jan 10)"
 */
export class ReferenceResolver {
  constructor(private llmConfig: LLMConfig) {}

  async resolve(
    text:          string,
    threadContext: string,
    entities:      Record<string, string[]>,
  ): Promise<ResolvedReference[]> {
    const vagueRefs = this.detectVagueReferences(text);
    if (!vagueRefs.length) return [];

    const resolved: ResolvedReference[] = [];

    for (const ref of vagueRefs) {
      // First try entity matching (fast, no LLM cost)
      const entityMatch = this.matchFromEntities(ref, entities);
      if (entityMatch) {
        resolved.push({ original: ref, resolved: entityMatch.value, confidence: entityMatch.score, source: 'entity' });
        continue;
      }

      // Fall back to LLM resolution
      const llmResult = await this.resolveWithLLM(ref, threadContext);
      if (llmResult) {
        resolved.push({ original: ref, resolved: llmResult, confidence: 0.8, source: 'llm' });
      }
    }

    return resolved;
  }

  private detectVagueReferences(text: string): string[] {
    const patterns = [
      /\b(that|the|this)\s+(document|file|report|attachment|pdf|invoice|contract|proposal)\b/gi,
      /\b(that|the|this)\s+(price|amount|cost|fee|quote|figure|number)\b/gi,
      /\b(that|the|this)\s+(meeting|call|appointment|session|event)\b/gi,
      /\b(that|the|this)\s+(deadline|date|time|schedule)\b/gi,
      /\b(what|which)\s+(you|we)\s+(mentioned|discussed|sent|shared|agreed)\b/gi,
      /\bthe\s+one\s+(?:from|about|that)\b/gi,
    ];

    const found = new Set<string>();
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        found.add(match[0].trim());
      }
    }
    return [...found];
  }

  private matchFromEntities(
    ref:      string,
    entities: Record<string, string[]>,
  ): { value: string; score: number } | null {
    const lower = ref.toLowerCase();

    if (/price|amount|cost|fee|quote|figure/.test(lower) && entities.amounts?.length) {
      return { value: entities.amounts[entities.amounts.length - 1], score: 0.85 };
    }

    if (/meeting|call|appointment|session|event/.test(lower) && entities.dates?.length) {
      return { value: entities.dates[entities.dates.length - 1], score: 0.80 };
    }

    if (/deadline|date|schedule|due/.test(lower) && entities.dates?.length) {
      return { value: entities.dates[0], score: 0.75 };
    }

    return null;
  }

  private async resolveWithLLM(ref: string, threadContext: string): Promise<string | null> {
    const prompt = `You are analyzing an email thread to resolve a vague reference.

Thread context (most recent emails):
${threadContext.slice(0, 2000)}

The sender wrote: "${ref}"

What specific thing does "${ref}" refer to based on the thread context?
Reply with ONLY the specific thing it refers to (e.g. "the $4,500 invoice from Jan 12"), or "UNKNOWN" if you cannot determine it.`;

    try {
      const { LLMRouter } = await import('../llm/router.ts');
      const llm  = new LLMRouter(this.llmConfig);
      const text = (await llm.complete(prompt, { temperature: 0.1, maxTokens: 80 })).trim();

      if (!text || text === 'UNKNOWN') return null;
      return text;
    } catch (err) {
      logger.error('ReferenceResolver LLM call failed', { err });
      return null;
    }
  }

  /**
   * Substitute resolved references back into the text so downstream
   * processing has full context.
   */
  substituteAll(text: string, resolved: ResolvedReference[]): string {
    let result = text;
    for (const r of resolved) {
      result = result.replace(r.original, `${r.original} [= ${r.resolved}]`);
    }
    return result;
  }
}
