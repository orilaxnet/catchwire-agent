import type { Context } from 'telegraf';
import { UserRepo } from '../../../storage/sqlite.adapter.ts';
import { getPool }  from '../../../storage/pg-pool.ts';
import { MultiAccountManager } from '../../../ingestion/multi-account-router.ts';
import { Encryption } from '../../../security/encryption.ts';

export class OnboardingHandler {
  async handleAddAccount(ctx: Context): Promise<void> {
    await ctx.reply(
      '➕ *Add Email Account*\n\nHow would you like to connect?',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📨 Forward-only (simplest)', callback_data: JSON.stringify({ action: 'onboard_forward' }) }],
            [
              { text: '🔗 Gmail OAuth', callback_data: JSON.stringify({ action: 'onboard_gmail' }) },
              { text: '📥 IMAP',        callback_data: JSON.stringify({ action: 'onboard_imap'  }) },
            ],
          ],
        },
      },
    );
  }

  async handleForwardSetup(ctx: Context): Promise<void> {
    const userId = String(ctx.from?.id);
    const user   = await UserRepo.findByTelegramId(userId);
    if (!user) { await ctx.reply('Please run /start first.'); return; }

    const forwardAddr = process.env.SMTP_FORWARD_ADDRESS || 'agent@yourdomain.com';
    await ctx.reply(
      `✅ *Forward-only account set up!*\n\nForward your emails to:\n\`${forwardAddr}\``,
      { parse_mode: 'Markdown' },
    );

    const enc     = new Encryption(process.env.ENCRYPTION_KEY!);
    const manager = new MultiAccountManager(enc);
    await manager.addAccount(user.id, {
      emailAddress: forwardAddr, displayName: 'Forward Account', accountType: 'forward', priority: 1,
    });
    await this.askTone(ctx);
  }

  async handleGmailSetup(ctx: Context): Promise<void> {
    const { GmailWebhook } = await import('../../../ingestion/gmail-webhook.ts');
    const webhook = new GmailWebhook(async () => {});
    const url     = webhook.getAuthUrl();
    await ctx.reply(
      `🔗 *Gmail OAuth*\n\nOpen this link:\n${url}\n\nAfter authorizing, paste the code here.`,
      { parse_mode: 'Markdown' },
    );
    await getPool().query(
      `INSERT INTO kv_store (collection, id, data) VALUES ('onboarding', $1, '"waiting_gmail_code"')
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
      [`onboard:${ctx.from?.id}`]
    );
  }

  async handleSetStyle(ctx: Context): Promise<void> {
    await ctx.reply(
      `✍️ *Writing Style Setup*\n\nSend 3 sample emails you've written so the agent can learn your style.\n\nSend each one separately, then type /done when finished.`,
      { parse_mode: 'Markdown' },
    );
    await getPool().query(
      `INSERT INTO kv_store (collection, id, data) VALUES ('style', $1, '[]')
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
      [`style_samples:${ctx.from?.id}`]
    );
  }

  private async askTone(ctx: Context): Promise<void> {
    await ctx.reply('🎨 What tone do you prefer?', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🏛️ Very Formal',   callback_data: JSON.stringify({ action: 'set_tone', tone: 'very_formal'  }) },
            { text: '💼 Professional',   callback_data: JSON.stringify({ action: 'set_tone', tone: 'professional' }) },
          ],
          [
            { text: '😊 Friendly',       callback_data: JSON.stringify({ action: 'set_tone', tone: 'friendly'     }) },
            { text: '🤙 Casual',         callback_data: JSON.stringify({ action: 'set_tone', tone: 'casual'       }) },
          ],
        ],
      },
    });
  }
}
