import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getPool } from '../../../storage/pg-pool.ts';
import { FeedbackRepo } from '../../../storage/sqlite.adapter.ts';
import { logger } from '../../../utils/logger.ts';

const router = Router();

const ALLOWED_LLM_PROVIDERS = ['openrouter', 'openai', 'gemini', 'claude', 'ollama', 'custom', 'grok'] as const;

async function resolveAccountId(emailId: string, hint?: string): Promise<string> {
  if (hint) return hint;
  const { rows } = await getPool().query(
    'SELECT account_id FROM email_log WHERE id = $1', [emailId]
  );
  return rows[0]?.account_id ?? 'unknown';
}

router.post('/actions/send', async (req, res) => {
  const { emailId, accountId } = req.body as { emailId: string; accountId?: string };
  try {
    const aid = await resolveAccountId(emailId, accountId);
    await FeedbackRepo.insert({
      emailLogId: emailId, accountId: aid,
      prediction: {} as any, userAction: 'sent_as_is', wasCorrect: true, createdAt: new Date(),
    });
    await getPool().query(`UPDATE email_log SET user_action = 'sent_as_is' WHERE id = $1`, [emailId]);
    logger.info('User sent email as-is', { emailId });
    res.json({ ok: true });
  } catch (err) {
    logger.error('send action error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/actions/ignore', async (req, res) => {
  const { emailId, accountId } = req.body as { emailId: string; accountId?: string };
  try {
    const aid = await resolveAccountId(emailId, accountId);
    await FeedbackRepo.insert({
      emailLogId: emailId, accountId: aid,
      prediction: {} as any, userAction: 'ignored', wasCorrect: undefined, createdAt: new Date(),
    });
    await getPool().query(`UPDATE email_log SET user_action = 'ignored' WHERE id = $1`, [emailId]);
    logger.info('User ignored email', { emailId });
    res.json({ ok: true });
  } catch (err) {
    logger.error('ignore action error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/templates', async (_req, res) => {
  try {
    const { rows } = await getPool().query('SELECT * FROM email_templates ORDER BY times_used DESC');
    res.json(rows);
  } catch (err) {
    logger.error('list templates error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/templates', async (req, res) => {
  const { name, description, body_template, tone, account_id } = req.body as {
    name?: string; description?: string; body_template?: string;
    tone?: string; account_id?: string;
  };
  if (!name?.trim() || !body_template?.trim()) {
    res.status(400).json({ error: 'name and body_template are required' }); return;
  }
  try {
    const { rows } = await getPool().query(
      `INSERT INTO email_templates (name, description, body_template, tone, account_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name.trim(), description?.trim() ?? null, body_template.trim(),
       tone ?? 'professional', account_id ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('create template error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/templates/:id/test', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      'SELECT * FROM email_templates WHERE id = $1', [req.params.id]
    );
    const row = rows[0];
    if (!row) { res.status(404).json({ error: 'Template not found' }); return; }

    // Accept both array [{key,value}] directly as body, or {variables: [...]} wrapper
    const rawVars = Array.isArray(req.body) ? req.body : (req.body.variables ?? req.body ?? []);
    const variables: Record<string, string> = {};
    if (Array.isArray(rawVars)) {
      for (const item of rawVars) {
        if (typeof item?.key === 'string' && typeof item?.value === 'string'
          && item.key.length <= 64 && item.value.length <= 2048) {
          variables[item.key] = item.value;
        }
      }
    } else {
      for (const [k, v] of Object.entries(rawVars)) {
        if (typeof k === 'string' && typeof v === 'string' && k.length <= 64 && v.length <= 2048) {
          variables[k] = v;
        }
      }
    }
    let rendered = row.body_template as string;
    for (const [k, v] of Object.entries(variables)) {
      rendered = rendered.replaceAll(`{{${k}}}`, v);
    }
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');
    res.json({ rendered, subject: row.subject_template ?? null });
  } catch (err) {
    logger.error('template test error', { err });
    res.status(400).json({ error: 'Template render failed' });
  }
});

router.get('/accounts/:id/persona', async (req, res) => {
  try {
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { Encryption }        = await import('../../../security/encryption.ts');
    const enc     = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds   = new CredentialManager(enc);
    const manager = new PersonaManager(creds);
    const persona = await manager.get(req.params.id);
    const { llmConfig, ...rest } = persona;
    res.json({ ...rest, llmProvider: llmConfig.provider, llmModel: llmConfig.model, hasApiKey: Boolean(llmConfig.apiKey) });
  } catch (err) {
    logger.error('persona GET error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.patch('/accounts/:id/persona', async (req, res) => {
  try {
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { Encryption }        = await import('../../../security/encryption.ts');
    const enc     = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds   = new CredentialManager(enc);
    const manager = new PersonaManager(creds);

    const patch: any = {};
    if (req.body.tone          != null) patch.tone          = req.body.tone;
    if (req.body.autonomyLevel != null) patch.autonomyLevel = req.body.autonomyLevel;
    if (req.body.language      != null) patch.language      = req.body.language;
    if (req.body.useEmoji      != null) patch.useEmoji      = req.body.useEmoji;
    await manager.update(req.params.id, patch);

    if (req.body.llmProvider || req.body.llmModel) {
      const provider = req.body.llmProvider;
      if (provider && !(ALLOWED_LLM_PROVIDERS as readonly string[]).includes(provider)) {
        res.status(400).json({ error: `Invalid llmProvider. Must be one of: ${ALLOWED_LLM_PROVIDERS.join(', ')}` });
        return;
      }
      await manager.setLLMConfig(req.params.id, {
        provider, model: req.body.llmModel, apiKey: req.body.llmApiKey,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error('persona update error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── IMAP connection tester ────────────────────────────────────────────────────

function imapErrorMessage(raw: string): string {
  if (/Invalid credentials|AUTHENTICATIONFAILED|authentication failed/i.test(raw))
    return 'Authentication failed. For Gmail, create an App Password (Google Account → Security → 2-Step Verification → App passwords) — regular passwords are blocked.';
  if (/ECONNREFUSED|Connection refused/i.test(raw))
    return 'Connection refused. Make sure IMAP is enabled in your email settings (Gmail: Settings → See all settings → Forwarding and POP/IMAP).';
  if (/ENOTFOUND|getaddrinfo/i.test(raw))
    return 'Host not found. Double-check the IMAP server address.';
  if (/ETIMEDOUT|timed out/i.test(raw))
    return 'Connection timed out. Check the host and port — for Gmail use imap.gmail.com:993.';
  if (/CERT|certificate|TLS|SSL/i.test(raw))
    return 'SSL/TLS error. Try port 993 with TLS or port 143 without.';
  return `Connection failed: ${raw}`;
}

async function testImap(cfg: { host: string; port: number; user: string; pass: string }): Promise<void> {
  const { default: Imap } = await import('imap');
  return new Promise<void>((resolve, reject) => {
    const imap = new (Imap as any)({
      user: cfg.user, password: cfg.pass,
      host: cfg.host, port: cfg.port,
      tls: cfg.port === 993,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10_000,
      connTimeout: 10_000,
    });
    imap.once('ready', () => { imap.end(); resolve(); });
    imap.once('error', (err: Error) => reject(err));
    imap.connect();
  });
}

// POST /accounts/test-connection — test IMAP before saving
router.post('/accounts/test-connection', async (req, res) => {
  const { host, port, user, pass } = req.body as {
    host?: string; port?: number; user?: string; pass?: string;
  };
  if (!host || !port || !user || !pass) {
    res.status(400).json({ ok: false, error: 'host, port, user, pass are required' }); return;
  }
  try {
    await testImap({ host, port: Number(port), user, pass });
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: imapErrorMessage(err.message ?? String(err)) });
  }
});

// POST /accounts — create and optionally verify first
router.post('/accounts', async (req, res) => {
  try {
    const { email_address, display_name, account_type = 'imap', credentials } = req.body as {
      email_address?: string; display_name?: string; account_type?: string;
      credentials?: { imap_host?: string; imap_port?: number; imap_user?: string; imap_pass?: string };
    };
    if (!email_address) { res.status(400).json({ error: 'email_address required' }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_address)) {
      res.status(400).json({ error: 'Invalid email_address format' }); return;
    }
    const VALID_TYPES = ['imap', 'gmail', 'smtp', 'forward'];
    if (!VALID_TYPES.includes(account_type)) {
      res.status(400).json({ error: `account_type must be one of: ${VALID_TYPES.join(', ')}` }); return;
    }

    // Test IMAP connection before saving
    if (account_type === 'imap' && credentials?.imap_pass) {
      const cfg = {
        host: credentials.imap_host ?? 'imap.gmail.com',
        port: credentials.imap_port ?? 993,
        user: credentials.imap_user ?? email_address,
        pass: credentials.imap_pass,
      };
      try {
        await testImap(cfg);
      } catch (err: any) {
        res.status(422).json({ error: imapErrorMessage(err.message ?? String(err)) }); return;
      }
    }

    const pool = getPool();
    const { rows: existing } = await pool.query(
      'SELECT id FROM email_accounts WHERE email_address = $1', [email_address]
    );
    if (existing.length) { res.status(409).json({ error: 'Account already exists' }); return; }

    const { rows: users } = await pool.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { res.status(400).json({ error: 'No user registered' }); return; }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO email_accounts (id, user_id, email_address, display_name, account_type)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, users[0].id, email_address, display_name ?? email_address, account_type]
    );

    // Encrypt and persist IMAP credentials
    if (account_type === 'imap' && credentials?.imap_pass) {
      const { Encryption }        = await import('../../../security/encryption.ts');
      const { CredentialManager } = await import('../../../security/credential-manager.ts');
      const enc  = new Encryption(process.env.ENCRYPTION_KEY!);
      const cred = new CredentialManager(enc);
      await cred.storeEmailCredentials(id, {
        host:   credentials.imap_host ?? 'imap.gmail.com',
        port:   credentials.imap_port ?? 993,
        secure: (credentials.imap_port ?? 993) === 993,
        user:   credentials.imap_user ?? email_address,
        pass:   credentials.imap_pass,
      });
    }

    logger.info('Account created', { id, email_address, account_type });
    res.status(201).json({ account_id: id, email_address, account_type });
  } catch (err) {
    logger.error('POST /accounts error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /accounts/:id/style-dna — extract writing style from sample emails
router.post('/accounts/:id/style-dna', async (req, res) => {
  try {
    const { id } = req.params;
    const { samples } = req.body as { samples?: string[] };
    if (!samples?.length || samples.length < 1) {
      res.status(400).json({ error: 'At least one sample email required' }); return;
    }

    const { Encryption }        = await import('../../../security/encryption.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const { StyleExtractor }    = await import('../../../persona/style-extractor.ts');
    const { LLMRouter }         = await import('../../../llm/router.ts');

    const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);
    const persona  = await personas.get(id);

    const llm       = new LLMRouter(persona.llmConfig);
    const extractor = new StyleExtractor(llm);
    const dna       = await extractor.extract(samples);

    await personas.update(id, { styleDna: dna });

    logger.info('Style DNA extracted', { accountId: id, length: dna.length });
    res.json({ styleDna: dna });
  } catch (err) {
    logger.error('POST /accounts/:id/style-dna error', { err });
    res.status(500).json({ error: 'Style DNA extraction failed' });
  }
});

export default router;
