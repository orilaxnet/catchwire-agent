import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { selectedAccount } from '../signals/store.ts';
import { api, type ScheduledEmail } from '../api/client.ts';

type Status = 'all' | 'scheduled' | 'sent' | 'failed' | 'cancelled';

const STATUS_CHIP: Record<string, { bg: string; color: string; icon: string }> = {
  scheduled:  { bg: 'var(--c-medium-bg)',   color: 'var(--c-medium)',   icon: 'schedule' },
  sent:       { bg: 'var(--c-low-bg)',      color: 'var(--c-low)',      icon: 'check_circle' },
  failed:     { bg: 'var(--c-critical-bg)', color: 'var(--c-critical)', icon: 'error' },
  cancelled:  { bg: 'var(--surface-3)',     color: 'var(--text-muted)', icon: 'cancel' },
};

function relativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs  = Math.abs(diff);
  const m    = Math.round(abs / 60000);
  const h    = Math.round(abs / 3600000);
  const d    = Math.round(abs / 86400000);
  const past = diff < 0;
  if (m < 60)  return past ? `${m}m ago` : `in ${m}m`;
  if (h < 24)  return past ? `${h}h ago` : `in ${h}h`;
  return past ? `${d}d ago` : `in ${d}d`;
}

const FILTERS: Status[] = ['all', 'scheduled', 'sent', 'failed', 'cancelled'];

export function Scheduled() {
  const items    = useSignal<ScheduledEmail[]>([]);
  const loading  = useSignal(true);
  const errMsg   = useSignal('');
  const filter   = useSignal<Status>('scheduled');
  const cancelling = useSignal<string | null>(null);

  const load = (statusOverride?: string) => {
    if (!selectedAccount.value) return;
    loading.value = true;
    errMsg.value  = '';
    const status = statusOverride ?? (filter.value === 'all' ? undefined : filter.value);
    api.scheduled.list(selectedAccount.value, status as any)
      .then((data) => { items.value = data; })
      .catch((e) => { errMsg.value = e.message; })
      .finally(() => { loading.value = false; });
  };

  useEffect(() => { load(); }, [selectedAccount.value]);

  const switchFilter = (f: Status) => {
    filter.value = f;
    items.value  = [];
    load(f === 'all' ? undefined : f);
  };

  const cancel = async (id: string) => {
    cancelling.value = id;
    try {
      await api.scheduled.cancel(id);
      items.value = items.value.map((i) =>
        i.id === id ? { ...i, status: 'cancelled' as any } : i
      );
    } catch (e: any) {
      errMsg.value = e.message;
    } finally {
      cancelling.value = null;
    }
  };

  if (!selectedAccount.value) {
    return (
      <div class="empty-state">
        <span class="material-symbols-rounded">schedule_send</span>
        <p>Select an account first</p>
      </div>
    );
  }

  const counts = {
    all:       items.value.length,
    scheduled: items.value.filter((i) => i.status === 'scheduled').length,
    sent:      items.value.filter((i) => i.status === 'sent').length,
    failed:    items.value.filter((i) => i.status === 'failed').length,
    cancelled: items.value.filter((i) => i.status === 'cancelled').length,
  };

  return (
    <div style="max-width:680px">

      {/* ── Header ── */}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--text-primary)">Scheduled Emails</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
            Queued replies waiting to be sent
          </div>
        </div>
        <button class="btn btn-outline" style="height:32px;padding:0 12px;font-size:12px"
          onClick={() => load()} disabled={loading.value}>
          <span class="material-symbols-rounded" style="font-size:14px">refresh</span>
          Refresh
        </button>
      </div>

      {/* ── Filter chips ── */}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
        {FILTERS.map((f) => (
          <button key={f}
            class={`filter-chip${filter.value === f ? ' active' : ''}`}
            onClick={() => switchFilter(f)}>
            {f}
            {filter.value === 'all' && counts[f] > 0 && (
              <span class="count">({counts[f]})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Error ── */}
      {errMsg.value && (
        <div style="padding:10px 14px;background:var(--c-critical-bg);color:var(--c-critical);border-radius:var(--r-md);margin-bottom:16px;font-size:13px">
          {errMsg.value}
        </div>
      )}

      {/* ── List ── */}
      {loading.value ? (
        <div class="empty-state">
          <span class="material-symbols-rounded">sync</span>
          <p>Loading…</p>
        </div>
      ) : items.value.length === 0 ? (
        <div class="empty-state">
          <span class="material-symbols-rounded">schedule_send</span>
          <p>{filter.value === 'scheduled' ? 'No pending emails' : `No ${filter.value} emails`}</p>
        </div>
      ) : (
        <div style="display:flex;flex-direction:column;gap:8px">
          {items.value.map((item) => {
            const chip = STATUS_CHIP[item.status] ?? STATUS_CHIP.scheduled;
            const isCancelling = cancelling.value === item.id;
            return (
              <div key={item.id} class="card" style="display:flex;align-items:flex-start;gap:14px">
                {/* Icon */}
                <div style={`width:36px;height:36px;border-radius:50%;background:${chip.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0`}>
                  <span class="material-symbols-rounded" style={`font-size:18px;color:${chip.color}`}>
                    {chip.icon}
                  </span>
                </div>

                {/* Content */}
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    {(item as any).subject || '(no subject)'}
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                    To: {(item as any).to_address}
                  </div>
                  <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
                    <span class="chip" style={`background:${chip.bg};color:${chip.color};font-size:10px`}>
                      {item.status}
                    </span>
                    <span style="font-size:11px;color:var(--text-muted)">
                      {item.status === 'scheduled'
                        ? `Sends ${relativeTime(item.send_at)}`
                        : new Date(item.send_at).toLocaleString()
                      }
                    </span>
                  </div>
                </div>

                {/* Actions */}
                {item.status === 'scheduled' && (
                  <button class="btn btn-ghost btn-danger" style="height:28px;padding:0 10px;font-size:12px;flex-shrink:0"
                    disabled={isCancelling}
                    onClick={() => cancel(item.id)}>
                    {isCancelling ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
