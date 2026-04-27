import { Router } from 'express';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger } from '../../../utils/logger.ts';

const router = Router();

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
