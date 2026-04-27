import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../../src/security/rate-limiter.ts';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it('allows requests under the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('ip-1', 'auth_attempts')).toBe(true);
    }
  });

  it('blocks when limit exceeded', () => {
    for (let i = 0; i < 5; i++) limiter.check('ip-2', 'auth_attempts');
    expect(limiter.check('ip-2', 'auth_attempts')).toBe(false);
  });

  it('different keys are independent', () => {
    for (let i = 0; i < 5; i++) limiter.check('ip-A', 'auth_attempts');
    expect(limiter.check('ip-B', 'auth_attempts')).toBe(true);
  });

  it('unknown limit name always allows', () => {
    expect(limiter.check('ip-1', 'nonexistent_limit')).toBe(true);
  });
});
