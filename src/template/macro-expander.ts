import { getPool } from '../storage/pg-pool.ts';

export class MacroExpander {
  async expand(text: string, userId: string, accountId?: string): Promise<string> {
    const macros = await this.loadMacros(userId, accountId);
    let result   = text;

    for (const { trigger, expansion } of macros) {
      result = result.replace(new RegExp(`(?<![\\w/])${escapeRegex(trigger)}(?![\\w])`, 'g'), expansion);
    }

    return result;
  }

  private async loadMacros(userId: string, accountId?: string): Promise<{ trigger: string; expansion: string }[]> {
    const { rows } = await getPool().query(
      `SELECT trigger, expansion FROM macros
       WHERE user_id = $1 AND (account_id = $2 OR account_id IS NULL)
       ORDER BY account_id DESC NULLS LAST`,
      [userId, accountId ?? null]
    );
    return rows as { trigger: string; expansion: string }[];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
