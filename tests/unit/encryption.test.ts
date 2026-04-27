import { describe, it, expect, beforeAll } from 'vitest';
import { Encryption } from '../../src/security/encryption.ts';

describe('Encryption', () => {
  let enc: Encryption;

  beforeAll(() => {
    enc = new Encryption('0'.repeat(64));
  });

  it('round-trips plaintext', () => {
    const plain = 'hello world';
    expect(enc.decrypt(enc.encrypt(plain))).toBe(plain);
  });

  it('produces different ciphertext for same input (IV randomness)', () => {
    const c1 = enc.encrypt('secret');
    const c2 = enc.encrypt('secret');
    expect(c1).not.toBe(c2);
  });

  it('selfTest passes', () => {
    expect(enc.selfTest()).toBe(true);
  });

  it('throws on tampered ciphertext', () => {
    const cipher = enc.encrypt('data');
    const parts  = cipher.split(':');
    parts[2]     = parts[2].replace(/[0-9a-f]/, (c) => (parseInt(c, 16) ^ 1).toString(16));
    expect(() => enc.decrypt(parts.join(':'))).toThrow();
  });
});
