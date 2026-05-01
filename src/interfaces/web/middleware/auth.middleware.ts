import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDB } from '../../../storage/sqlite.adapter.ts';
import { logger } from '../../../utils/logger.ts';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters (64+ recommended)');
  }
  return secret;
}


export interface JWTPayload {
  sub:        string;
  telegramId: string;
  accountId?: string;
  iat:        number;
  exp:        number;
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, expiresInSec = 3_600): string {
  const secret = getJwtSecret();
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now    = Math.floor(Date.now() / 1000);
  const body   = base64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec }));
  const sig    = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const secret = getJwtSecret();
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;

    const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const sigBuf      = Buffer.from(sig,      'base64url');
    const expectedBuf = Buffer.from(expected, 'base64url');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(decodeBase64url(body)) as JWTPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  // Query-string tokens are accepted only for WebSocket upgrades (where headers
  // cannot be set). All regular HTTP requests must use the Authorization header.
  if (req.headers.upgrade?.toLowerCase() === 'websocket') {
    return req.query.token as string | undefined;
  }
  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  (req as any).user = payload;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) (req as any).user = payload;
  }
  next();
}

export function verifyTelegramInitData(initData: string, botToken: string): boolean {
  try {
    const params = new URLSearchParams(initData);
    const hash   = params.get('hash') ?? '';
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed  = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const hashBuf     = Buffer.from(hash,     'hex');
    const computedBuf = Buffer.from(computed, 'hex');
    if (hashBuf.length !== computedBuf.length) return false;
    return timingSafeEqual(hashBuf, computedBuf);
  } catch {
    return false;
  }
}
