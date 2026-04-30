import { Router } from 'express';
import { getPool } from '../../../storage/pg-pool.ts';
import { AnalyticsEngine } from '../../../analytics/analytics-engine.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { LLMRouter } from '../../../llm/router.ts';
import { PluginManager } from '../../../plugins/plugin-manager.ts';
import { PluginBuilderService } from '../../../plugins/builder/plugin-builder.service.ts';
import { createPluginRouter } from './plugins.ts';
import actionsRouter    from './actions.ts';
import emailsRouter     from './emails.ts';
import scheduledRouter  from './scheduled.ts';
import overridesRouter  from './overrides.ts';
import webhooksRouter   from './webhooks.ts';
import playgroundRouter    from './playground.ts';
import promptsRouter       from './prompts.ts';
import authRouter          from './auth.ts';
import intelligenceRouter  from './intelligence.ts';
import chatRouter          from './chat.ts';

// Singleton plugin service — built from env vars, shared across requests
const _llmRouter = new LLMRouter({
  provider: (process.env.LLM_PROVIDER ?? 'openrouter') as any,
  apiKey:   process.env.LLM_API_KEY ?? '',
  model:    process.env.LLM_MODEL   ?? 'google/gemini-flash-1.5',
  baseUrl:  process.env.LLM_BASE_URL,
});
const _pluginManager = new PluginManager();
const _pluginService = new PluginBuilderService(_llmRouter, _pluginManager);
const pluginsRouter  = createPluginRouter(_pluginService);

const router    = Router();
const analytics = new AnalyticsEngine();

// Auth endpoints — public
router.use(authRouter);

// Demo status — public (frontend reads before auth)
router.get('/demo/status', (_req, res) => {
  res.json({ demo: process.env.DEMO_MODE === 'true' });
});

// Everything below requires a valid JWT
router.use(requireAuth);

router.use(actionsRouter);
router.use(emailsRouter);
router.use(scheduledRouter);
router.use(overridesRouter);
router.use(webhooksRouter);
router.use(playgroundRouter);
router.use(promptsRouter);
router.use(intelligenceRouter);
router.use(chatRouter);
router.use('/plugins', pluginsRouter);

// ── Accounts ────────────────────────────────────────────────────────────────

router.get('/accounts', async (_req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id AS account_id, email_address, account_type AS provider
       FROM email_accounts WHERE enabled = TRUE ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/accounts/:id/stats', async (req, res) => {
  try {
    res.json(await analytics.getAccountStats(req.params.id));
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/accounts/:id/emails', async (req, res) => {
  try {
    const page = Math.max(1, Math.min(1000, parseInt((req.query.page as string) ?? '1', 10)));
    const { rows } = await getPool().query(
      `SELECT id, account_id, thread_id, from_address, sender_name, subject,
              summary, priority, intent, agent_response, user_action,
              processed_at AS created_at
       FROM email_log WHERE account_id = $1
       ORDER BY processed_at DESC LIMIT 20 OFFSET $2`,
      [req.params.id, (page - 1) * 20]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/accounts/:id/threads', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT t.*, COUNT(m.id)::int AS message_count
       FROM threads t
       LEFT JOIN email_log m ON m.thread_id = t.id
       WHERE t.account_id = $1
       GROUP BY t.id
       ORDER BY t.last_message_at DESC NULLS LAST
       LIMIT 20`,
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/accounts/:id/templates', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT * FROM email_templates
       WHERE account_id = $1 OR account_id IS NULL
       ORDER BY times_used DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Templates CRUD ──────────────────────────────────────────────────────────

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
      `INSERT INTO email_templates (name, description, body_template, tone, account_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name.trim(), description?.trim() ?? null, body_template.trim(),
       tone ?? 'professional', account_id ?? null, (req as any).userId ?? null]
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.patch('/templates/:id', async (req, res) => {
  const { name, description, body_template, tone } = req.body as {
    name?: string; description?: string; body_template?: string; tone?: string;
  };
  try {
    const { rows } = await getPool().query(
      `UPDATE email_templates
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           body_template = COALESCE($3, body_template),
           tone = COALESCE($4, tone),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name ?? null, description ?? null, body_template ?? null, tone ?? null, req.params.id]
    );
    if (!rows.length) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const result = await getPool().query('DELETE FROM email_templates WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/templates/:id/test', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      'SELECT body_template FROM email_templates WHERE id = $1', [req.params.id]
    );
    if (!rows.length) { res.status(404).json({ error: 'Template not found' }); return; }

    const vars: Array<{ key: string; value: string }> = Array.isArray(req.body)
      ? req.body
      : Object.entries(req.body || {}).map(([key, value]) => ({ key, value: String(value) }));

    let rendered = rows[0].body_template as string;
    for (const { key, value } of vars) {
      // Use plain string replacement to avoid regex injection via user-controlled key.
      rendered = rendered.replaceAll(`{{${key}}}`, value);
    }
    // bump times_used
    await getPool().query('UPDATE email_templates SET times_used = times_used + 1 WHERE id = $1', [req.params.id]);
    res.json({ rendered });
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Account management ──────────────────────────────────────────────────────

router.get('/accounts/:id/persona', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      'SELECT * FROM personas WHERE account_id = $1', [req.params.id]
    );
    const row = rows[0];
    res.json({
      tone:          row?.tone          ?? 'professional',
      autonomyLevel: row?.autonomy_level ?? 'draft',
      language:      row?.language      ?? 'auto',
      useEmoji:      Boolean(row?.use_emoji),
      llmProvider:   row?.llm_provider  ?? process.env.LLM_PROVIDER ?? 'openrouter',
      llmModel:      row?.llm_model     ?? process.env.LLM_MODEL ?? '',
      shadowMode:    Boolean(row?.shadow_mode),
    });
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Integrations info ───────────────────────────────────────────────────────

router.get('/integrations', (_req, res) => {
  res.json({
    telegramEnabled: !!process.env.TELEGRAM_BOT_TOKEN,
    smtpEnabled:     !!process.env.SMTP_PORT || true,
    smtpPort:        Number(process.env.SMTP_PORT ?? 2525),
    apiBaseUrl:      process.env.PUBLIC_URL ?? '',
  });
});

export default router;
