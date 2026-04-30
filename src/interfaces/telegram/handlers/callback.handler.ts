import type { Context } from 'telegraf';
import type { TelegramInterface } from '../telegram.interface.ts';
import { getPool }  from '../../../storage/pg-pool.ts';
import { EmailLogRepo, FeedbackRepo } from '../../../storage/sqlite.adapter.ts';
import { EmailSender } from '../../../services/email-sender.ts';
import { webhookDispatcher } from '../../../services/webhook-dispatcher.ts';
import { logger } from '../../../utils/logger.ts';

const emailSender = new EmailSender();

const LLM_PROVIDERS = [
  { label: 'OpenRouter (recommended)', value: 'openrouter' },
  { label: 'OpenAI',                   value: 'openai'     },
  { label: 'Google Gemini',            value: 'gemini'     },
  { label: 'Anthropic Claude',         value: 'claude'     },
  { label: 'Ollama (Local)',           value: 'ollama'     },
];

export class CallbackHandler {
  constructor(private iface: TelegramInterface) {}

  async handle(ctx: Context): Promise<void> {
    const query = (ctx as any).callbackQuery;
    if (!query?.data) return;

    let rawData = query.data as string;
    if (rawData.startsWith('cb:')) {
      const key = rawData.slice(3);
      const { rows } = await getPool().query(
        `SELECT data FROM kv_store WHERE collection = 'tg_cb' AND id = $1`, [key]
      );
      if (!rows[0]) { await ctx.answerCbQuery('Session expired'); return; }
      rawData = JSON.stringify(rows[0].data);
    }
    let data: Record<string, any>;
    try { data = JSON.parse(rawData); }
    catch { await ctx.answerCbQuery('Invalid data'); return; }

    await ctx.answerCbQuery();
    const userId = String(ctx.from?.id);
    const { action, emailId, replyIndex } = data;

    switch (action) {
      // ── Email actions ──────────────────────────────────────────────────────
      case 'send_reply':      await this.sendReply(ctx, userId, emailId, replyIndex ?? 0); break;
      case 'edit':            await this.startEdit(ctx, userId, emailId); break;
      case 'ignore':          await this.ignoreEmail(ctx, emailId); break;
      case 'full_text':       await this.showFullText(ctx, emailId); break;
      case 'wrong_priority':  await this.markWrongPriority(ctx, emailId); break;

      // ── Navigation ────────────────────────────────────────────────────────
      case 'start_add_account':
        await import('./onboarding.handler.ts').then(({ OnboardingHandler }) =>
          new OnboardingHandler().handleAddAccount(ctx));
        break;
      case 'help':      await ctx.reply('Type /help for assistance.'); break;
      case 'settings':  await ctx.reply('Type /settings to open settings.'); break;
      case 'cancel':    await ctx.editMessageText('Cancelled.').catch(() => ctx.reply('Cancelled.')); break;

      // ── Onboarding ────────────────────────────────────────────────────────
      case 'onboard_forward':
        await import('./onboarding.handler.ts').then(({ OnboardingHandler }) =>
          new OnboardingHandler().handleForwardSetup(ctx));
        break;
      case 'onboard_gmail':
        await import('./onboarding.handler.ts').then(({ OnboardingHandler }) =>
          new OnboardingHandler().handleGmailSetup(ctx));
        break;
      case 'onboard_imap':
        await ctx.editMessageText(
          '📥 *IMAP Setup*\n\nUse the command:\n`/addaccount imap you@domain.com imap.domain.com 993 yourpassword`',
          { parse_mode: 'Markdown' }
        );
        break;

      // ── Tone ──────────────────────────────────────────────────────────────
      case 'set_tone':
        await this.setTone(ctx, userId, data.tone);
        break;

      // ── LLM provider / model ──────────────────────────────────────────────
      case 'set_llm_menu':
        await ctx.editMessageText('🤖 *Select AI Provider:*', {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: LLM_PROVIDERS.map((p) => [
              { text: p.label, callback_data: JSON.stringify({ action: 'select_provider', provider: p.value }) },
            ]),
          },
        });
        break;

      case 'select_provider':
        await this.setProvider(ctx, userId, data.provider);
        break;

      // ── Autonomy ──────────────────────────────────────────────────────────
      case 'autonomy_menu':
        await ctx.editMessageText('🎯 *Autonomy Level:*', {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🤖 Auto-Send (≥90% confidence)', callback_data: JSON.stringify({ action: 'set_autonomy', level: 'full'         }) }],
              [{ text: '✏️ Draft Mode (always review)',  callback_data: JSON.stringify({ action: 'set_autonomy', level: 'draft'        }) }],
              [{ text: '👁️ Consult Only (summary only)', callback_data: JSON.stringify({ action: 'set_autonomy', level: 'consultative' }) }],
            ],
          },
        });
        break;

      case 'set_autonomy':
        await this.setAutonomy(ctx, userId, data.level);
        break;

      // ── Delete all ────────────────────────────────────────────────────────
      case 'confirm_delete_all':
        await ctx.editMessageText('⚠️ *Are you sure?*\n\nAll your data will be permanently deleted.', {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Yes, delete everything', callback_data: JSON.stringify({ action: 'do_delete_all' }) },
              { text: '❌ Cancel',                 callback_data: JSON.stringify({ action: 'cancel'        }) },
            ]],
          },
        });
        break;

      case 'do_delete_all':
        await this.deleteAll(ctx, userId);
        break;

      default:
        this.iface.emit({ userId, interfaceName: 'telegram', type: 'button_click', data, timestamp: new Date() });
    }
  }

  // ── Email actions ──────────────────────────────────────────────────────────

  private async sendReply(ctx: Context, _userId: string, emailId: string, replyIndex: number): Promise<void> {
    const { rows } = await getPool().query(
      'SELECT agent_response, account_id, from_address, subject FROM email_log WHERE id = $1', [emailId]
    );
    const row = rows[0];
    if (!row) { await ctx.editMessageText('Email not found.'); return; }

    const analysis = row.agent_response ?? {};
    const reply    = analysis.suggestedReplies?.[replyIndex];
    if (!reply) { await ctx.editMessageText('Reply not found.'); return; }

    const { rows: acctRows } = await getPool().query(
      'SELECT * FROM email_accounts WHERE id = $1', [row.account_id]
    );
    const account = acctRows[0];

    if (account) {
      const subject = row.subject?.startsWith('Re:') ? row.subject : `Re: ${row.subject ?? ''}`;
      const result  = await emailSender.send(row.account_id, {
        from: account.email_address, to: row.from_address, subject, body: reply.body, inReplyTo: emailId,
      });
      if (!result.success) { await ctx.editMessageText(`❌ Failed to send: ${result.error}`); return; }
      webhookDispatcher.dispatch('email.replied', { emailId, accountId: row.account_id, to: row.from_address, auto: false });
    }

    logger.info('Reply sent via Telegram', { emailId });
    await EmailLogRepo.recordAction(emailId, 'sent_as_is');
    await FeedbackRepo.insert({
      emailLogId: emailId, accountId: row.account_id,
      prediction: analysis, userAction: 'sent_as_is', wasCorrect: true, createdAt: new Date(),
    });
    await ctx.editMessageText(`✅ Reply sent:\n\n"${reply.body.substring(0, 200)}${reply.body.length > 200 ? '...' : ''}"`);
  }

  private async startEdit(ctx: Context, userId: string, emailId: string): Promise<void> {
    const { rows } = await getPool().query('SELECT agent_response FROM email_log WHERE id = $1', [emailId]);
    if (!rows[0]) return;
    const reply = (rows[0].agent_response ?? {}).suggestedReplies?.[0];
    await ctx.editMessageText(`✏️ Edit the reply and send it:\n\nSuggested:\n"${reply?.body ?? ''}"`);
    await getPool().query(
      `INSERT INTO kv_store (collection, id, data) VALUES ('edit_state', $1, $2)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
      [`edit:${userId}`, JSON.stringify({ emailId })]
    );
  }

  private async ignoreEmail(ctx: Context, emailId: string): Promise<void> {
    const { rows } = await getPool().query(
      'SELECT agent_response, account_id FROM email_log WHERE id = $1', [emailId]
    );
    if (rows[0]) {
      await EmailLogRepo.recordAction(emailId, 'ignored');
      await FeedbackRepo.insert({
        emailLogId: emailId, accountId: rows[0].account_id,
        prediction: rows[0].agent_response ?? {}, userAction: 'ignored', createdAt: new Date(),
      });
    }
    await ctx.editMessageText('❌ Email ignored.');
  }

  private async showFullText(ctx: Context, emailId: string): Promise<void> {
    const { rows } = await getPool().query('SELECT agent_response FROM email_log WHERE id = $1', [emailId]);
    if (!rows[0]) return;
    const a = rows[0].agent_response ?? {};
    await ctx.reply(
      `📋 Full suggested replies:\n\n` +
      (a.suggestedReplies ?? []).map((r: any, i: number) => `${i + 1}. ${r.label}:\n${r.body}`).join('\n\n───\n\n')
    );
  }

  private async markWrongPriority(ctx: Context, emailId: string): Promise<void> {
    const { rows } = await getPool().query(
      'SELECT agent_response, account_id FROM email_log WHERE id = $1', [emailId]
    );
    if (rows[0]) {
      await FeedbackRepo.insert({
        emailLogId: emailId, accountId: rows[0].account_id,
        prediction: rows[0].agent_response ?? {}, userAction: 'wrong_priority', wasCorrect: false, createdAt: new Date(),
      });
    }
    await ctx.answerCbQuery('Thanks! This feedback will improve the model.');
  }

  // ── Settings actions ───────────────────────────────────────────────────────

  private async setTone(ctx: Context, userId: string, tone: string): Promise<void> {
    const validTones = ['professional', 'friendly', 'formal', 'casual', 'very_formal'];
    if (!validTones.includes(tone)) { await ctx.answerCbQuery('Invalid tone'); return; }
    await getPool().query(
      `UPDATE personas SET tone = $1 WHERE account_id IN (
         SELECT ea.id FROM email_accounts ea JOIN users u ON ea.user_id = u.id WHERE u.telegram_id = $2
       )`,
      [tone, userId]
    );
    await ctx.editMessageText(`✅ Tone set to: *${tone}*`, { parse_mode: 'Markdown' });
  }

  private async setProvider(ctx: Context, userId: string, provider: string): Promise<void> {
    const valid = ['openrouter', 'openai', 'gemini', 'claude', 'ollama', 'custom'];
    if (!valid.includes(provider)) { await ctx.answerCbQuery('Invalid provider'); return; }
    await getPool().query(
      `UPDATE personas SET llm_provider = $1 WHERE account_id IN (
         SELECT ea.id FROM email_accounts ea JOIN users u ON ea.user_id = u.id WHERE u.telegram_id = $2
       )`,
      [provider, userId]
    );
    await ctx.editMessageText(
      `✅ Provider set to: *${provider}*\n\nSet your model with:\n\`/setmodel <model-name>\``,
      { parse_mode: 'Markdown' }
    );
  }

  private async setAutonomy(ctx: Context, userId: string, level: string): Promise<void> {
    const valid = ['full', 'draft', 'consultative'];
    if (!valid.includes(level)) { await ctx.answerCbQuery('Invalid level'); return; }
    await getPool().query(
      `UPDATE personas SET autonomy_level = $1 WHERE account_id IN (
         SELECT ea.id FROM email_accounts ea JOIN users u ON ea.user_id = u.id WHERE u.telegram_id = $2
       )`,
      [level, userId]
    );
    const labels: Record<string, string> = { full: 'Auto-Send', draft: 'Draft Mode', consultative: 'Consult Only' };
    await ctx.editMessageText(`✅ Autonomy set to: *${labels[level]}*`, { parse_mode: 'Markdown' });
  }

  private async deleteAll(ctx: Context, userId: string): Promise<void> {
    try {
      await getPool().query(
        `DELETE FROM users WHERE telegram_id = $1`, [userId]
      );
      await ctx.editMessageText('🗑️ All your data has been deleted.\n\nType /start to begin again.');
    } catch (err) {
      logger.error('Delete all failed', { userId, err });
      await ctx.editMessageText('❌ Failed to delete data. Please try again.');
    }
  }
}
