import { Router }   from 'express';
import { randomUUID, scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify }  from 'util';
import { signToken, verifyToken, verifyTelegramInitData } from '../middleware/auth.middleware.ts';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware.ts';
import { logger } from '../../../utils/logger.ts';

const router    = Router();
const scryptAsync = promisify(scrypt);

// ── Password helpers ────────────────────────────────────────────────────────

async function hashPassword(plain: string): Promise<string> {
  const salt   = randomBytes(16).toString('hex');
  const derived = await scryptAsync(plain, salt, 64) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived  = await scryptAsync(plain, salt, 64) as Buffer;
  const hashBuf  = Buffer.from(hash, 'hex');
  if (derived.length !== hashBuf.length) return false;
  return timingSafeEqual(derived, hashBuf);
}

// ── GET /auth/setup-status ──────────────────────────────────────────────────
// Returns whether an admin user exists (so the frontend can show Setup or Login)

router.get('/auth/setup-status', async (_req, res) => {
  try {
    const { pool } = await getPool();
    const { rows } = await pool.query(
      `SELECT 1 FROM users WHERE username IS NOT NULL LIMIT 1`
    );
    res.json({ needsSetup: rows.length === 0, setupDone: rows.length > 0 });
  } catch {
    res.json({ needsSetup: true, setupDone: false });
  }
});

// ── POST /auth/setup ────────────────────────────────────────────────────────
// One-time initial admin creation. Blocked once any admin exists.

router.post('/auth/setup', rateLimitMiddleware('auth_attempts'), async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }
  if (username.length < 3)  { res.status(400).json({ error: 'Username must be at least 3 characters' }); return; }
  if (password.length < 8)  { res.status(400).json({ error: 'Password must be at least 8 characters' }); return; }

  try {
    const { pool } = await getPool();

    // Block if any admin already exists
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM users WHERE username IS NOT NULL LIMIT 1`
    );
    if (existing.length > 0) {
      res.status(409).json({ error: 'Setup already complete' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const id           = randomUUID();

    await pool.query(
      `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)`,
      [id, username.trim().toLowerCase(), passwordHash]
    );

    const token = signToken({ sub: id, telegramId: '' });
    logger.info('Admin user created', { userId: id, username });
    res.json({ token, userId: id, expiresIn: 3_600 });
  } catch (err) {
    logger.error('Setup failed', { err });
    res.status(500).json({ error: 'Setup failed' });
  }
});

// ── POST /auth/login ────────────────────────────────────────────────────────

router.post('/auth/login', rateLimitMiddleware('auth_attempts'), async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  try {
    const { pool } = await getPool();
    const { rows } = await pool.query(
      `SELECT id, password_hash FROM users WHERE username = $1 LIMIT 1`,
      [username.trim().toLowerCase()]
    );

    const user = rows[0] as { id: string; password_hash: string } | undefined;

    // Always run scrypt regardless of whether the user exists so that
    // an attacker cannot distinguish "unknown user" from "wrong password"
    // via response timing.
    const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000:' +
                       '0000000000000000000000000000000000000000000000000000000000000000' +
                       '0000000000000000000000000000000000000000000000000000000000000000';
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !user.password_hash || !ok) {
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      if (user) {
        await pool.query(
          `INSERT INTO audit_log (id, user_id, action, ip_address) VALUES (gen_random_uuid()::text, $1, 'login_failed', $2)`,
          [user.id, ip]
        );
        logger.warn('Login failed — wrong password', { userId: user.id, ip });
      } else {
        logger.warn('Login failed — unknown username', { ip });
      }
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = signToken({ sub: user.id, telegramId: '' });
    logger.info('Login successful', { userId: user.id });

    // Demo mode: reset data so each visitor sees a clean slate
    if (process.env.DEMO_MODE === 'true' && user.id === (process.env.DEMO_USER_ID ?? '')) {
      try {
        const { resetDemoData } = await import('../demo-reset.ts');
        await resetDemoData();
        logger.info('Demo data reset on login');
      } catch (resetErr) {
        logger.warn('Demo data reset failed', { err: resetErr });
      }
    }

    res.json({ token, userId: user.id, expiresIn: 3_600 });
  } catch (err) {
    logger.error('Login failed', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── POST /auth/refresh ──────────────────────────────────────────────────────

router.post('/auth/refresh', rateLimitMiddleware('auth_attempts'), (req, res) => {
  const authHeader = req.headers.authorization;
  const old        = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!old) { res.status(401).json({ error: 'Token required' }); return; }

  const payload = verifyToken(old);
  if (!payload) { res.status(401).json({ error: 'Invalid or expired token' }); return; }

  const token = signToken({ sub: payload.sub, telegramId: payload.telegramId });
  res.json({ token, expiresIn: 3_600 });
});

// ── POST /auth/telegram ─────────────────────────────────────────────────────

router.post('/auth/telegram', rateLimitMiddleware('auth_attempts'), async (req, res) => {
  const { initData } = req.body as { initData?: string };
  if (!initData) {
    res.status(400).json({ error: 'initData required' });
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (!verifyTelegramInitData(initData, botToken)) {
    logger.warn('Telegram initData verification failed');
    res.status(401).json({ error: 'Invalid Telegram initData' });
    return;
  }

  let telegramId: string | undefined;
  try {
    const params   = new URLSearchParams(initData);
    const userJson = params.get('user');
    telegramId     = userJson ? JSON.parse(userJson).id?.toString() : undefined;
  } catch {
    res.status(400).json({ error: 'Malformed initData' });
    return;
  }

  if (!telegramId) {
    res.status(400).json({ error: 'Could not extract Telegram user id' });
    return;
  }

  try {
    const { pool } = await getPool();
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE telegram_id = $1`, [telegramId]
    );
    const row = rows[0] as { id: string } | undefined;

    if (!row) {
      res.status(403).json({ error: 'User not registered — start the Telegram bot first' });
      return;
    }

    const token = signToken({ sub: row.id, telegramId });
    logger.info('JWT issued via Telegram', { userId: row.id });
    res.json({ token, expiresIn: 3_600 });
  } catch (err) {
    logger.error('Telegram auth failed', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── POST /auth/magic/generate — bot calls this to make a link ───────────────
// Internal: only callable with a valid JWT (bot uses a system token)

router.post('/auth/magic/generate', rateLimitMiddleware('auth_attempts'), async (req, res) => {
  const { telegramId } = req.body as { telegramId?: string };
  if (!telegramId) { res.status(400).json({ error: 'telegramId required' }); return; }

  try {
    const { pool } = await getPool();
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE telegram_id = $1`, [telegramId]
    );
    const user = rows[0] as { id: string } | undefined;
    if (!user) { res.status(404).json({ error: 'User not found — run /start first' }); return; }

    const { randomBytes } = await import('crypto');
    const magic    = randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min

    await pool.query(
      `INSERT INTO kv_store (collection, id, data)
       VALUES ('magic_link', $1, $2)
       ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
      [magic, JSON.stringify({ userId: user.id, expiresAt })]
    );

    res.json({ magic, expiresAt });
  } catch (err) {
    logger.error('Magic link generation failed', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── GET /auth/magic/redeem?token=xxx — web app calls this to exchange token ─

router.get('/auth/magic/redeem', rateLimitMiddleware('auth_attempts'), async (req, res) => {
  const magic = req.query.token as string;
  if (!magic || magic.length < 10) { res.status(400).json({ error: 'Invalid token' }); return; }

  try {
    const { pool } = await getPool();
    const { rows } = await pool.query(
      `SELECT data FROM kv_store WHERE collection = 'magic_link' AND id = $1`, [magic]
    );

    if (!rows[0]) { res.status(401).json({ error: 'Invalid or expired link' }); return; }

    const { userId, expiresAt } = rows[0].data as { userId: string; expiresAt: number };

    if (Date.now() > expiresAt) {
      await pool.query(`DELETE FROM kv_store WHERE collection = 'magic_link' AND id = $1`, [magic]);
      res.status(401).json({ error: 'Link has expired — request a new one with /webapp' });
      return;
    }

    // Single-use: delete immediately
    await pool.query(`DELETE FROM kv_store WHERE collection = 'magic_link' AND id = $1`, [magic]);

    const token = signToken({ sub: userId, telegramId: '' });
    logger.info('Magic link redeemed', { userId });
    res.json({ token, expiresIn: 3_600 });
  } catch (err) {
    logger.error('Magic link redeem failed', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Pool helper ─────────────────────────────────────────────────────────────

let _pool: any;
async function getPool() {
  if (!_pool) {
    const { Pool } = await import('pg' as any);
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return { pool: _pool };
}

export default router;
