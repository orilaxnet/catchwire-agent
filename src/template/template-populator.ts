import type { EmailTemplate, ParsedEmail, TemplateVariable } from '../types/index.ts';
import { logger } from '../utils/logger.ts';

interface PopulateResult {
  body:             string;
  missingRequired:  string[];
}

export class TemplatePopulator {
  constructor(private llm?: { complete(p: string): Promise<string> }) {}

  async populate(template: EmailTemplate, email: ParsedEmail): Promise<PopulateResult> {
    const values          = new Map<string, string>();
    const missingRequired: string[] = [];

    for (const variable of template.variables) {
      try {
        const val = await this.resolve(variable, email);
        if (val !== null) {
          values.set(variable.name, val);
        } else if (variable.required) {
          missingRequired.push(variable.name);
        } else if (variable.default !== undefined) {
          values.set(variable.name, variable.default);
        }
      } catch (err) {
        logger.warn(`Variable ${variable.name} resolution failed`, { error: (err as Error).message });
        if (variable.default !== undefined) values.set(variable.name, variable.default);
        else if (variable.required) missingRequired.push(variable.name);
      }
    }

    let body = template.content.bodyTemplate;
    values.forEach((val, name) => {
      body = body.replace(new RegExp(`\\{${name}\\}`, 'g'), val);
    });
    // Remove unresolved placeholders
    body = body.replace(/\{[A-Z_]+\}/g, '—');

    return { body, missingRequired };
  }

  private async resolve(variable: TemplateVariable, email: ParsedEmail): Promise<string | null> {
    switch (variable.source.type) {
      case 'extract_from_email': {
        const m = email.bodyText.match(new RegExp(variable.source.pattern, 'i'));
        return m ? m[1]?.trim() ?? m[0]?.trim() : null;
      }

      case 'llm_extract': {
        if (!this.llm) return null;
        const prompt = `Extract only the value of "${variable.name}" from this email (return just the value, no explanation):\n\n${email.bodyText.substring(0, 1000)}`;
        const raw    = await this.llm.complete(prompt);
        return raw.trim() || null;
      }

      case 'auto':
        return variable.default ?? null;

      case 'ask_user':
        return null;

      default:
        return null;
    }
  }
}
