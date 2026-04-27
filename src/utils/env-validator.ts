import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT:     z.string().default('3000'),

  // Security (required)
  ENCRYPTION_KEY: z.string()
    .length(64, 'ENCRYPTION_KEY must be 64 hex characters (256-bit key)')
    .regex(/^[0-9a-f]+$/i, 'ENCRYPTION_KEY must be hex string'),

  JWT_SECRET: z.string()
    .min(32, 'JWT_SECRET must be at least 32 characters'),

  // Telegram (required to issue JWTs for web dashboard)
  TELEGRAM_BOT_TOKEN:    z.string().min(10).optional().or(z.literal('')),
  TELEGRAM_ALLOWED_USERS: z.string().optional(),

  // LLM (optional — configurable later via bot/web)
  LLM_PROVIDER: z.string().optional(),
  LLM_API_KEY:  z.string().optional(),
  LLM_MODEL:    z.string().optional(),
  LLM_BASE_URL: z.string().url().optional().or(z.literal('')),

  // Database
  DATABASE_URL: z.string().min(1).optional(),

  // Optional
  CORS_ORIGINS:    z.string().optional(),
  WEB_ENABLED:     z.enum(['true', 'false']).default('false'),
  WEB_PORT:        z.string().default('3000'),
  LOG_LEVEL:       z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  FEATURE_PLUGINS: z.enum(['true', 'false']).default('false'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default('25'),

  REDIS_URL:  z.string().optional(),
  REDIS_HOST: z.string().optional(),
});

export function validateEnv(): void {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map(e => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    console.error(`\n❌ Environment validation failed:\n${errors}\n`);
    console.error('Check your .env file. See .env.example for reference.\n');
    process.exit(1);
  }
}
