import 'dotenv/config';
import { validateEnv } from './utils/env-validator.ts';
validateEnv();
import { initPgSchema } from './storage/pg-pool.ts';
import { Encryption } from './security/encryption.ts';
import { LLMRouter } from './llm/router.ts';
import { MultiAccountManager } from './ingestion/multi-account-router.ts';
import { ActionController } from './action/controller.ts';
import { PluginManager } from './plugins/plugin-manager.ts';
import { EmailScheduler } from './scheduling/email-scheduler.ts';
import { FollowUpManager } from './scheduling/follow-up-manager.ts';
import { InterfaceManager } from './interfaces/shared/interface-manager.ts';
import { TelegramInterface } from './interfaces/telegram/telegram.interface.ts';
import { WebInterface } from './interfaces/web/web.interface.ts';
import { EmailSender } from './services/email-sender.ts';
import { logger } from './utils/logger.ts';

async function main() {
  logger.info('Email Agent starting', { env: process.env.NODE_ENV ?? 'development' });

  // ── Storage ───────────────────────────────────────────────────────────────
  await initPgSchema();
  logger.info('PostgreSQL storage initialized');

  // ── Core services ─────────────────────────────────────────────────────────
  const encryption = new Encryption(process.env.ENCRYPTION_KEY!);
  const pluginMgr  = new PluginManager();

  // ── LLM ───────────────────────────────────────────────────────────────────
  const llm = new LLMRouter({
    provider: (process.env.LLM_PROVIDER as any) ?? 'openrouter',
    model:    process.env.LLM_MODEL ?? 'google/gemini-flash-1.5',
    apiKey:   process.env.LLM_API_KEY,
    baseUrl:  process.env.LLM_BASE_URL,
  });

  // ── Scheduling ────────────────────────────────────────────────────────────
  const scheduler = new EmailScheduler();
  const followUp  = new FollowUpManager();

  // ── Interfaces ────────────────────────────────────────────────────────────
  const ifaceManager = new InterfaceManager();

  if (process.env.TELEGRAM_BOT_TOKEN) {
    const tg = new TelegramInterface();
    await tg.initialize({ userId: 'system', credentials: { token: process.env.TELEGRAM_BOT_TOKEN } });
    ifaceManager.registerInterface(tg);
    logger.info('Telegram interface started');
  }

  const web = new WebInterface(parseInt(process.env.PORT ?? '3000', 10));
  ifaceManager.registerInterface(web as any);
  await web.start();

  // ── Email routing ─────────────────────────────────────────────────────────
  const multiAccount = new MultiAccountManager(encryption);
  const controller   = new ActionController({
    llmRouter:        llm,
    interfaceManager: ifaceManager,
    pluginManager:    pluginMgr,
    encryption,
  });

  multiAccount.onEmailReceived(async (email) => {
    try { await controller.processEmail(email); }
    catch (err) { logger.error('processEmail failed', { err }); }
  });

  await multiAccount.initialize();
  logger.info('Multi-account manager initialized');

  // ── SMTP Ingestion ────────────────────────────────────────────────────────
  if (process.env.SMTP_HOST || process.env.SMTP_PORT) {
    const { SMTPIngestion } = await import('./ingestion/smtp-server.ts');
    const smtpServer = new SMTPIngestion((raw) => multiAccount.ingest(raw));
    await smtpServer.start();
    logger.info(`SMTP ingestion started on port ${process.env.SMTP_PORT ?? 25}`);
  }

  // ── Schedulers ────────────────────────────────────────────────────────────
  const emailSender = new EmailSender();
  await scheduler.start(async (scheduled) => {
    await emailSender.send(scheduled.accountId, {
      from: scheduled.accountId, to: scheduled.to,
      subject: scheduled.subject, body: scheduled.body,
    });
  });

  followUp.start(async (rule) => {
    logger.info('Follow-up triggered', { id: rule.id });
  });

  logger.info('Email Agent ready ✅');
  process.on('SIGINT',  () => { scheduler.stop(); followUp.stop(); process.exit(0); });
  process.on('SIGTERM', () => { scheduler.stop(); followUp.stop(); process.exit(0); });
}

main().catch((err) => { console.error('Fatal startup error', err); process.exit(1); });
