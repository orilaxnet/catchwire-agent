import type { Context } from 'telegraf';
import type { TelegramInterface } from '../telegram.interface.ts';
import { getPool }  from '../../../storage/pg-pool.ts';
import { CredentialManager } from '../../../security/credential-manager.ts';
import { Encryption } from '../../../security/encryption.ts';

const LLM_PROVIDERS = [
  { label: 'OpenRouter (recommended)', value: 'openrouter' },
  { label: 'OpenAI',                   value: 'openai'     },
  { label: 'Google Gemini',            value: 'gemini'     },
  { label: 'Anthropic Claude',         value: 'claude'     },
  { label: 'Ollama (Local)',           value: 'ollama'     },
];

export class SettingsHandler {
  private credManager: CredentialManager;
  constructor(private iface: TelegramInterface) {
    this.credManager = new CredentialManager(new Encryption(process.env.ENCRYPTION_KEY!));
  }

  async handleMenu(ctx: Context): Promise<void> {
    const userId = String(ctx.from?.id);
    const { rows } = await getPool().query(
      `SELECT ea.email_address, p.autonomy_level
       FROM email_accounts ea
       LEFT JOIN personas p ON p.account_id = ea.id
       WHERE ea.user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
      [userId]
    );
    const accountLines = rows.length
      ? rows.map((a) => `• ${a.email_address} — ${a.autonomy_level ?? 'draft'}`).join('\n')
      : 'No accounts registered';

    await ctx.reply(
      `⚙️ *Settings*\n\n*Accounts:*\n${accountLines}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Account',     callback_data: JSON.stringify({ action: 'start_add_account' }) }],
            [{ text: '🤖 Configure LLM',   callback_data: JSON.stringify({ action: 'set_llm_menu'      }) }],
            [{ text: '🎯 Autonomy Level',  callback_data: JSON.stringify({ action: 'autonomy_menu'     }) }],
            [{ text: '🗑️ Delete All Data', callback_data: JSON.stringify({ action: 'confirm_delete_all'}) }],
          ],
        },
      },
    );
  }

  async handleSetLLM(ctx: Context): Promise<void> {
    await ctx.reply('🤖 *Select AI Provider:*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: LLM_PROVIDERS.map((p) => [
          { text: p.label, callback_data: JSON.stringify({ action: 'select_provider', provider: p.value }) },
        ]),
      },
    });
  }

  async handleAnalytics(ctx: Context): Promise<void> {
    const userId = String(ctx.from?.id);
    const { rows } = await getPool().query(`
      SELECT
        COALESCE(SUM(emails_received), 0)::int AS total_recv,
        COALESCE(SUM(emails_sent),     0)::int AS total_sent,
        COALESCE(SUM(auto_replied),    0)::int AS auto_replied
      FROM analytics_daily
      WHERE account_id IN (
        SELECT ea.id FROM email_accounts ea
        JOIN users u ON ea.user_id = u.id
        WHERE u.telegram_id = $1
      ) AND date >= CURRENT_DATE - INTERVAL '7 days'
    `, [userId]);

    const s = rows[0] ?? {};
    await ctx.reply(
      `📊 *Last 7 Days:*\n\n📬 Received: ${s.total_recv ?? 0}\n📤 Sent: ${s.total_sent ?? 0}\n🤖 Auto-replied: ${s.auto_replied ?? 0}`,
      { parse_mode: 'Markdown' },
    );
  }

  async handleSetModel(ctx: Context): Promise<void> {
    const userId = String(ctx.from?.id);
    const args   = ((ctx as any).message?.text ?? '').split(/\s+/).slice(1).join(' ').trim();
    if (!args) {
      await ctx.reply('Usage: /setmodel <model-name>\nExample: /setmodel google/gemini-flash-1.5');
      return;
    }
    const { rows } = await getPool().query(
      `UPDATE personas SET llm_model = $1
       WHERE account_id IN (
         SELECT ea.id FROM email_accounts ea
         JOIN users u ON ea.user_id = u.id
         WHERE u.telegram_id = $2
       )`,
      [args, userId]
    );
    await ctx.reply(`✅ Model updated to: \`${args}\``, { parse_mode: 'Markdown' });
  }

  async handleDeleteAll(ctx: Context): Promise<void> {
    await ctx.reply('⚠️ *Are you sure?*\n\nAll your data will be permanently deleted.', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Yes, delete', callback_data: JSON.stringify({ action: 'do_delete_all' }) },
          { text: '❌ Cancel',      callback_data: JSON.stringify({ action: 'cancel'         }) },
        ]],
      },
    });
  }
}
