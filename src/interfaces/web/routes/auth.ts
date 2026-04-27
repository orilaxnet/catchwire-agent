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
    if (!user || !user.password_hash) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      await pool.query(
        `INSERT INTO audit_log (id, user_id, action, ip_address) VALUES (gen_random_uuid()::text, $1, 'login_failed', $2)`,
        [user.id, ip]
      );
      logger.warn('Login failed — wrong password', { userId: user.id, ip });
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = signToken({ sub: user.id, telegramId: '' });
    logger.info('Login successful', { userId: user.id });
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
