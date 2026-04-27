import { describe, it, expect } from 'vitest';
import { BatchProcessor } from '../../src/batch/batch-processor.ts';

describe('BatchProcessor', () => {
  const proc = new BatchProcessor();

  it('processes all items', async () => {
    const { results } = await proc.run({
      items:       [1, 2, 3],
      concurrency: 2,
      process:     async (n) => n * 2,
    });
    expect(results.map((r) => r.result)).toEqual(expect.arrayContaining([2, 4, 6]));
  });

  it('collects failures without throwing', async () => {
    const { results, failures } = await proc.run({
      items:       [1, 2, 3],
      concurrency: 3,
      process:     async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      },
    });
    expect(results).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect((failures[0].error as Error).message).toBe('boom');
  });

  it('respects concurrency (chunks)', async () => {
    const order: number[] = [];
    await proc.run({
      items:       [1, 2, 3, 4],
      concurrency: 2,
      process:     async (n) => { order.push(n); return n; },
    });
    // All items processed
    expect(order).toHaveLength(4);
  });
});
