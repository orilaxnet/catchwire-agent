import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendMail } = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({ messageId: '<test@example.com>' }),
}));

let mockAccountRow: any = null;

vi.mock('../../src/storage/sqlite.adapter.ts', () => ({
  getDB: () => ({
    prepare: () => ({ get: () => mockAccountRow }),
  }),
}));

vi.mock('../../src/security/encryption.ts', () => ({
  Encryption: vi.fn().mockImplementation(() => ({
    decrypt: vi.fn().mockReturnValue(JSON.stringify({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'user@example.com',
      smtp_pass: 'password',
    })),
  })),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn().mockReturnValue({ sendMail: mockSendMail }),
}));

import { EmailSender } from '../../src/services/email-sender.ts';

const TEST_EMAIL = {
  from:    'from@example.com',
  to:      'to@example.com',
  subject: 'Test',
  body:    'Hello',
};

describe('EmailSender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountRow = null;
    mockSendMail.mockResolvedValue({ messageId: '<test@example.com>' });
  });

  it('returns error when account not found', async () => {
    mockAccountRow = null;
    const sender = new EmailSender();
    const result = await sender.send('nonexistent', TEST_EMAIL);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('routes SMTP accounts through nodemailer', async () => {
    mockAccountRow = {
      id:              'acc-1',
      account_type:    'imap',
      credentials_enc: 'encrypted-data',
    };

    const { createTransport } = await import('nodemailer');
    const sender = new EmailSender();
    const result = await sender.send('acc-1', TEST_EMAIL);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 587,
    }));
    expect(result.success).toBe(true);
  });

  it('returns error for forward account with no relay config', async () => {
    mockAccountRow = { id: 'acc-2', account_type: 'forward', credentials_enc: null };

    delete process.env.SMTP_RELAY_HOST;
    delete process.env.SMTP_HOST;

    const sender = new EmailSender();
    const result = await sender.send('acc-2', TEST_EMAIL);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SMTP/i);
  });
});
