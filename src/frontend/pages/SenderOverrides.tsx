import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { selectedAccount } from '../signals/store.ts';
import { api, type SenderOverride } from '../api/client.ts';

const AUTONOMY_LEVELS = ['suggest', 'auto_draft', 'auto_send'];
const TONES = ['', 'formal', 'friendly', 'concise', 'detailed'];

const EMPTY: Partial<SenderOverride> = {
  sender_email: '',
  sender_domain: '',
  priority: 0,
  autonomy_level: 'suggest',
  tone: '',
  auto_reply: false,
  forward_to: '',
  subject_contains: '',
  time_start: '',
  time_end: '',
  enabled: true,
};

export function SenderOverrides() {
  const [overrides, setOverrides] = useState<SenderOverride[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState<Partial<SenderOverride>>({ ...EMPTY });
  const [editId, setEditId]       = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);

  const accountId = selectedAccount.value;

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    api.overrides.list(accountId)
      .then(setOverrides)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId]);

  function openNew() {
    setForm({ ...EMPTY });
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(o: SenderOverride) {
    setForm({ ...o });
    setEditId(o.id);
    setShowForm(true);
  }

  async function save() {
    if (!accountId) return;
    setSaving(true);
    try {
      if (editId) {
        const updated = await api.overrides.update(accountId, editId, form);
        setOverrides((prev) => prev.map((o) => (o.id === editId ? updated : o)));
      } else {
        const created = await api.overrides.create(accountId, form);
        setOverrides((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!accountId || !confirm('Delete this override?')) return;
    try {
      await api.overrides.delete(accountId, id);
      setOverrides((prev) => prev.filter((o) => o.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  }

  function field(key: keyof SenderOverride) {
    return (e: Event) => setForm((f) => ({
      ...f,
      [key]: (e.target as HTMLInputElement).value,
    }));
  }

  function checkField(key: keyof SenderOverride) {
    return (e: Event) => setForm((f) => ({
      ...f,
      [key]: (e.target as HTMLInputElement).checked,
    }));
  }

  if (!accountId) return <div class="empty-state">Select an account first.</div>;

  return (
    <div class="page-overrides" style="padding:16px;max-width:900px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">Sender Overrides</h2>
        <button class="btn btn-primary" onClick={openNew}>+ New Override</button>
      </div>

      {error && (
        <div style="background:var(--c-critical-bg);color:var(--c-critical);padding:10px 14px;border-radius:var(--r-md);margin-bottom:12px;font-size:13px">
          {error}
        </div>
      )}

      {loading ? (
        <div class="loading-state">Loading overrides…</div>
      ) : overrides.length === 0 ? (
        <div class="empty-state" style="text-align:center;padding:48px">
          <span class="material-symbols-rounded" style="font-size:48px">tune</span>
          <p>No overrides yet. Create one to customize how the agent handles specific senders.</p>
        </div>
      ) : (
        <div style="display:flex;flex-direction:column;gap:8px">
          {overrides.map((o) => (
            <div key={o.id} class="card" style="padding:16px;display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div style="font-weight:600;margin-bottom:4px">
                  {o.sender_email || (o.sender_domain ? `*@${o.sender_domain}` : '(all senders)')}
                </div>
                <div style="font-size:13px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap">
                  <span>Autonomy: <strong>{o.autonomy_level}</strong></span>
                  {o.tone && <span>Tone: <strong>{o.tone}</strong></span>}
                  {o.auto_reply && <span class="chip">Auto-reply</span>}
                  {o.forward_to && <span>Forward → {o.forward_to}</span>}
                  {o.subject_contains && <span>Subject contains: "{o.subject_contains}"</span>}
                  {(o.time_start || o.time_end) && (
                    <span>Hours: {o.time_start}–{o.time_end}</span>
                  )}
                  <span style={`color:${o.enabled ? 'var(--accent)' : 'var(--c-critical)'}`}>
                    {o.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-outline" style="height:28px;font-size:12px;padding:0 12px" onClick={() => openEdit(o)}>Edit</button>
                <button class="btn btn-ghost btn-danger" style="height:28px;font-size:12px" onClick={() => remove(o.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div class="modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100">
          <div class="card" style="padding:24px;width:520px;max-width:95vw;max-height:90vh;overflow-y:auto">
            <h3 style="margin:0 0 16px">{editId ? 'Edit Override' : 'New Override'}</h3>

            <div style="display:flex;flex-direction:column;gap:12px">
              <label>
                <div class="field-label">Sender Email (exact match)</div>
                <input class="md-input" value={form.sender_email} onInput={field('sender_email')} placeholder="user@example.com" />
              </label>
              <label>
                <div class="field-label">Sender Domain (wildcard)</div>
                <input class="md-input" value={form.sender_domain} onInput={field('sender_domain')} placeholder="example.com" />
              </label>
              <label>
                <div class="field-label">Subject Contains</div>
                <input class="md-input" value={form.subject_contains} onInput={field('subject_contains')} placeholder="invoice, meeting…" />
              </label>
              <label>
                <div class="field-label">Autonomy Level</div>
                <select class="md-input" value={form.autonomy_level} onChange={field('autonomy_level')}>
                  {AUTONOMY_LEVELS.map((l) => <option value={l}>{l}</option>)}
                </select>
              </label>
              <label>
                <div class="field-label">Tone Override</div>
                <select class="md-input" value={form.tone} onChange={field('tone')}>
                  {TONES.map((t) => <option value={t}>{t || '(use default)'}</option>)}
                </select>
              </label>
              <label>
                <div class="field-label">Prompt Template Override</div>
                <textarea class="md-input" rows={3} value={form.prompt_template}
                  onInput={(e) => setForm((f) => ({ ...f, prompt_template: (e.target as HTMLTextAreaElement).value }))}
                  placeholder="Custom system prompt for this sender…"
                />
              </label>
              <label>
                <div class="field-label">Forward To</div>
                <input class="md-input" value={form.forward_to} onInput={field('forward_to')} placeholder="other@example.com" />
              </label>
              <div style="display:flex;gap:16px">
                <label>
                  <div class="field-label">Active From</div>
                  <input class="md-input" type="time" value={form.time_start} onInput={field('time_start')} />
                </label>
                <label>
                  <div class="field-label">Active Until</div>
                  <input class="md-input" type="time" value={form.time_end} onInput={field('time_end')} />
                </label>
              </div>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" checked={form.auto_reply} onChange={checkField('auto_reply')} />
                Auto-reply without review
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" checked={form.enabled} onChange={checkField('enabled')} />
                Enabled
              </label>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
              <button class="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button class="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
