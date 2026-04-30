import { randomUUID } from 'crypto';
import { Telegraf, Context } from 'telegraf';
import type { IUserInterface, InterfaceConfig, InterfaceCapabilities, Message, MessageResult, UserAction } from '../shared/interface-manager.ts';
import { getPool } from '../../storage/pg-pool.ts';
import { logger } from '../../utils/logger.ts';

export class TelegramInterface implements IUserInterface {
  readonly name    = 'telegram';
  readonly version = '1.0.0';

  private bot!: Telegraf;
  private callbacks: Array<(a: UserAction) => void> = [];

  async initialize(config: InterfaceConfig): Promise<void> {
    const token = config.credentials.token as string;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

    this.bot = new Telegraf(token);

    // Global access-control middleware — runs before every handler
    this.bot.use((ctx, next) => {
      const allowed = (process.env.TELEGRAM_ALLOWED_USERS || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      if (!allowed.length) return next();               // open mode — no whitelist set

      const userId = String(ctx.from?.id ?? '');
      if (!userId || !allowed.includes(userId)) {
        if ('reply' in ctx) (ctx as any).reply('⛔ Access denied.');
        logger.warn('Telegram: blocked unknown user', { userId });
        return;
      }
      return next();
    });

    // Register handlers
    const { StartHandler }      = await import('./handlers/start.handler.ts');
    const { CallbackHandler }   = await import('./handlers/callback.handler.ts');
    const { OnboardingHandler } = await import('./handlers/onboarding.handler.ts');
    const { SettingsHandler }   = await import('./handlers/settings.handler.ts');

    const startHandler      = new StartHandler();
    const callbackHandler   = new CallbackHandler(this);
    const onboardingHandler = new OnboardingHandler();
    const settingsHandler   = new SettingsHandler(this);

    this.bot.start((ctx) => startHandler.handleStart(ctx));
    this.bot.command('addaccount',  (ctx) => onboardingHandler.handleAddAccount(ctx));
    this.bot.command('setllm',      (ctx) => settingsHandler.handleSetLLM(ctx));
    this.bot.command('setmodel',    (ctx) => settingsHandler.handleSetModel(ctx));
    this.bot.command('setstyle',    (ctx) => onboardingHandler.handleSetStyle(ctx));
    this.bot.command('settings',    (ctx) => settingsHandler.handleMenu(ctx));
    this.bot.command('analytics',   (ctx) => settingsHandler.handleAnalytics(ctx));
    this.bot.command('deleteall',   (ctx) => settingsHandler.handleDeleteAll(ctx));
    this.bot.command('webapp',      (ctx) => this.handleWebApp(ctx));
    this.bot.command('help',        (ctx) => startHandler.handleHelp(ctx));

    this.bot.on('callback_query', (ctx) => callbackHandler.handle(ctx));
    this.bot.on('text',           (ctx) => this.handleText(ctx));

    // Register slash-command menu with Telegram (shows when user types /)
    await this.bot.telegram.setMyCommands([
      { command: 'webapp',      description: 'Open web inbox (magic link, no password)' },
      { command: 'addaccount',  description: 'Connect an email account' },
      { command: 'settings',    description: 'View & change settings' },
      { command: 'setllm',      description: 'Choose AI provider & model' },
      { command: 'setstyle',    description: 'Set your writing style' },
      { command: 'analytics',   description: '7-day email stats' },
      { command: 'deleteall',   description: 'Delete all your data' },
      { command: 'help',        description: 'Show all commands' },
    ]);

    // Launch without await — bot.launch() in Telegraf v4 runs indefinitely
    this.bot.launch().catch((err) => logger.error('Telegram bot crashed', err));
    logger.info('Telegram bot launched');
  }

  private async encodeCallbackData(data: any): Promise<string> {
    const raw = JSON.stringify(data);
    if (raw.length <= 64) return raw;
    // Too large for Telegram's 64-byte limit — store in KV and return a short key
    const key = randomUUID().replace(/-/g, '').slice(0, 12);
    await getPool().query(
      `INSERT INTO kv_store (collection, id, data) VALUES ('tg_cb', $1, $2::jsonb)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
      [key, raw]
    );
    return `cb:${key}`;
  }

  async sendMessage(userId: string, message: Message): Promise<MessageResult> {
    try {
      let markup: any;
      if (message.buttons?.length) {
        const rows = await Promise.all(
          message.buttons.map(async (b) => [{
            text:          b.label,
            callback_data: await this.encodeCallbackData(b.action.data),
          }])
        );
        markup = { inline_keyboard: rows };
      }

      const sent = await this.bot.telegram.sendMessage(
        userId,
        message.text,
        {
          parse_mode:   message.format === 'markdown' ? 'Markdown' : undefined,
          reply_markup: markup,
        },
      );
      return { success: true, messageId: String(sent.message_id) };
    } catch (err) {
      logger.error('Telegram sendMessage failed', err as Error);
      return { success: false, error: (err as Error).message };
    }
  }

  onUserAction(cb: (a: UserAction) => void): void {
    this.callbacks.push(cb);
  }

  emit(action: UserAction): void {
    this.callbacks.forEach((cb) => cb(action));
  }

  getCapabilities(): InterfaceCapabilities {
    return {
      supportsRichText:       true,
      supportsButtons:        true,
      supportsInlineEdit:     true,
      supportsFileAttachment: true,
      supportsVoiceMessage:   true,
      maxMessageLength:       4096,
      supportsThreads:        false,
    };
  }

  private async handleText(ctx: Context): Promise<void> {
    const userId = String(ctx.from?.id);
    if (!userId) return;

    const allowed = (process.env.TELEGRAM_ALLOWED_USERS || '').split(',').map((s) => s.trim());
    if (allowed.length && !allowed.includes(userId)) {
      ctx.reply('⛔ Access denied.');
      return;
    }

    const text = (ctx.message as any)?.text ?? '';

    // Check if user is in edit mode — if so, send the edited reply and learn from it
    try {
      const { rows } = await getPool().query(
        `SELECT data FROM kv_store WHERE collection = 'edit_state' AND id = $1`,
        [`edit:${userId}`]
      );
      if (rows.length && text.length > 2 && !text.startsWith('/')) {
        const state = rows[0].data as { emailId: string };
        await this.handleEditedReply(ctx, userId, state.emailId, text);
        return;
      }
    } catch { /* ignore */ }

    this.emit({
      userId,
      interfaceName: this.name,
      type:          'text_input',
      data:          { text, messageId: (ctx.message as any)?.message_id },
      timestamp:     new Date(),
    });
  }

  private async handleEditedReply(ctx: Context, userId: string, emailId: string, editedText: string): Promise<void> {
    try {
      const pool = getPool();

      // Get original reply and account info
      const { rows } = await pool.query(
        `SELECT agent_response, account_id FROM email_log WHERE id = $1`, [emailId]
      );
      if (!rows[0]) { await ctx.reply('Email not found.'); return; }

      const originalReply = rows[0].agent_response?.suggestedReplies?.[0]?.body ?? '';
      const accountId     = rows[0].account_id;

      // Look up account to get from address
      const { rows: accRows } = await pool.query(
        `SELECT email_address FROM email_accounts WHERE id = $1`, [accountId]
      );
      const { rows: emailRows } = await pool.query(
        `SELECT from_address, subject FROM email_log WHERE id = $1`, [emailId]
      );
      const account   = accRows[0];
      const emailData = emailRows[0];

      // Send the edited reply
      if (account && emailData) {
        const { EmailSender } = await import('../../services/email-sender.ts');
        const result = await new EmailSender().send(accountId, {
          from: account.email_address, to: emailData.from_address,
          subject: emailData.subject?.startsWith('Re:') ? emailData.subject : `Re: ${emailData.subject}`,
          body: editedText, inReplyTo: emailId,
        });
        if (!result.success) { await ctx.reply(`❌ Failed to send: ${result.error}`); return; }
      }

      // Record action and feedback
      const { EmailLogRepo, FeedbackRepo } = await import('../../storage/sqlite.adapter.ts');
      await EmailLogRepo.recordAction(emailId, 'sent_modified');
      await FeedbackRepo.insert({
        emailLogId: emailId, accountId,
        prediction: rows[0].agent_response ?? {}, userAction: 'sent_modified',
        wasCorrect: false, createdAt: new Date(),
      });

      // Clear edit state
      await pool.query(`DELETE FROM kv_store WHERE collection = 'edit_state' AND id = $1`, [`edit:${userId}`]);

      // Learn from the edit in background
      const { MemoryManager } = await import('../../memory/memory-manager.ts');
      const { PersonaManager } = await import('../../persona/persona-manager.ts');
      const { CredentialManager } = await import('../../security/credential-manager.ts');
      const { Encryption } = await import('../../security/encryption.ts');
      const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
      const creds    = new CredentialManager(enc);
      const personas = new PersonaManager(creds);
      const persona  = await personas.get(accountId);
      const memory   = new MemoryManager(persona.llmConfig);
      memory.learnFromEdit(accountId, emailId, originalReply, editedText).catch(() => {});

      await ctx.reply(`✅ Edited reply sent!\n\n"${editedText.substring(0, 150)}${editedText.length > 150 ? '...' : ''}"\n\n🧠 Agent learned from your edit.`);
      logger.info('Edited reply sent and learned from', { emailId, userId });
    } catch (err) {
      logger.error('handleEditedReply failed', err as Error);
      await ctx.reply('❌ Failed to send edited reply.');
    }
  }

  private async handleWebApp(ctx: Context): Promise<void> {
    const telegramId = String(ctx.from?.id);
    const baseUrl    = process.env.PUBLIC_URL || 'https://catchwire.synthesislogic.com';

    try {
      const res = await fetch(`http://localhost:${process.env.PORT ?? 3000}/api/auth/magic/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ telegramId }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        await ctx.reply(`❌ ${err.error ?? 'Could not generate link'}\n\nRun /start first to register.`);
        return;
      }

      const { magic } = await res.json() as { magic: string };
      const link = `${baseUrl}/agent/inbox?magic=${magic}`;

      await ctx.reply(
        `🔗 *Open Web App*\n\nTap the link below to log in instantly:\n${link}\n\n_Link expires in 10 minutes and can only be used once._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🌐 Open Inbox', url: link },
            ]],
          },
        }
      );
    } catch (err) {
      logger.error('handleWebApp failed', err as Error);
      await ctx.reply('❌ Could not generate link. Please try again.');
    }
  }

  getBotInstance(): Telegraf {
    return this.bot;
  }

  async shutdown(): Promise<void> {
    this.bot.stop('SIGTERM');
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.bot.telegram.getMe();
      return true;
    } catch {
      return false;
    }
  }
}
