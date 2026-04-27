import type { ThreadEntities } from '../types/index.ts';

export class EntityExtractor {
  extract(text: string): Partial<ThreadEntities> {
    return {
      dates:       this.extractDates(text),
      amounts:     this.extractAmounts(text),
      actionItems: this.extractActionItems(text),
    };
  }

  private extractDates(text: string): string[] {
    const patterns = [
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?/gi,
      /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/gi,
      /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\w+\s+\d{1,2}/gi,
      /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
      /\d{4}-\d{2}-\d{2}/g,
      /\bQ[1-4]\s+\d{4}/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) found.push(...(text.match(p) ?? []));
    return [...new Set(found)].slice(0, 10);
  }

  private extractAmounts(text: string): string[] {
    const patterns = [
      /\$[\d,]+(?:\.\d{2})?(?:\s*(?:USD|million|billion|k|M|B))?\b/gi,
      /€[\d,]+(?:\.\d{2})?/g,
      /£[\d,]+(?:\.\d{2})?/g,
      /[\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP|CAD|AUD)\b/gi,
      /\b[\d,]+(?:\.\d{2})?\s*(?:dollars?|euros?|pounds?)\b/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) found.push(...(text.match(p) ?? []));
    return [...new Set(found)].slice(0, 10);
  }

  private extractActionItems(text: string): string[] {
    const lines = text.split(/[.\n]/);
    return lines
      .filter((l) =>
        /^\s*(?:please|kindly|could you|can you|need to|you should|you must|action required|action item|todo|to-do)/i.test(l.trim())
      )
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 5);
  }
}
