import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger } from '../../../utils/logger.ts';

const router = Router();

const VALID_STATUSES = ['scheduled', 'sent', 'cancelled', 'failed'] as const;

async function assertOwnsAccount(accountId: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'SELECT 1 FROM email_accounts WHERE id = $1 AND user_id = $2',
    [accountId, userId]
  );
  return (rowCount ?? 0) > 0;
}

router.post('/scheduled', async (req, res) => {
  try {
    const { accountId, to, subject, body, sendAt } = req.body as {
      accountId: string; to: string; subject: string; body: string; sendAt: string;
    };
    if (!accountId || !to || !body || !sendAt) {
      res.status(400).json({ error: 'accountId, to, body, sendAt are required' }); return;
    }
    // M03: validate recipient email address
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 320) {
      res.status(400).json({ error: 'Invalid to address' }); return;
    }
    const parsedDate = new Date(sendAt);
    if (isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      res.status(400).json({ error: 'sendAt must be a future date' }); return;
    }
    // B07: verify the authenticated user owns the account
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }

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
    const { accountId, status: rawStatus = 'scheduled' } = req.query as { accountId?: string; status?: string };
    // M04: allowlist on status to prevent unexpected query results
    const status = VALID_STATUSES.includes(rawStatus as any) ? rawStatus : 'scheduled';
    const userId = (req as any).user?.sub;
    let rows;
    if (accountId) {
      // Verify the requested account belongs to the authenticated user
      ({ rows } = await getPool().query(
        `SELECT se.* FROM scheduled_emails se
         JOIN email_accounts ea ON ea.id = se.account_id
         WHERE se.account_id = $1 AND se.status = $2 AND ea.user_id = $3
         ORDER BY se.send_at ASC LIMIT 100`,
        [accountId, status, userId]
      ));
    } else {
      // Scope to all accounts owned by the authenticated user
      ({ rows } = await getPool().query(
        `SELECT se.* FROM scheduled_emails se
         JOIN email_accounts ea ON ea.id = se.account_id
         WHERE se.status = $1 AND ea.user_id = $2
         ORDER BY se.send_at ASC LIMIT 100`,
        [status, userId]
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
    const userId = (req as any).user?.sub;
    // Join email_accounts to verify the authenticated user owns this scheduled email
    const { rows } = await getPool().query(
      `SELECT se.status FROM scheduled_emails se
       JOIN email_accounts ea ON ea.id = se.account_id
       WHERE se.id = $1 AND ea.user_id = $2`,
      [req.params.id, userId]
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
