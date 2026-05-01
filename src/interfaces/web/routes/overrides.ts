import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger } from '../../../utils/logger.ts';

const router = Router();

const PATCHABLE_COLUMNS = new Set([
  'sender_email', 'sender_domain', 'priority', 'autonomy_level', 'tone',
  'prompt_template', 'auto_reply', 'forward_to', 'subject_contains',
  'time_start', 'time_end', 'enabled',
]);

const VALID_AUTONOMY = ['suggest', 'auto_reply', 'full_auto'];

function validateEmail(v: unknown): boolean {
  return typeof v === 'string'
    && v.length <= 320
    && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(v);
}
function validateDomain(v: unknown): boolean {
  return typeof v === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
}

router.get('/accounts/:id/overrides', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT * FROM sender_overrides
       WHERE account_id = $1 ORDER BY priority DESC, created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error('GET /overrides error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/accounts/:id/overrides', async (req, res) => {
  const body = req.body as Record<string, any>;
  if (body.sender_email  && !validateEmail(body.sender_email))   { res.status(400).json({ error: 'Invalid sender_email'  }); return; }
  if (body.sender_domain && !validateDomain(body.sender_domain)) { res.status(400).json({ error: 'Invalid sender_domain' }); return; }
  if (body.autonomy_level && !VALID_AUTONOMY.includes(body.autonomy_level)) {
    res.status(400).json({ error: `autonomy_level must be one of: ${VALID_AUTONOMY.join(', ')}` }); return;
  }
  if (body.forward_to && !validateEmail(body.forward_to)) { res.status(400).json({ error: 'Invalid forward_to' }); return; }

  try {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO sender_overrides
         (id, account_id, sender_email, sender_domain, priority, autonomy_level, tone,
          prompt_template, auto_reply, forward_to, subject_contains, time_start, time_end, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, req.params.id,
        body.sender_email     ?? null,
        body.sender_domain    ?? null,
        body.priority         ?? 0,
        body.autonomy_level   ?? 'suggest',
        body.tone             ?? null,
        body.prompt_template  ?? null,
        body.auto_reply       === true,
        body.forward_to       ?? null,
        body.subject_contains ?? null,
        body.time_start       ?? null,
        body.time_end         ?? null,
        body.enabled !== false,
      ]
    );
    const { rows } = await getPool().query('SELECT * FROM sender_overrides WHERE id = $1', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('POST /overrides error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.patch('/accounts/:id/overrides/:overrideId', async (req, res) => {
  const body = req.body as Record<string, any>;
  if (body.sender_email  && !validateEmail(body.sender_email))   { res.status(400).json({ error: 'Invalid sender_email'  }); return; }
  if (body.sender_domain && !validateDomain(body.sender_domain)) { res.status(400).json({ error: 'Invalid sender_domain' }); return; }
  if (body.autonomy_level && !VALID_AUTONOMY.includes(body.autonomy_level)) {
    res.status(400).json({ error: `autonomy_level must be one of: ${VALID_AUTONOMY.join(', ')}` }); return;
  }
  if (body.forward_to && !validateEmail(body.forward_to)) { res.status(400).json({ error: 'Invalid forward_to' }); return; }

  try {
    const { rows: existing } = await getPool().query(
      'SELECT id FROM sender_overrides WHERE id = $1 AND account_id = $2',
      [req.params.overrideId, req.params.id]
    );
    if (!existing.length) { res.status(404).json({ error: 'Override not found' }); return; }

    const candidate: Record<string, any> = {
      sender_email: body.sender_email, sender_domain: body.sender_domain,
      priority: body.priority, autonomy_level: body.autonomy_level, tone: body.tone,
      prompt_template: body.prompt_template,
      auto_reply:  body.auto_reply  !== undefined ? body.auto_reply === true : undefined,
      forward_to: body.forward_to, subject_contains: body.subject_contains,
      time_start: body.time_start, time_end: body.time_end,
      enabled: body.enabled !== undefined ? body.enabled === true : undefined,
    };

    const fields = Object.entries(candidate)
      .filter(([k, v]) => v !== undefined && PATCHABLE_COLUMNS.has(k));

    if (!fields.length) {
      const { rows } = await getPool().query('SELECT * FROM sender_overrides WHERE id = $1', [req.params.overrideId]);
      res.json(rows[0]); return;
    }

    const setClauses = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    await getPool().query(
      `UPDATE sender_overrides SET ${setClauses} WHERE id = $${fields.length + 1}`,
      [...fields.map(([, v]) => v), req.params.overrideId]
    );

    const { rows } = await getPool().query('SELECT * FROM sender_overrides WHERE id = $1', [req.params.overrideId]);
    res.json(rows[0]);
  } catch (err) {
    logger.error('PATCH /overrides error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/accounts/:id/overrides/:overrideId', async (req, res) => {
  try {
    const result = await getPool().query(
      'DELETE FROM sender_overrides WHERE id = $1 AND account_id = $2',
      [req.params.overrideId, req.params.id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Override not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /overrides error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
