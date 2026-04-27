import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 16;
const TAG_LENGTH = 16;

export class Encryption {
  private readonly key: Buffer;

  constructor(masterKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(masterKey)) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (256-bit)');
    }
    this.key = Buffer.from(masterKey, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv     = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
  }

  decrypt(ciphertext: string): string {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    const iv       = Buffer.from(ivHex,  'hex');
    const tag      = Buffer.from(tagHex, 'hex');
    const enc      = Buffer.from(encHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc).toString('utf8') + decipher.final('utf8');
  }

  // Smoke test — encrypt and decrypt a simple value to verify the key works
  selfTest(): boolean {
    try {
      const test = 'email-agent-self-test';
      return this.decrypt(this.encrypt(test)) === test;
    } catch {
      return false;
    }
  }
}
