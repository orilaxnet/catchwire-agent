import { logger } from '../utils/logger.ts';

export interface BatchJob<T, R> {
  items:       T[];
  concurrency: number;
  process:     (item: T) => Promise<R>;
  onError?:    (item: T, err: unknown) => void;
}

export interface BatchResult<T, R> {
  results:  Array<{ item: T; result: R }>;
  failures: Array<{ item: T; error: unknown }>;
}

export class BatchProcessor {
  async run<T, R>(job: BatchJob<T, R>): Promise<BatchResult<T, R>> {
    const results:  Array<{ item: T; result: R }>     = [];
    const failures: Array<{ item: T; error: unknown }> = [];

    const chunks = this.chunk(job.items, job.concurrency);

    for (const chunk of chunks) {
      const settled = await Promise.allSettled(chunk.map(job.process));

      settled.forEach((outcome, i) => {
        const item = chunk[i];
        if (outcome.status === 'fulfilled') {
          results.push({ item, result: outcome.value });
        } else {
          failures.push({ item, error: outcome.reason });
          job.onError?.(item, outcome.reason);
          logger.warn('Batch item failed', { error: outcome.reason });
        }
      });
    }

    logger.info('Batch complete', { total: job.items.length, failed: failures.length });
    return { results, failures };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
