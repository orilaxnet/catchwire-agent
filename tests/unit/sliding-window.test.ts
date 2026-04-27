import { describe, it, expect, vi } from 'vitest';
import { SlidingWindow } from '../../src/context/sliding-window.ts';
import type { EmailThread } from '../../src/types/index.ts';

function makeThread(count: number, summary?: string): EmailThread {
  return {
    id:           'thread-1',
    accountId:    'acc-1',
    subject:      'Test subject',
    participants: ['a@b.com'],
    messageCount: count,
    messages:     Array.from({ length: count }, (_, i) => ({
      id:   `msg-${i}`,
      from: `user${i}@test.com`,
      body: `Message body number ${i + 1}`,
      date: new Date(),
    })),
    summary: summary ?? null,
    entities: { dates: [], amounts: [], actionItems: ['Follow up by Friday'] },
    status:   'active',
    firstMessageAt: new Date(),
    lastMessageAt:  new Date(),
  };
}

describe('SlidingWindow', () => {
  it('returns full history for threads with ≤10 messages', async () => {
    const sw = new SlidingWindow();
    const result = await sw.build(makeThread(5));
    expect(result).toContain('5 messages');
    expect(result).toContain('Message body number 5');
  });

  it('includes all messages when exactly 10', async () => {
    const sw = new SlidingWindow();
    const result = await sw.build(makeThread(10));
    expect(result).toContain('10 messages');
  });

  it('uses existing summary when thread has one', async () => {
    const sw = new SlidingWindow();
    const thread = makeThread(15, 'Pre-computed summary text');
    const result = await sw.build(thread);
    expect(result).toContain('Pre-computed summary text');
    expect(result).toContain('Last 10 messages');
  });

  it('calls LLM to summarize older messages when no summary exists', async () => {
    const mockLLM = { complete: vi.fn().mockResolvedValue('LLM-generated summary') };
    vi.doMock('../../src/llm/router.ts', () => ({ LLMRouter: vi.fn(() => mockLLM) }));

    const sw = new SlidingWindow({ provider: 'openrouter', apiKey: 'test', model: 'gpt-4o-mini' });
    vi.spyOn(sw, 'summarizeOlderMessages').mockResolvedValue('LLM-generated summary');

    const result = await sw.build(makeThread(15));
    expect(result).toContain('LLM-generated summary');
  });

  it('includes action items from entities', async () => {
    const sw = new SlidingWindow();
    const thread = makeThread(15, 'Summary here');
    const result = await sw.build(thread);
    expect(result).toContain('Follow up by Friday');
  });

  it('buildSync returns immediately without LLM call for short threads', () => {
    const sw = new SlidingWindow();
    const result = sw.buildSync(makeThread(3));
    expect(result).toContain('Message body number 3');
  });

  it('buildSync includes fallback text for long threads with no summary', () => {
    const sw = new SlidingWindow();
    const result = sw.buildSync(makeThread(20));
    expect(result).toContain('summary not yet generated');
    expect(result).toContain('Last 10 messages');
  });
});
