import { signal, computed } from '@preact/signals';
import type { Account, EmailItem, Stats } from '../api/client.ts';

export const accounts        = signal<Account[]>([]);
export const selectedAccount = signal<string>('');
export const emails          = signal<EmailItem[]>([]);
export const stats           = signal<Stats | null>(null);
export const loading         = signal<boolean>(false);
export const expandedEmail   = signal<string | null>(null);

export const currentAccount = computed(() =>
  accounts.value.find((a) => a.account_id === selectedAccount.value) ?? null
);
