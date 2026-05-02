import { randomUUID } from 'crypto';
import type { IStorage, QueryOpts } from './storage.interface.ts';
import { logger } from '../utils/logger.ts';

/**
 * PostgreSQL adapter — uses fully typed tables that mirror the SQLite schema.
 * Falls back to a generic kv_store for any collection not explicitly typed.
 */
export class PostgresStorage implements IStorage {
  private pool: any;

  constructor(private connectionString: string) {}

  async init(): Promise<void> {
    const { Pool } = await import('pg' as any);
    this.pool = new Pool({
      connectionString: this.connectionString,
      max: 10,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 60_000,
    });
    await this.runMigrations();
    logger.info('PostgresStorage initialized');
  }

  // ── IStorage ───────────────────────────────────────────────────────────────

  async get<T>(collection: string, id: string): Promise<T | null> {
    const typed = TYPED_TABLES[collection];
    if (typed) {
      const { rows } = await this.pool.query(
        `SELECT * FROM ${typed.table} WHERE id = $1`, [id]
      );
      return rows[0] ? (typed.fromRow(rows[0]) as T) : null;
    }
    const { rows } = await this.pool.query(
      `SELECT data FROM kv_store WHERE collection = $1 AND id = $2`, [collection, id]
    );
    return rows[0] ? (rows[0].data as T) : null;
  }

  async set<T>(collection: string, id: string, value: T): Promise<void> {
    const typed = TYPED_TABLES[collection];
    if (typed) {
      await typed.upsert(this.pool, id, value as any);
      return;
    }
    await this.pool.query(`
      INSERT INTO kv_store (collection, id, data, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [collection, id, JSON.stringify(value)]);
  }

  async delete(collection: string, id: string): Promise<void> {
    const typed = TYPED_TABLES[collection];
    if (typed) {
      await this.pool.query(`DELETE FROM ${typed.table} WHERE id = $1`, [id]);
      return;
    }
    await this.pool.query(
      `DELETE FROM kv_store WHERE collection = $1 AND id = $2`, [collection, id]
    );
  }

  async query<T>(collection: string, filter: Record<string, unknown>, opts?: QueryOpts): Promise<T[]> {
    const typed = TYPED_TABLES[collection];
    if (typed) {
      return typed.query(this.pool, filter, opts) as Promise<T[]>;
    }

    const conditions = Object.entries(filter)
      .map(([k, _], i) => `data->>'${k}' = $${i + 2}`)
      .join(' AND ');
    const where  = conditions ? `AND ${conditions}` : '';
    const order  = opts?.orderBy ? `ORDER BY data->>'${opts.orderBy}' ${opts.order ?? 'ASC'}` : '';
    const limit  = opts?.limit  ? `LIMIT ${opts.limit}`  : '';
    const offset = opts?.offset ? `OFFSET ${opts.offset}` : '';

    const { rows } = await this.pool.query(
      `SELECT data FROM kv_store WHERE collection = $1 ${where} ${order} ${limit} ${offset}`,
      [collection, ...Object.values(filter)],
    );
    return rows.map((r: any) => r.data as T);
  }

  async insert<T = unknown>(collection: string, data: T): Promise<string> {
    const id     = (data as any).id ?? randomUUID();
    const record = { ...data, id };
    await this.set(collection, id, record);
    return id;
  }

  async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
    const typed = TYPED_TABLES[collection];
    if (typed) {
      const setClauses = Object.keys(patch)
        .map((k, i) => `${camel2snake(k)} = $${i + 2}`)
        .join(', ');
      await this.pool.query(
        `UPDATE ${typed.table} SET ${setClauses}, updated_at = NOW() WHERE id = $1`,
        [id, ...Object.values(patch)]
      );
      return;
    }
    await this.pool.query(`
      UPDATE kv_store SET data = data || $3::jsonb, updated_at = NOW()
      WHERE collection = $1 AND id = $2
    `, [collection, id, JSON.stringify(patch)]);
  }

  async raw<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.pool.query(sql, params);
    return rows as T[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ── Migrations ─────────────────────────────────────────────────────────────

  private async runMigrations(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS _pg_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const migrations: Record<string, string> = {
      '001_kv_store':      PG_001_KV,
      '002_typed_tables':  PG_002_TYPED,
      '003_indexes':       PG_003_INDEXES,
      '004_webhooks':      PG_004_WEBHOOKS,
      '005_user_auth':     PG_005_USER_AUTH,
    };

    for (const [name, sql] of Object.entries(migrations)) {
      const { rows } = await this.pool.query(
        `SELECT 1 FROM _pg_migrations WHERE name = $1`, [name]
      );
      if (!rows.length) {
        await this.pool.query(sql);
        await this.pool.query(`INSERT INTO _pg_migrations (name) VALUES ($1)`, [name]);
        logger.info(`PG migration applied: ${name}`);
      }
    }
  }
}

// ── Typed table definitions ────────────────────────────────────────────────

interface TypedTable {
  table:   string;
  fromRow: (row: any) => any;
  upsert:  (pool: any, id: string, value: any) => Promise<void>;
  query:   (pool: any, filter: Record<string, unknown>, opts?: QueryOpts) => Promise<any[]>;
}

const TYPED_TABLES: Record<string, TypedTable> = {

  email_accounts: {
    table: 'email_accounts',
    fromRow: (r) => ({
      id: r.id, userId: r.user_id, emailAddress: r.email_address,
      displayName: r.display_name, accountType: r.account_type,
      credentialsEnc: r.credentials_enc, enabled: r.enabled,
      priority: r.priority, pollingIntervalMin: r.polling_interval_min,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }),
    upsert: async (pool, id, v) => pool.query(`
      INSERT INTO email_accounts (id, user_id, email_address, display_name, account_type,
        credentials_enc, enabled, priority, polling_interval_min)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name, account_type = EXCLUDED.account_type,
        credentials_enc = EXCLUDED.credentials_enc, enabled = EXCLUDED.enabled,
        priority = EXCLUDED.priority, updated_at = NOW()
    `, [id, v.userId, v.emailAddress, v.displayName ?? null, v.accountType,
        v.credentialsEnc ?? null, v.enabled ?? true, v.priority ?? 5, v.pollingIntervalMin ?? 5]),
    query: async (pool, filter, opts) => {
      const { rows } = await pool.query(
        `SELECT * FROM email_accounts WHERE enabled = true ORDER BY created_at DESC LIMIT $1`,
        [opts?.limit ?? 100]
      );
      return rows;
    },
  },

  personas: {
    table: 'personas',
    fromRow: (r) => ({
      id: r.id, accountId: r.account_id, tone: r.tone,
      useEmoji: r.use_emoji, language: r.language,
      autonomyLevel: r.autonomy_level, styleDna: r.style_dna,
      llmProvider: r.llm_provider, llmModel: r.llm_model,
      llmApiKeyEnc: r.llm_api_key_enc, shadowMode: r.shadow_mode,
      onboardingDone: r.onboarding_done,
    }),
    upsert: async (pool, id, v) => pool.query(`
      INSERT INTO personas (id, account_id, tone, use_emoji, language,
        autonomy_level, style_dna, llm_provider, llm_model, llm_api_key_enc,
        shadow_mode, onboarding_done)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (account_id) DO UPDATE SET
        tone = EXCLUDED.tone, use_emoji = EXCLUDED.use_emoji,
        language = EXCLUDED.language, autonomy_level = EXCLUDED.autonomy_level,
        style_dna = EXCLUDED.style_dna, llm_provider = EXCLUDED.llm_provider,
        llm_model = EXCLUDED.llm_model, llm_api_key_enc = EXCLUDED.llm_api_key_enc,
        shadow_mode = EXCLUDED.shadow_mode, onboarding_done = EXCLUDED.onboarding_done,
        updated_at = NOW()
    `, [id, v.accountId, v.tone ?? 'professional', v.useEmoji ?? false,
        v.language ?? 'auto', v.autonomyLevel ?? 'draft', v.styleDna ?? null,
        v.llmProvider ?? null, v.llmModel ?? null, v.llmApiKeyEnc ?? null,
        v.shadowMode ?? true, v.onboardingDone ?? false]),
    query: async (pool, filter) => {
      const { rows } = await pool.query(
        `SELECT * FROM personas WHERE account_id = $1`, [filter.accountId ?? filter.account_id]
      );
      return rows;
    },
  },

  email_log: {
    table: 'email_log',
    fromRow: (r) => r,
    upsert: async (pool, id, v) => pool.query(`
      INSERT INTO email_log (id, account_id, thread_id, original_sender, sender_name,
        subject, received_at, agent_response, parse_method, parse_confidence,
        processing_ms, llm_provider, llm_model, user_action)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO NOTHING
    `, [id, v.accountId, v.threadId ?? null, v.sender, v.senderName ?? null,
        v.subject ?? null, v.receivedAt ?? new Date(), JSON.stringify(v.agentResponse),
        v.parseMethod ?? null, v.parseConfidence ?? null, v.processingMs ?? null,
        v.llmProvider ?? null, v.llmModel ?? null, v.userAction ?? null]),
    query: async (pool, filter, opts) => {
      const { rows } = await pool.query(
        `SELECT * FROM email_log WHERE account_id = $1 ORDER BY processed_at DESC LIMIT $2 OFFSET $3`,
        [filter.accountId ?? filter.account_id, opts?.limit ?? 20, opts?.offset ?? 0]
      );
      return rows;
    },
  },

  threads: {
    table: 'threads',
    fromRow: (r) => ({ ...r, entities: r.entities ? JSON.parse(r.entities) : null }),
    upsert: async (pool, id, v) => pool.query(`
      INSERT INTO threads (id, account_id, subject, participants, message_count,
        summary, entities, status, first_message_at, last_message_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        message_count = EXCLUDED.message_count, summary = EXCLUDED.summary,
        entities = EXCLUDED.entities, status = EXCLUDED.status,
        last_message_at = EXCLUDED.last_message_at, updated_at = NOW()
    `, [id, v.accountId, v.subject ?? null, JSON.stringify(v.participants ?? []),
        v.messageCount ?? 0, v.summary ?? null,
        v.entities ? JSON.stringify(v.entities) : null,
        v.status ?? 'active', v.firstMessageAt ?? new Date(), v.lastMessageAt ?? new Date()]),
    query: async (pool, filter, opts) => {
      const { rows } = await pool.query(
        `SELECT * FROM threads WHERE account_id = $1 ORDER BY last_message_at DESC LIMIT $2`,
        [filter.accountId ?? filter.account_id, opts?.limit ?? 20]
      );
      return rows.map((r: any) => ({ ...r, entities: r.entities ? JSON.parse(r.entities) : null }));
    },
  },
};

// ── SQL migrations ─────────────────────────────────────────────────────────

const PG_001_KV = `
  CREATE TABLE IF NOT EXISTS kv_store (
    collection  TEXT NOT NULL,
    id          TEXT NOT NULL,
    data        JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (collection, id)
  );
`;

const PG_002_TYPED = `
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    telegram_id TEXT UNIQUE,
    name        TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
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
    style_samples   JSONB,
    style_dna       TEXT,
    llm_provider    TEXT,
    llm_model       TEXT,
    llm_api_key_enc TEXT,
    llm_base_url    TEXT,
    onboarding_done BOOLEAN DEFAULT FALSE,
    shadow_mode     BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sender_overrides (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    sender_email     TEXT,
    sender_domain    TEXT,
    priority         INT DEFAULT 0,
    autonomy_level   TEXT,
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
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL REFERENCES email_accounts(id),
    subject         TEXT,
    participants    JSONB DEFAULT '[]',
    message_count   INT DEFAULT 0,
    summary         TEXT,
    summary_at      TIMESTAMPTZ,
    entities        JSONB,
    status          TEXT DEFAULT 'active',
    waiting_on      TEXT,
    first_message_at TIMESTAMPTZ,
    last_message_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL REFERENCES email_accounts(id),
    thread_id        TEXT REFERENCES threads(id),
    original_sender  TEXT NOT NULL,
    sender_name      TEXT,
    subject          TEXT,
    received_at      TIMESTAMPTZ,
    parse_method     TEXT,
    parse_confidence REAL,
    agent_response   JSONB,
    llm_provider     TEXT,
    llm_model        TEXT,
    processing_ms    INT,
    user_action      TEXT,
    sent_at          TIMESTAMPTZ,
    processed_at     TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email_log_id    TEXT NOT NULL REFERENCES email_log(id),
    account_id      TEXT NOT NULL REFERENCES email_accounts(id),
    prediction      JSONB,
    user_action     TEXT NOT NULL,
    user_correction TEXT,
    was_correct     BOOLEAN,
    correction_type TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS scheduled_emails (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES email_accounts(id),
    to_address  TEXT NOT NULL,
    subject     TEXT,
    body        TEXT NOT NULL,
    send_at     TIMESTAMPTZ NOT NULL,
    status      TEXT DEFAULT 'pending',
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS email_templates (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id),
    account_id       TEXT REFERENCES email_accounts(id),
    name             TEXT NOT NULL,
    description      TEXT,
    trigger_intents  JSONB,
    trigger_keywords JSONB,
    trigger_domain   TEXT,
    trigger_subject  TEXT,
    subject_template TEXT,
    body_template    TEXT NOT NULL,
    tone             TEXT DEFAULT 'professional',
    language         TEXT DEFAULT 'auto',
    variables        JSONB,
    times_used       INT DEFAULT 0,
    acceptance_rate  REAL DEFAULT 0,
    last_used_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS analytics_daily (
    id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    account_id     TEXT NOT NULL REFERENCES email_accounts(id),
    date           DATE NOT NULL,
    emails_received INT DEFAULT 0,
    emails_sent    INT DEFAULT 0,
    auto_replied   INT DEFAULT 0,
    avg_response_min REAL,
    saved_time_min REAL,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (account_id, date)
  );
`;

const PG_003_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_email_log_account   ON email_log (account_id, processed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_email_log_thread    ON email_log (thread_id);
  CREATE INDEX IF NOT EXISTS idx_threads_account     ON threads (account_id, last_message_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedback_account    ON feedback (account_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sender_overrides    ON sender_overrides (account_id, enabled);
  CREATE INDEX IF NOT EXISTS idx_scheduled_pending   ON scheduled_emails (send_at, status);
  CREATE INDEX IF NOT EXISTS idx_kv_collection       ON kv_store (collection);
`;

const PG_004_WEBHOOKS = `
  CREATE TABLE IF NOT EXISTS webhooks (
    id                   TEXT PRIMARY KEY,
    url                  TEXT NOT NULL,
    events               JSONB NOT NULL DEFAULT '[]',
    secret               TEXT NOT NULL,
    enabled              BOOLEAN DEFAULT TRUE,
    delivery_count       INT DEFAULT 0,
    failure_count        INT DEFAULT 0,
    last_delivery_at     TIMESTAMPTZ,
    last_delivery_status INT,
    created_at           TIMESTAMPTZ DEFAULT NOW()
  );
`;

const PG_005_USER_AUTH = `
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username      TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
`;

// ── utils ──────────────────────────────────────────────────────────────────

function camel2snake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
