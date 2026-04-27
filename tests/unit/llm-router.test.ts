import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch (used by OpenRouter, Ollama, Custom providers)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock the OpenAI npm package (used by OpenAI + OpenRouter fallback providers)
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    OpenAI: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
    _mockCreate: mockCreate,
  };
});

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ text: 'anthropic response' }] }),
    },
  })),
  Anthropic: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ text: 'anthropic response' }] }),
    },
  })),
}));

import { LLMRouter } from '../../src/llm/router.ts';

function okFetch(text: string) {
  return Promise.resolve({
    ok:   true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content: text } }] }),
    text: () => Promise.resolve(text),
  } as any);
}

function errFetch(status = 503, msg = 'Service unavailable') {
  return Promise.resolve({
    ok:   false,
    status,
    json: () => Promise.resolve({ error: msg }),
    text: () => Promise.resolve(msg),
  } as any);
}

const BASE_CONFIG = {
  provider: 'openrouter' as const,
  apiKey:   'test-key',
  model:    'openai/gpt-4o-mini',
};

describe('LLMRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('routes to OpenRouter and returns text from fetch response', async () => {
    mockFetch.mockResolvedValueOnce(okFetch('Hello world'));
    const router = new LLMRouter(BASE_CONFIG);
    const result = await router.complete('Say hello');
    expect(result).toBe('Hello world');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as string[];
    expect(url).toContain('openrouter');
  });

  it('throws on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce(errFetch(503));
    const router = new LLMRouter(BASE_CONFIG);
    await expect(router.complete('test')).rejects.toThrow(/503/);
  });

  it('falls back to secondary provider when primary throws', async () => {
    mockFetch
      .mockResolvedValueOnce(errFetch(503))            // primary fails
      .mockResolvedValueOnce(okFetch('fallback result')); // fallback succeeds

    const router = new LLMRouter({
      ...BASE_CONFIG,
      fallback: { provider: 'openrouter', apiKey: 'fallback-key', model: 'gpt-4o-mini' },
    });

    const result = await router.complete('test');
    expect(result).toBe('fallback result');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws when both primary and fallback fail', async () => {
    mockFetch.mockResolvedValue(errFetch(503));
    const router = new LLMRouter({
      ...BASE_CONFIG,
      fallback: { provider: 'openrouter', apiKey: 'k', model: 'm' },
    });
    await expect(router.complete('test')).rejects.toThrow();
  });

  it('completeWithRetry parses valid JSON on first attempt', async () => {
    mockFetch.mockResolvedValueOnce(okFetch('{"result": 42}'));
    const router  = new LLMRouter(BASE_CONFIG);
    const result  = await router.completeWithRetry('Give JSON', (raw) => JSON.parse(raw));
    expect(result).toEqual({ result: 42 });
  });

  it('completeWithRetry retries on parse failure and succeeds on retry', async () => {
    mockFetch
      .mockResolvedValueOnce(okFetch('not valid json'))
      .mockResolvedValueOnce(okFetch('{"ok": true}'));

    const router = new LLMRouter(BASE_CONFIG);
    const result = await router.completeWithRetry('Give JSON', (raw) => JSON.parse(raw), 1);
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('completeWithRetry throws after exhausting all retries', async () => {
    mockFetch.mockResolvedValue(okFetch('not valid json'));
    const router = new LLMRouter(BASE_CONFIG);
    await expect(
      router.completeWithRetry('Give JSON', (raw) => JSON.parse(raw), 1)
    ).rejects.toThrow(/failed after/);
  });
});
