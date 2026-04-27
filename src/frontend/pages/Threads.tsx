import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { selectedAccount } from '../signals/store.ts';
import { api } from '../api/client.ts';

interface Thread {
  id: string;
  subject: string;
  participants: string[] | string;
  message_count: number;
  summary?: string;
  status: string;
  last_message_at: string;
}

interface ThreadMessage {
  id: string;
  from_address: string;
  subject: string;
  received_at: string;
  agent_response: any;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function Threads() {
  const threads      = useSignal<Thread[]>([]);
  const loading      = useSignal(true);
  const selected     = useSignal<string | null>(null);
  const detail       = useSignal<{ thread: Thread; messages: ThreadMessage[] } | null>(null);
  const loadingDet   = useSignal(false);

  useEffect(() => {
    if (!selectedAccount.value) return;
    loading.value = true;
    api.threads.list(selectedAccount.value)
      .then((data) => { threads.value = data as Thread[]; })
      .catch(console.error)
      .finally(() => { loading.value = false; });
  }, [selectedAccount.value]);

  const openThread = async (threadId: string) => {
    if (selected.value === threadId) { selected.value = null; detail.value = null; return; }
    selected.value   = threadId;
    loadingDet.value = true;
    try {
      const data = await api.threads.summary(threadId);
      detail.value = data as any;
    } catch (e) {
      console.error(e);
    } finally {
      loadingDet.value = false;
    }
  };

  const getParticipants = (t: Thread) => {
    try {
      const arr = Array.isArray(t.participants) ? t.participants : JSON.parse(t.participants as string);
      return arr.join(', ');
    } catch { return String(t.participants); }
  };

  if (!selectedAccount.value) {
    return <div class="empty-state"><span class="material-symbols-rounded">forum</span><p>Select an account</p></div>;
  }

  if (loading.value) {
    return <div class="empty-state"><span class="material-symbols-rounded">sync</span><p>Loading threads…</p></div>;
  }

  if (threads.value.length === 0) {
    return <div class="empty-state"><span class="material-symbols-rounded">forum</span><p>No threads yet</p></div>;
  }

  return (
    <div>
      <div class="section-header">{threads.value.length} thread{threads.value.length !== 1 ? 's' : ''}</div>
      {threads.value.map((t) => (
        <div key={t.id}>
          <div
            class="card"
            style={`padding:14px;margin-bottom:8px;cursor:pointer;
              ${selected.value === t.id ? 'border:2px solid var(--accent)' : 'border:2px solid transparent'}`}
            onClick={() => openThread(t.id)}
          >
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div style="font-weight:600;flex:1">{t.subject || '(no subject)'}</div>
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
                <span class="chip">
                  {t.message_count} msg{t.message_count !== 1 ? 's' : ''}
                </span>
                <span style="font-size:11px;color:var(--text-muted)">{timeAgo(t.last_message_at)}</span>
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">{getParticipants(t)}</div>
            {t.summary && <div style="font-size:13px;margin-top:6px;opacity:.8">{t.summary}</div>}
          </div>

          {selected.value === t.id && (
            <div style="margin:-4px 0 12px 16px;padding:12px;background:var(--surface-1);border-radius:0 0 var(--r-md) var(--r-md);border:1px solid var(--border)">
              {loadingDet.value ? (
                <p style="font-size:13px;color:var(--text-muted)">Loading messages…</p>
              ) : detail.value?.messages.map((m) => (
                <div key={m.id} style="border-bottom:1px solid var(--border);padding:10px 0">
                  <div style="display:flex;justify-content:space-between">
                    <span style="font-weight:500;font-size:13px">{m.from_address}</span>
                    <span style="font-size:11px;color:var(--text-muted)">{timeAgo(m.received_at)}</span>
                  </div>
                  <div style="font-size:12px;color:var(--text-muted)">{m.subject}</div>
                  {m.agent_response?.summary && (
                    <div style="font-size:12px;margin-top:4px;padding:6px 10px;background:var(--surface-2);border-radius:var(--r-sm)">
                      {m.agent_response.summary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
