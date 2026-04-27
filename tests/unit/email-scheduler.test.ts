import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRun  = vi.fn();
const mockGet  = vi.fn();
const mockAll  = vi.fn(() => []);
const mockStmt = { run: mockRun, get: mockGet, all: mockAll };

vi.mock('../../src/storage/sqlite.adapter.ts', () => ({
  getDB: () => ({ prepare: () => mockStmt }),
}));

vi.mock('../../src/utils/logger.ts', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { EmailScheduler, type ScheduledEmail } from '../../src/scheduling/email-scheduler.ts';

describe('EmailScheduler', () => {
  let scheduler: EmailScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = new EmailScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('scheduleEmail inserts into DB and returns an id', () => {
    const sendAt = new Date(Date.now() + 3600_000);
    const id = scheduler.scheduleEmail({
      accountId: 'acc-1',
      to:        'test@example.com',
      subject:   'Scheduled',
      body:      'Hello',
      sendAt,
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockRun).toHaveBeenCalledWith(
      id, 'acc-1', 'test@example.com', 'Scheduled', 'Hello', sendAt.toISOString()
    );
  });

  it('cancel updates status to cancelled', () => {
    scheduler.cancel('email-id-1');
    expect(mockRun).toHaveBeenCalledWith('email-id-1');
  });

  it('suggestOptimalTime returns 09:00 when no history', () => {
    mockGet.mockReturnValueOnce(null);
    const base   = new Date('2025-01-15T12:00:00Z');
    const result = scheduler.suggestOptimalTime('acc-1', base);
    expect(result.getHours()).toBe(9);
  });

  it('suggestOptimalTime returns the most common send hour', () => {
    mockGet.mockReturnValueOnce({ hour: '14', cnt: 7 });
    const base   = new Date('2025-01-15T00:00:00Z');
    const result = scheduler.suggestOptimalTime('acc-1', base);
    expect(result.getHours()).toBe(14);
  });

  it('startSync uses setInterval when REDIS_URL is not set', () => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    scheduler.startSync(vi.fn());
    expect(setIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('stop clears the interval timer', () => {
    delete process.env.REDIS_URL;
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    scheduler.startSync(vi.fn());
    scheduler.stop();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('scheduleEmail with past sendAt is retrievable', () => {
    const sendAt = new Date(Date.now() - 1000); // already due
    const id = scheduler.scheduleEmail({
      accountId: 'acc-1',
      to:        'past@example.com',
      subject:   'Past',
      body:      'Due now',
      sendAt,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockRun).toHaveBeenCalled();
  });
});
