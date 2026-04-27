import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TemplateMatcher } from '../../src/template/template-matcher.ts';

vi.mock('../../src/storage/sqlite.adapter.ts', () => ({
  getDB: () => ({
    prepare: () => ({
      all: () => [
        {
          id: 't1',
          trigger_intents:  JSON.stringify(['meeting_request']),
          trigger_keywords: JSON.stringify(['schedule', 'meeting']),
          trigger_domain:   null,
          trigger_subject:  null,
          body_template: 'Sure, let me check my calendar.',
          subject_template: null,
          tone: 'professional',
          language: 'en',
          variables: null,
          times_used: 0,
        },
      ],
    }),
  }),
}));

describe('TemplateMatcher', () => {
  const matcher = new TemplateMatcher();

  it('matches template by intent', async () => {
    const email  = { subject: 'Meeting request', bodyText: 'Can we schedule a meeting?' } as any;
    const analysis = { intent: 'meeting_request', priority: 'medium' } as any;

    const result = await matcher.findBest(email, analysis);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('t1');
  });

  it('returns null when no template matches', async () => {
    const email    = { subject: 'Random email', bodyText: 'Nothing special' } as any;
    const analysis = { intent: 'unknown_intent', priority: 'low' } as any;

    const result = await matcher.findBest(email, analysis);
    expect(result).toBeNull();
  });
});
