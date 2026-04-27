import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../../src/storage/memory.adapter.ts';

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.init();
  });

  it('set and get', async () => {
    await storage.set('users', 'u1', { name: 'Alice' });
    expect(await storage.get('users', 'u1')).toEqual({ name: 'Alice' });
  });

  it('returns null for missing keys', async () => {
    expect(await storage.get('users', 'missing')).toBeNull();
  });

  it('delete removes item', async () => {
    await storage.set('users', 'u1', { name: 'Alice' });
    await storage.delete('users', 'u1');
    expect(await storage.get('users', 'u1')).toBeNull();
  });

  it('query with filter', async () => {
    await storage.set('emails', 'e1', { accountId: 'a1', subject: 'Hello' });
    await storage.set('emails', 'e2', { accountId: 'a2', subject: 'World' });

    const result = await storage.query('emails', { accountId: 'a1' });
    expect(result).toHaveLength(1);
    expect((result[0] as any).subject).toBe('Hello');
  });

  it('insert generates id', async () => {
    const id = await storage.insert('items', { value: 42 });
    expect(id).toBeTruthy();
    expect(await storage.get('items', id)).toMatchObject({ value: 42, id });
  });

  it('update merges patch', async () => {
    await storage.set('users', 'u1', { name: 'Alice', role: 'user' });
    await storage.update('users', 'u1', { role: 'admin' });
    expect(await storage.get('users', 'u1')).toMatchObject({ name: 'Alice', role: 'admin' });
  });

  it('query respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.insert('items', { n: i });
    }
    const page = await storage.query('items', {}, { limit: 2, offset: 1 });
    expect(page).toHaveLength(2);
  });
});
