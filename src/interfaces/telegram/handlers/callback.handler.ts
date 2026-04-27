import type { Context } from 'telegraf';
import type { TelegramInterface } from '../telegram.interface.ts';
import { getPool }  from '../../../storage/pg-pool.ts';
import { EmailLogRepo, FeedbackRepo } from '../../../storage/sqlite.adapter.ts';
import { EmailSender } from '../../../services/email-sender.ts';
import { webhookDispatcher } from '../../../services/webhook-dispatcher.ts';
import { logger } from '../../../utils/logger.ts';

const emailSender = new EmailSender();

export class CallbackHandler {
  constructor(private iface: TelegramInterface) {}

  async handle(ctx: Context): Promise<void> {
    const query = (ctx as any).callbackQuery;
    if (!query?.data) return;

    let data: Record<string, any>;
    try { data = JSON.parse(query.data); }
    catch { await ctx.answerCbQuery('Invalid data'); return; }

    await ctx.answerCbQuery();
    const userId = String(ctx.from?.id);
    const { action, emailId, replyIndex } = data;

    switch (action) {
      case 'send_reply':    await this.sendReply(ctx, userId, emailId, replyIndex ?? 0); break;
      case 'edit':          await this.startEdit(ctx, userId, emailId); break;
      case 'ignore':        await this.ignoreEmail(ctx, emailId); break;
      case 'full_text':     await this.showFullText(ctx, emailId); break;
      case 'wrong_priority':await this.markWrongPriority(ctx, emailId); break;
      case 'start_add_account': await ctx.reply('Use /addaccount to connect an email account.'); break;
      case 'help':          await ctx.reply('Type /help for assistance.'); break;
      case 'settings':      await ctx.reply('Type /settings to open settings.'); break;
      default:
        this.iface.emit({ userId, interfaceName: 'telegram', type: 'button_click', data, timestamp: new Date() });
    }
  }

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
}
