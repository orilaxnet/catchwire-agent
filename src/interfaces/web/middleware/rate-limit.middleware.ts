import type { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../../../security/rate-limiter.ts';

const limiter = new RateLimiter();

/** Express middleware — rate-limits by IP using the shared RateLimiter */
export function rateLimitMiddleware(limitName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (limiter.check(ip, limitName)) {
      next();
    } else {
      res.status(429).json({
        error:   'Too many requests',
        retryIn: '60s',
      });
    }
  };
}
