import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger } from '../../../utils/logger.ts';

const router = Router();

router.post('/scheduled', async (req, res) => {
  try {
    const { accountId, to, subject, body, sendAt } = req.body as {
      accountId: string; to: string; subject: string; body: string; sendAt: string;
    };
    if (!accountId || !to || !body || !sendAt) {
      res.status(400).json({ error: 'accountId, to, body, sendAt are required' }); return;
    }
    const parsedDate = new Date(sendAt);
    if (isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      res.status(400).json({ error: 'sendAt must be a future date' }); return;
    }
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO scheduled_emails (id, account_id, to_address, subject, body, send_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')`,
      [id, accountId, to, subject ?? '', body, parsedDate]
    );
    logger.info('Scheduled email created', { id, to, sendAt: parsedDate });
    res.status(201).json({ id, status: 'scheduled', sendAt: parsedDate });
  } catch (err) {
    logger.error('POST /scheduled error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/scheduled', async (req, res) => {
  try {
    const { accountId, status = 'scheduled' } = req.query as { accountId?: string; status?: string };
    let rows;
    if (accountId) {
      ({ rows } = await getPool().query(
        `SELECT * FROM scheduled_emails WHERE account_id = $1 AND status = $2
         ORDER BY send_at ASC LIMIT 100`,
        [accountId, status]
      ));
    } else {
      ({ rows } = await getPool().query(
        `SELECT * FROM scheduled_emails WHERE status = $1 ORDER BY send_at ASC LIMIT 100`,
        [status]
      ));
    }
    res.json(rows);
  } catch (err) {
    logger.error('GET /scheduled error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/scheduled/:id', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      'SELECT status FROM scheduled_emails WHERE id = $1', [req.params.id]
    );
    const row = rows[0];
    if (!row) { res.status(404).json({ error: 'Scheduled email not found' }); return; }
    if (row.status !== 'scheduled') {
      res.status(409).json({ error: `Cannot cancel — status is '${row.status}'` }); return;
    }
    await getPool().query(
      `UPDATE scheduled_emails SET status = 'cancelled' WHERE id = $1`, [req.params.id]
    );
    logger.info('Scheduled email cancelled', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /scheduled/:id error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
