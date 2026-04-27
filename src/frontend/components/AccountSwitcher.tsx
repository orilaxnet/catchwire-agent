import { h } from 'preact';
import { accounts, selectedAccount } from '../signals/store.ts';

function avatarColor(email: string): string {
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  const colors = ['#1A73E8', '#188038', '#F29900', '#D93025', '#9C27B0', '#00838F'];
  return colors[Math.abs(hash) % colors.length];
}

export function AccountSwitcher() {
  return (
    <div style="display:flex;align-items:center;gap:8px">
      {accounts.value.map((acc) => (
        <button
          key={acc.account_id}
          title={acc.email_address}
          onClick={() => { selectedAccount.value = acc.account_id; }}
          style={`
            width:32px;height:32px;border-radius:50%;border:2px solid
            ${selectedAccount.value === acc.account_id ? 'var(--md-primary)' : 'transparent'};
            background:${avatarColor(acc.email_address)};
            color:#fff;font-weight:500;font-size:12px;cursor:pointer;
          `}
        >
          {acc.email_address[0].toUpperCase()}
        </button>
      ))}
    </div>
  );
}
