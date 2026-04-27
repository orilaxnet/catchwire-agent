import { describe, it, expect } from 'vitest';
import { InMemoryStorage } from '../../src/storage/memory.adapter.ts';

/**
 * Integration tests that run against the real InMemoryStorage backend.
 * SQLite and Postgres tests require their respective runtimes — run separately.
 */
describe('InMemoryStorage integration', () => {
  it('full CRUD lifecycle', async () => {
    const s = new InMemoryStorage();
    await s.init();

    const id = await s.insert('accounts', { email: 'test@example.com', active: true });
    expect(id).toBeTruthy();

    const found = await s.get<any>('accounts', id);
    expect(found?.email).toBe('test@example.com');

    await s.update('accounts', id, { active: false });
    const updated = await s.get<any>('accounts', id);
    expect(updated?.active).toBe(false);

    const list = await s.query('accounts', { active: false });
    expect(list.length).toBeGreaterThan(0);

    await s.delete('accounts', id);
    expect(await s.get('accounts', id)).toBeNull();
  });
});
