import { describe, it, expect, vi } from 'vitest';
import { AnalyticsEngine } from '../../src/analytics/analytics-engine.ts';

vi.mock('../../src/storage/sqlite.adapter.ts', () => ({
  getDB: () => ({
    prepare: (sql: string) => ({
      all:  () => [],
      get:  () => null,
      run:  () => {},
    }),
  }),
}));

describe('AnalyticsEngine', () => {
  const engine = new AnalyticsEngine();

  it('returns empty stats for unknown account', () => {
    const stats = engine.getAccountStats('unknown');
    expect(stats.accountId).toBe('unknown');
    expect(stats.last30Days).toEqual([]);
    expect(stats.acceptedRatio).toBe(0);
  });

  it('getSummary includes key metrics', () => {
    const summary = engine.getSummary('unknown');
    expect(summary).toContain('Analytics');
    expect(summary).toContain('Total emails');
  });
});
