import { LLMRouter } from '../llm/router.ts';
import { StyleDNASchema } from '../llm/schemas.ts';

export class StyleExtractor {
  constructor(private llm: LLMRouter) {}

  async extract(samples: string[]): Promise<string> {
    const prompt = `
Analyze the writing style from these ${samples.length} email samples written by the same user.

${samples.map((s, i) => `=== Sample ${i + 1} ===\n${s}`).join('\n\n')}

Return JSON with exactly these fields:
{
  "tone": "description of tone",
  "formality": "very_formal|professional|friendly|casual",
  "averageLength": "short|medium|long",
  "usesEmoji": true or false,
  "usesGreeting": true or false,
  "signatureStyle": "description of signature style",
  "keyPhrases": ["frequently used phrases"],
  "avoidPhrases": ["phrases the user never uses"],
  "summary": "one-paragraph summary of writing style"
}
`;

    const raw = await this.llm.completeWithRetry(
      prompt,
      (parsed) => StyleDNASchema.parse(parsed),
    );

    return raw.summary;
  }
}
