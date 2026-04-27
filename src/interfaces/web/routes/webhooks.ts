import { Router } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger } from '../../../utils/logger.ts';

const router = Router();

const VALID_EVENTS = [
  'email.received', 'email.replied', 'email.ignored',
  'priority.critical', 'draft.created', 'account.error',
];

const PRIVATE_IP_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|0\.0\.0\.0|169\.254\.)/;

function isPrivateUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return true;
    return PRIVATE_IP_RE.test(u.hostname.toLowerCase());
  } catch { return true; }
}

router.get('/webhooks', async (_req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, url, events, enabled, created_at FROM webhooks ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    logger.error('GET /webhooks error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/webhooks', async (req, res) => {
  const { url, events, secret } = req.body as { url?: string; events?: string[]; secret?: string };
  if (!url || !events?.length) { res.status(400).json({ error: 'url and events[] are required' }); return; }

  const invalid = events.filter((e) => !VALID_EVENTS.includes(e));
  if (invalid.length) {
    res.status(400).json({ error: `Unknown events: ${invalid.join(', ')}` }); return;
  }
  try { new URL(url); } catch { res.status(400).json({ error: 'Invalid URL' }); return; }
  if (isPrivateUrl(url)) { res.status(400).json({ error: 'Webhook URL must be a public http/https address' }); return; }

  try {
    const id = randomUUID();
    const hookSecret = secret ?? randomBytes(32).toString('hex');
    await getPool().query(
      `INSERT INTO webhooks (id, url, events, secret, enabled) VALUES ($1,$2,$3,$4,$5)`,
      [id, url, JSON.stringify(events), hookSecret, true]
    );
    logger.info('Webhook registered', { id, url });
    const { rows } = await getPool().query('SELECT * FROM webhooks WHERE id = $1', [id]);
    res.status(201).json({ ...rows[0], secret: hookSecret });
  } catch (err) {
    logger.error('POST /webhooks error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/webhooks/:id', async (req, res) => {
  try {
    const result = await getPool().query('DELETE FROM webhooks WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Webhook not found' }); return; }
    res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /webhooks/:id error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.patch('/webhooks/:id', async (req, res) => {
  try {
    const { enabled, events } = req.body as { enabled?: boolean; events?: string[] };
    const pool = getPool();
    if (events) {
      const invalid = events.filter((e) => !VALID_EVENTS.includes(e));
      if (invalid.length) { res.status(400).json({ error: `Unknown events: ${invalid.join(', ')}` }); return; }
      await pool.query('UPDATE webhooks SET events = $1 WHERE id = $2', [JSON.stringify(events), req.params.id]);
    }
    if (enabled !== undefined) {
      await pool.query('UPDATE webhooks SET enabled = $1 WHERE id = $2', [enabled, req.params.id]);
    }
    const { rows } = await pool.query('SELECT * FROM webhooks WHERE id = $1', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Webhook not found' }); return; }
    res.json(rows[0]);
  } catch (err) {
    logger.error('PATCH /webhooks/:id error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
