/**
 * Shared PostgreSQL pool singleton.
 * Import `pool` (for query) or `getPool()` (for lazy init) anywhere in the codebase.
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger.ts';

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url || !url.startsWith('postgresql')) {
      throw new Error('DATABASE_URL must be a postgresql:// connection string');
    }
    _pool = new Pool({
      connectionString: url,
      max: 10,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 60_000,
    });
    _pool.on('error', (err) => logger.error('PG pool error', { err }));
  }
  return _pool;
}

export async function initPgSchema(): Promise<void> {
  const pg = getPool();

  // Migration table
  await pg.query(`
    CREATE TABLE IF NOT EXISTS _pg_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const migrations: Record<string, string> = {
    '001_kv_store': `
      CREATE TABLE IF NOT EXISTS kv_store (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (collection, id)
      );`,

    '002_core_tables': `
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        telegram_id   TEXT UNIQUE,
        name          TEXT,
        username      TEXT UNIQUE,
        password_hash TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_accounts (
        id                   TEXT PRIMARY KEY,
        user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email_address        TEXT NOT NULL,
        display_name         TEXT,
        account_type         TEXT NOT NULL,
        credentials_enc      TEXT,
        enabled              BOOLEAN DEFAULT TRUE,
        priority             INT DEFAULT 5,
        polling_interval_min INT DEFAULT 5,
        total_emails         INT DEFAULT 0,
        last_sync_at         TIMESTAMPTZ,
        error_count          INT DEFAULT 0,
        created_at           TIMESTAMPTZ DEFAULT NOW(),
        updated_at           TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS personas (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_id      TEXT NOT NULL UNIQUE REFERENCES email_accounts(id) ON DELETE CASCADE,
        tone            TEXT DEFAULT 'professional',
        use_emoji       BOOLEAN DEFAULT FALSE,
        language        TEXT DEFAULT 'auto',
        autonomy_level  TEXT DEFAULT 'draft',
        style_dna       TEXT,
        llm_provider    TEXT,
        llm_model       TEXT,
        llm_api_key_enc TEXT,
        shadow_mode     BOOLEAN DEFAULT TRUE,
        onboarding_done BOOLEAN DEFAULT FALSE,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sender_overrides (
        id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_id       TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
        sender_email     TEXT,
        sender_domain    TEXT,
        priority         INT DEFAULT 0,
        autonomy_level   TEXT DEFAULT 'suggest',
        tone             TEXT,
        prompt_template  TEXT,
        auto_reply       BOOLEAN DEFAULT FALSE,
        forward_to       TEXT,
        subject_contains TEXT,
        time_start       TEXT,
        time_end         TEXT,
        enabled          BOOLEAN DEFAULT TRUE,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS threads (
        id               TEXT PRIMARY KEY,
        account_id       TEXT NOT NULL REFERENCES email_accounts(id),
        subject          TEXT,
        participants     JSONB DEFAULT '[]',
        message_count    INT DEFAULT 0,
        summary          TEXT,
        entities         JSONB,
        status           TEXT DEFAULT 'active',
        first_message_at TIMESTAMPTZ,
        last_message_at  TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_log (
        id               TEXT PRIMARY KEY,
        account_id       TEXT NOT NULL REFERENCES email_accounts(id),
        thread_id        TEXT REFERENCES threads(id),
        from_address     TEXT NOT NULL,
        sender_name      TEXT,
        subject          TEXT,
        body             TEXT,
        summary          TEXT,
        priority         TEXT DEFAULT 'medium',
        intent           TEXT,
        in_reply_to      TEXT,
        "references"     TEXT,
        received_at      TIMESTAMPTZ,
        agent_response   JSONB,
        llm_provider     TEXT,
        processing_ms    INT,
        user_action      TEXT,
        processed_at     TIMESTAMPTZ DEFAULT NOW(),
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email_log_id    TEXT NOT NULL REFERENCES email_log(id),
        account_id      TEXT NOT NULL REFERENCES email_accounts(id),
        prediction      JSONB,
        user_action     TEXT NOT NULL,
        user_correction JSONB,
        was_correct     BOOLEAN,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id    TEXT,
        account_id TEXT,
        action     TEXT NOT NULL,
        details    TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scheduled_emails (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_id TEXT NOT NULL REFERENCES email_accounts(id),
        email_id   TEXT REFERENCES email_log(id),
        to_address TEXT,
        subject    TEXT,
        body       TEXT,
        send_at    TIMESTAMPTZ NOT NULL,
        status     TEXT DEFAULT 'scheduled',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_templates (
        id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id          TEXT REFERENCES users(id),
        account_id       TEXT REFERENCES email_accounts(id),
        name             TEXT NOT NULL,
        description      TEXT,
        body_template    TEXT NOT NULL,
        tone             TEXT DEFAULT 'professional',
        times_used       INT DEFAULT 0,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS webhooks (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        url        TEXT NOT NULL,
        events     JSONB NOT NULL DEFAULT '[]',
        secret     TEXT NOT NULL,
        enabled    BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS analytics_daily (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_id      TEXT NOT NULL REFERENCES email_accounts(id),
        date            DATE NOT NULL,
        emails_received INT DEFAULT 0,
        emails_sent     INT DEFAULT 0,
        auto_replied    INT DEFAULT 0,
        UNIQUE (account_id, date)
      );`,

    '003_indexes': `
      CREATE INDEX IF NOT EXISTS idx_email_log_account ON email_log (account_id, processed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_threads_account   ON threads   (account_id, last_message_at DESC);
      CREATE INDEX IF NOT EXISTS idx_overrides_account ON sender_overrides (account_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_emails (send_at, status);`,

    '004_follow_ups': `
      CREATE TABLE IF NOT EXISTS follow_ups (
        id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_id            TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
        email_log_id          TEXT REFERENCES email_log(id) ON DELETE SET NULL,
        subject               TEXT,
        notes                 TEXT,
        follow_up_after_hours INT NOT NULL DEFAULT 24,
        status                TEXT DEFAULT 'pending',
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS macros (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES email_accounts(id) ON DELETE CASCADE,
        trigger    TEXT NOT NULL,
        expansion  TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`,

    '005_prompt_profiles': `
      CREATE TABLE IF NOT EXISTS prompt_profiles (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_id    TEXT REFERENCES email_accounts(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        description   TEXT,
        system_prompt TEXT NOT NULL,
        is_active     BOOLEAN DEFAULT FALSE,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE personas ADD COLUMN IF NOT EXISTS system_prompt TEXT;`,

    '006_prompt_scopes': `
      ALTER TABLE prompt_profiles
        ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global',
        ADD COLUMN IF NOT EXISTS intent_type TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_intent_prompt
        ON prompt_profiles (account_id, intent_type)
        WHERE scope = 'intent' AND intent_type IS NOT NULL;`,

    '007_persona_llm_base_url': `
      ALTER TABLE personas ADD COLUMN IF NOT EXISTS llm_base_url TEXT;`,

    '008_webhook_account_scope': `
      ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES email_accounts(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_webhooks_account ON webhooks (account_id) WHERE account_id IS NOT NULL;`,

    '009_memories': `
      CREATE TABLE IF NOT EXISTS memories (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
        type       TEXT NOT NULL,
        content    TEXT NOT NULL,
        source_id  TEXT REFERENCES email_log(id) ON DELETE SET NULL,
        importance REAL DEFAULT 0.5,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_memories_account ON memories (account_id, created_at DESC);`,

    '010_labels': `
      CREATE TABLE IF NOT EXISTS email_labels (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        color      TEXT DEFAULT '#6366f1',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (account_id, name)
      );
      CREATE TABLE IF NOT EXISTS email_log_labels (
        email_log_id TEXT NOT NULL REFERENCES email_log(id) ON DELETE CASCADE,
        label_id     TEXT NOT NULL REFERENCES email_labels(id) ON DELETE CASCADE,
        PRIMARY KEY (email_log_id, label_id)
      );`,

    '011_email_log_extras': `
      ALTER TABLE email_log ADD COLUMN IF NOT EXISTS unsubscribe_url TEXT;
      ALTER TABLE email_log ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;
      ALTER TABLE email_log ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]';`,
  };

  for (const [name, sql] of Object.entries(migrations)) {
    const { rows } = await pg.query(
      `SELECT 1 FROM _pg_migrations WHERE name = $1`, [name]
    );
    if (!rows.length) {
      await pg.query(sql);
      await pg.query(`INSERT INTO _pg_migrations (name) VALUES ($1)`, [name]);
      logger.info(`PG migration applied: ${name}`);
    }
  }

  logger.info('PostgreSQL schema ready');
}
