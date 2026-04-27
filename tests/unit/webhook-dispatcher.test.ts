import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

// Must mock before importing the dispatcher
let mockHooks: any[] = [];

vi.mock('../../src/storage/sqlite.adapter.ts', () => ({
  getDB: () => ({
    prepare: () => ({
      all: () => mockHooks,
      run: () => {},
    }),
  }),
}));

vi.mock('../../src/utils/logger.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { WebhookDispatcher } from '../../src/services/webhook-dispatcher.ts';

describe('WebhookDispatcher', () => {
  let dispatcher: WebhookDispatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHooks = [];
    dispatcher = new WebhookDispatcher();
  });

  it('does nothing when no webhooks match the event', async () => {
    mockHooks = [];
    await dispatcher.dispatch('email.received', { emailId: 'e-1' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fires matching webhook with correct method and headers', async () => {
    mockHooks = [{
      id:     'hook-1',
      url:    'https://example.com/hook',
      events: '["email.received"]',
      secret: 'mysecret',
    }];

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await dispatcher.dispatch('email.received', { emailId: 'e-1', from: 'a@b.com' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://example.com/hook');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-EmailAgent-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(opts.headers['X-EmailAgent-Event']).toBe('email.received');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('signature matches HMAC-SHA256(secret, body)', async () => {
    const secret = 'test-secret-abc';
    mockHooks = [{ id: 'h1', url: 'https://x.com', events: '["email.replied"]', secret }];
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await dispatcher.dispatch('email.replied', { emailId: 'e-2' });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string>; body: string }];
    const body = opts.body as string;
    const sentSig = opts.headers['X-EmailAgent-Signature'];

    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(sentSig).toBe(expected);
  });

  it('payload JSON contains event name and timestamp', async () => {
    mockHooks = [{ id: 'h2', url: 'https://x.com', events: '["draft.created"]', secret: 's' }];
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await dispatcher.dispatch('draft.created', { draftId: 'd-1' });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    const payload = JSON.parse(opts.body as string);
    expect(payload.event).toBe('draft.created');
    expect(payload.data.draftId).toBe('d-1');
    expect(payload.timestamp).toBeTruthy();
  });

  it('does not throw when webhook endpoint returns a non-OK status', async () => {
    mockHooks = [{ id: 'h3', url: 'https://x.com', events: '["email.received"]', secret: 's' }];
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(
      dispatcher.dispatch('email.received', {})
    ).resolves.not.toThrow();
  });

  it('does not throw when fetch rejects (network error)', async () => {
    mockHooks = [{ id: 'h4', url: 'https://x.com', events: '["email.received"]', secret: 's' }];
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      dispatcher.dispatch('email.received', {})
    ).resolves.not.toThrow();
  });
});
