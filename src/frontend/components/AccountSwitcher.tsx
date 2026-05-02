import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { accounts, selectedAccount } from '../signals/store.ts';
import { clearToken } from '../api/client.ts';

function avatarColor(email: string): string {
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  const colors = ['#1A73E8', '#188038', '#F29900', '#D93025', '#9C27B0', '#00838F'];
  return colors[Math.abs(hash) % colors.length];
}

export function AccountSwitcher() {
  const open    = useSignal(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = accounts.value.find(a => a.account_id === selectedAccount.value);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        open.value = false;
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const logout = () => {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  };

  if (!current) return null;

  const color = avatarColor(current.email_address);
  const letter = current.email_address[0].toUpperCase();

  return (
    <div ref={menuRef} style="position:relative">
      {/* Avatar button */}
      <button
        onClick={() => { open.value = !open.value; }}
        title={current.email_address}
        style={`
          width:32px;height:32px;border-radius:50%;
          background:${color};color:#fff;
          font-weight:600;font-size:13px;
          border:2px solid ${open.value ? 'var(--accent)' : 'transparent'};
          cursor:pointer;transition:border-color 120ms;
          display:flex;align-items:center;justify-content:center;
        `}
      >
        {letter}
      </button>

      {/* Dropdown */}
      {open.value && (
        <div style="
          position:absolute;right:0;top:calc(100% + 8px);
          background:var(--surface);border:1px solid var(--border);
          border-radius:var(--r-md);box-shadow:0 4px 20px rgba(0,0,0,.15);
          min-width:220px;z-index:200;overflow:hidden;
        ">
          {/* Current account header */}
          <div style="padding:12px 14px;border-bottom:1px solid var(--border);background:var(--surface-2)">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:2px">Signed in as</div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              {current.email_address}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:1px">{current.provider}</div>
          </div>

          {/* Switch accounts (if more than one) */}
          {accounts.value.length > 1 && (
            <div style="padding:4px 0;border-bottom:1px solid var(--border)">
              <div style="padding:6px 14px 4px;font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.5px;text-transform:uppercase">
                Switch Account
              </div>
              {accounts.value
                .filter(a => a.account_id !== selectedAccount.value)
                .map(acc => (
                  <button
                    key={acc.account_id}
                    onClick={() => { selectedAccount.value = acc.account_id; open.value = false; }}
                    style="
                      display:flex;align-items:center;gap:10px;
                      width:100%;padding:8px 14px;border:none;background:transparent;
                      cursor:pointer;text-align:left;transition:background 100ms;
                    "
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={`
                      width:24px;height:24px;border-radius:50%;
                      background:${avatarColor(acc.email_address)};
                      color:#fff;font-size:11px;font-weight:600;
                      display:flex;align-items:center;justify-content:center;flex-shrink:0;
                    `}>{acc.email_address[0].toUpperCase()}</span>
                    <span style="font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                      {acc.email_address}
                    </span>
                  </button>
                ))}
            </div>
          )}

          {/* Settings link */}
          <div style="padding:4px 0">
            <a
              href="/agent/settings"
              onClick={() => { open.value = false; }}
              style="
                display:flex;align-items:center;gap:10px;
                padding:9px 14px;text-decoration:none;
                color:var(--text-primary);font-size:13px;
                transition:background 100ms;
              "
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span class="material-symbols-rounded" style="font-size:16px;color:var(--text-muted)">settings</span>
              Settings
            </a>

            {/* Logout */}
            <button
              onClick={logout}
              style="
                display:flex;align-items:center;gap:10px;
                width:100%;padding:9px 14px;border:none;background:transparent;
                cursor:pointer;text-align:left;font-size:13px;
                color:var(--c-critical);transition:background 100ms;
              "
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--c-critical-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span class="material-symbols-rounded" style="font-size:16px">logout</span>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
