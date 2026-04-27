import { Telegraf, Context } from 'telegraf';
import type { IUserInterface, InterfaceConfig, InterfaceCapabilities, Message, MessageResult, UserAction } from '../shared/interface-manager.ts';
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
    this.bot.command('help',        (ctx) => startHandler.handleHelp(ctx));

    this.bot.on('callback_query', (ctx) => callbackHandler.handle(ctx));
    this.bot.on('text',           (ctx) => this.handleText(ctx));

    // Launch without await — bot.launch() in Telegraf v4 runs indefinitely
    this.bot.launch().catch((err) => logger.error('Telegram bot crashed', err));
    logger.info('Telegram bot launched');
  }

  async sendMessage(userId: string, message: Message): Promise<MessageResult> {
    try {
      const markup = message.buttons?.length
        ? {
            inline_keyboard: message.buttons.map((b) => [{
              text:          b.label,
              callback_data: JSON.stringify(b.action.data).substring(0, 64),
            }]),
          }
        : undefined;

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

  private handleText(ctx: Context): void {
    const userId = String(ctx.from?.id);
    if (!userId) return;

    const allowed = (process.env.TELEGRAM_ALLOWED_USERS || '').split(',').map((s) => s.trim());
    if (allowed.length && !allowed.includes(userId)) {
      ctx.reply('⛔ Access denied.');
      return;
    }

    const text = (ctx.message as any)?.text ?? '';
    this.emit({
      userId,
      interfaceName: this.name,
      type:          'text_input',
      data:          { text, messageId: (ctx.message as any)?.message_id },
      timestamp:     new Date(),
    });
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
