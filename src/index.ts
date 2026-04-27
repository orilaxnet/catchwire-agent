/**
 * Email Agent — Entry Point
 */

import 'dotenv/config';
import { logger } from './utils/logger.ts';
import { validateEnv } from './utils/env-validator.ts';

async function main(): Promise<void> {
  logger.info('Email Agent starting...', { version: '0.1.0' });

  // 1. Validate environment variables
  validateEnv();

  // 2. Initialize Database
  const { initPgSchema } = await import('./storage/pg-pool.ts');
  await initPgSchema();
  logger.info('Database initialized');

  // 3. Initialize LLM Router
  const { LLMRouter } = await import('./llm/router.ts');
  const llmRouter = new LLMRouter({
    provider: process.env.LLM_PROVIDER as any || 'openrouter',
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL || 'google/gemini-flash-1.5',
    baseUrl: process.env.LLM_BASE_URL
  });
  logger.info('LLM Router initialized');

  // 4. Initialize Security
  const { Encryption } = await import('./security/encryption.ts');
  const encryption = new Encryption(process.env.ENCRYPTION_KEY!);

  // 5. Initialize Interface Manager
  const { InterfaceManager } = await import('./interfaces/shared/interface-manager.ts');
  const interfaceManager = new InterfaceManager();

  // 6. Load Telegram Interface
  const { TelegramInterface } = await import('./interfaces/telegram/telegram.interface.ts');
  const telegramInterface = new TelegramInterface();
  await telegramInterface.initialize({
    userId: 'system',
    credentials: { token: process.env.TELEGRAM_BOT_TOKEN! }
  });
  interfaceManager.registerInterface(telegramInterface);
  logger.info('Telegram interface initialized');

  // 7. Load Web Interface (optional)
  if (process.env.WEB_ENABLED === 'true') {
    const { WebInterface } = await import('./interfaces/web/web.interface.ts');
    const webInterface = new WebInterface();
    await webInterface.initialize({
      userId: 'system',
      credentials: { port: parseInt(process.env.WEB_PORT || '3000') }
    });
    interfaceManager.registerInterface(webInterface);
    logger.info(`Web interface initialized on port ${process.env.WEB_PORT || 3000}`);
  }

  // 8. Initialize Plugin Manager
  const { PluginManager } = await import('./plugins/plugin-manager.ts');
  const pluginManager = new PluginManager();

  // 9. Load Built-in Plugins
  if (process.env.FEATURE_PLUGINS === 'true') {
    await loadPlugins(pluginManager);
  }

  // 10. Initialize Multi-Account Manager
  const { MultiAccountManager } = await import('./ingestion/multi-account-router.ts');
  const accountManager = new MultiAccountManager(encryption);
  await accountManager.initialize();
  logger.info('Multi-account manager initialized');

  // 11. Setup ingestion
  if (process.env.SMTP_HOST) {
    const { SMTPIngestion } = await import('./ingestion/smtp-server.ts');
    const smtpIngestion = new SMTPIngestion((raw) => accountManager.ingest(raw));
    await smtpIngestion.start();
    logger.info(`SMTP server listening on port ${process.env.SMTP_PORT || 25}`);
  }

  // 12. Connect everything and start processing
  const { ActionController } = await import('./action/controller.ts');
  const actionController = new ActionController({
    llmRouter, interfaceManager, pluginManager, encryption
  });

  accountManager.onEmailReceived(async (email) => {
    await actionController.processEmail(email);
  });

  logger.info('Email Agent started successfully ✅');

  // 13. Graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown(interfaceManager, pluginManager));
  process.on('SIGINT',  () => gracefulShutdown(interfaceManager, pluginManager));
}

async function loadPlugins(pluginManager: any): Promise<void> {
  logger.info('Plugin system enabled (no built-in plugins loaded yet)');
}

async function gracefulShutdown(
  interfaceManager: any,
  pluginManager: any
): Promise<void> {
  logger.info('Shutting down gracefully...');

  await pluginManager.runHook('onShutdown');
  await interfaceManager.shutdownAll();

  logger.info('Shutdown complete');
  process.exit(0);
}

main().catch((error) => {
  logger.error('Fatal error during startup', error);
  process.exit(1);
});
