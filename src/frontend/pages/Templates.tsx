import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useSignal, computed } from '@preact/signals';
import { selectedAccount } from '../signals/store.ts';
import { api, type PromptProfile } from '../api/client.ts';

// ── Intent definitions ──────────────────────────────────────────────────────

const INTENTS: Array<{ id: string; label: string; icon: string; color: string; hint: string }> = [
  { id: 'payment',          label: 'Payment / Invoice', icon: 'payments',       color: '#D97706', hint: 'Billing, invoices, overdue payments' },
  { id: 'complaint',        label: 'Complaint / Support', icon: 'support_agent', color: '#DC2626', hint: 'Issues, dissatisfaction, help requests' },
  { id: 'meeting_request',  label: 'Meeting / Call',    icon: 'event',          color: '#7C3AED', hint: 'Scheduling, calendar invites, calls' },
  { id: 'follow_up',        label: 'Follow-up',         icon: 'update',         color: '#0891B2', hint: 'Reminders, checking status, nudges' },
  { id: 'action_required',  label: 'Action Required',   icon: 'task_alt',       color: '#059669', hint: 'Tasks, decisions, approvals needed' },
  { id: 'question',         label: 'Question',          icon: 'help',           color: '#1A73E8', hint: 'Queries, clarifications, info requests' },
  { id: 'deadline',         label: 'Deadline',          icon: 'schedule',       color: '#DC2626', hint: 'Time-sensitive items, urgent requests' },
  { id: 'partnership',      label: 'Partnership / Sales', icon: 'handshake',    color: '#059669', hint: 'Business proposals, collaborations' },
  { id: 'hiring',           label: 'Hiring / HR',       icon: 'person_add',     color: '#7C3AED', hint: 'Job applications, interviews, HR matters' },
  { id: 'fyi',              label: 'FYI / Update',      icon: 'info',           color: '#94A3B8', hint: 'Informational, no reply needed' },
];

// ── Default global prompt ───────────────────────────────────────────────────

const DEFAULT_GLOBAL = `You are a professional email assistant.

Your job:
1. Analyze the incoming email (priority, intent, sentiment)
2. Draft 2-3 clear, ready-to-send reply options
3. Keep replies concise and appropriate for the context

General rules:
- Never make promises or commitments about pricing, timelines, or company policy
- Always be respectful even if the sender is rude
- When unsure, draft a clarifying question rather than guessing`;

// ── Component ───────────────────────────────────────────────────────────────

export function Templates() {
  const profiles  = useSignal<PromptProfile[]>([]);
  const loading   = useSignal(true);
  const tab       = useSignal<'global' | 'intent'>('global');
  const errMsg    = useSignal('');
  const saving    = useSignal('');       // id or 'new' when saving

  // Global tab state
  const showNewGlobal  = useSignal(false);
  const editingGlobalId = useSignal('');
  const globalName     = useSignal('');
  const globalDesc     = useSignal('');
  const globalBody     = useSignal('');
  const deleteId       = useSignal('');

  // Intent tab state — which intent is being edited
  const editingIntent  = useSignal('');
  const intentBody     = useSignal('');
  const intentName     = useSignal('');

  const load = () => {
    if (!selectedAccount.value) return;
    loading.value = true;
    api.prompts.list(selectedAccount.value)
      .then((data) => { profiles.value = data; })
      .catch((e)   => { errMsg.value = e.message; })
      .finally(()  => { loading.value = false; });
  };

  useEffect(load, [selectedAccount.value]);

  const globalProfiles = computed(() => profiles.value.filter((p) => p.scope === 'global'));
  const intentProfiles = computed(() => profiles.value.filter((p) => p.scope === 'intent'));
  const activeGlobal   = computed(() => globalProfiles.value.find((p) => p.is_active));
  const intentMap      = computed(() => {
    const m: Record<string, PromptProfile> = {};
    for (const p of intentProfiles.value) if (p.intent_type) m[p.intent_type] = p;
    return m;
  });

  // ── Global actions ────────────────────────────────────────────────────────

  const saveGlobal = async (activate: boolean) => {
    if (!globalName.value.trim() || !globalBody.value.trim()) {
      errMsg.value = 'Name and prompt body are required'; return;
    }
    saving.value = 'new';
    try {
      if (editingGlobalId.value) {
        await api.prompts.update(selectedAccount.value!, editingGlobalId.value, {
          name: globalName.value.trim(), description: globalDesc.value.trim() || undefined,
          system_prompt: globalBody.value.trim(),
        });
        if (activate) await api.prompts.activate(selectedAccount.value!, editingGlobalId.value);
      } else {
        await api.prompts.save(selectedAccount.value!, {
          name: globalName.value.trim(), description: globalDesc.value.trim() || undefined,
          system_prompt: globalBody.value.trim(), scope: 'global', activate,
        });
      }
      showNewGlobal.value = false; editingGlobalId.value = '';
      globalName.value = globalDesc.value = globalBody.value = '';
      load();
    } catch (e: any) { errMsg.value = e.message; }
    finally { saving.value = ''; }
  };

  const activateGlobal = async (id: string) => {
    try { await api.prompts.activate(selectedAccount.value!, id); load(); }
    catch (e: any) { errMsg.value = e.message; }
  };

  const deactivateAll = async () => {
    try { await api.prompts.deactivate(selectedAccount.value!); load(); }
    catch (e: any) { errMsg.value = e.message; }
  };

  const deleteProfile = async (id: string) => {
    try { await api.prompts.delete(selectedAccount.value!, id); deleteId.value = ''; load(); }
    catch (e: any) { errMsg.value = e.message; }
  };

  const startEditGlobal = (p: PromptProfile) => {
    editingGlobalId.value = p.id;
    globalName.value = p.name;
    globalDesc.value = p.description ?? '';
    globalBody.value = p.system_prompt;
    showNewGlobal.value = true;
  };

  // ── Intent actions ────────────────────────────────────────────────────────

  const openIntentEditor = (intentId: string) => {
    const existing = intentMap.value[intentId];
    editingIntent.value = intentId;
    intentName.value    = existing?.name ?? INTENTS.find((i) => i.id === intentId)?.label ?? intentId;
    intentBody.value    = existing?.system_prompt ?? '';
  };

  const saveIntent = async () => {
    if (!intentBody.value.trim()) { errMsg.value = 'Prompt body is required'; return; }
    const intentId = editingIntent.value;
    saving.value   = intentId;
    const existing = intentMap.value[intentId];
    try {
      if (existing) {
        await api.prompts.update(selectedAccount.value!, existing.id, {
          name: intentName.value, system_prompt: intentBody.value.trim(),
        });
      } else {
        await api.prompts.save(selectedAccount.value!, {
          name: intentName.value, system_prompt: intentBody.value.trim(),
          scope: 'intent', intent_type: intentId,
        });
      }
      editingIntent.value = '';
      load();
    } catch (e: any) { errMsg.value = e.message; }
    finally { saving.value = ''; }
  };

  const deleteIntent = async (intentId: string) => {
    const p = intentMap.value[intentId];
    if (!p) return;
    try { await api.prompts.delete(selectedAccount.value!, p.id); load(); }
    catch (e: any) { errMsg.value = e.message; }
  };

  if (!selectedAccount.value) {
    return <div class="empty-state"><span class="material-symbols-rounded">psychology</span><p>Select an account first</p></div>;
  }

  return (
    <div style="max-width:740px">

      {/* ── Page header ── */}
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700">AI Prompt System</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:3px">
          Control exactly how the AI reads and responds to emails — globally and per email type
        </div>
      </div>

      {/* ── How it works ── */}
      <div style="background:var(--accent-subtle);border:1px solid var(--accent);border-radius:var(--r-md);padding:12px 14px;margin-bottom:20px;font-size:12px;color:var(--text-secondary);line-height:1.7">
        <strong style="color:var(--accent)">How prompts stack:</strong>
        {' '}<strong>Global</strong> prompt runs first for every email.
        Then the matching <strong>Intent</strong> prompt is added on top (payment rules for payment emails, complaint rules for complaint emails, etc.).
        Together they form the final instruction set the AI follows.
      </div>

      {/* ── Tabs ── */}
      <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px">
        {(['global', 'intent'] as const).map((t) => (
          <button key={t}
            onClick={() => { tab.value = t; }}
            style={`
              padding:8px 20px;background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;
              font-family:var(--font);transition:color 120ms;
              color:${tab.value === t ? 'var(--accent)' : 'var(--text-muted)'};
              border-bottom:2px solid ${tab.value === t ? 'var(--accent)' : 'transparent'};
              margin-bottom:-2px;
            `}>
            {t === 'global' ? 'Global Prompt' : 'Per-Intent Prompts'}
            {t === 'global' && activeGlobal.value && (
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--c-low);margin-left:6px;vertical-align:middle" />
            )}
            {t === 'intent' && intentProfiles.value.length > 0 && (
              <span class="chip" style="margin-left:6px;font-size:10px">{intentProfiles.value.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Error ── */}
      {errMsg.value && (
        <div style="padding:10px 14px;background:var(--c-critical-bg);color:var(--c-critical);border-radius:var(--r-md);margin-bottom:16px;font-size:13px;display:flex;justify-content:space-between">
          {errMsg.value}
          <button style="background:none;border:none;cursor:pointer;color:inherit" onClick={() => { errMsg.value = ''; }}>✕</button>
        </div>
      )}

      {/* ══════════ GLOBAL TAB ══════════ */}
      {tab.value === 'global' && (
        <div>
          {/* Active status */}
          <div style={`
            display:flex;align-items:center;gap:12px;padding:12px 14px;
            background:${activeGlobal.value ? 'var(--c-low-bg)' : 'var(--surface-2)'};
            border:1px solid ${activeGlobal.value ? 'var(--c-low)' : 'var(--border)'};
            border-radius:var(--r-md);margin-bottom:16px;
          `}>
            <span class="material-symbols-rounded" style={`color:${activeGlobal.value ? 'var(--c-low)' : 'var(--text-muted)'};font-size:20px`}>
              {activeGlobal.value ? 'check_circle' : 'radio_button_unchecked'}
            </span>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">
                {activeGlobal.value ? `Active: ${activeGlobal.value.name}` : 'No global prompt — using built-in default'}
              </div>
              <div style="font-size:11px;color:var(--text-muted)">
                {activeGlobal.value
                  ? 'Injected into every AI call for this account'
                  : 'Create and activate a global prompt to customise AI behaviour'}
              </div>
            </div>
            <div style="display:flex;gap:6px">
              {activeGlobal.value && (
                <button class="btn btn-ghost" style="height:28px;font-size:12px" onClick={deactivateAll}>
                  Reset to default
                </button>
              )}
              <button class="btn btn-primary" style="height:32px;font-size:12px"
                onClick={() => {
                  editingGlobalId.value = '';
                  globalName.value = ''; globalDesc.value = '';
                  globalBody.value = globalProfiles.value.length === 0 ? DEFAULT_GLOBAL : '';
                  showNewGlobal.value = true;
                }}>
                <span class="material-symbols-rounded" style="font-size:14px">add</span>
                New
              </button>
            </div>
          </div>

          {/* Create / Edit form */}
          {showNewGlobal.value && (
            <div class="card" style="margin-bottom:16px">
              <div style="font-weight:600;font-size:13px;margin-bottom:14px">
                {editingGlobalId.value ? 'Edit Global Prompt' : 'New Global Prompt'}
              </div>
              <div style="display:flex;flex-direction:column;gap:10px">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <div>
                    <div class="field-label">Name *</div>
                    <input class="md-input" value={globalName.value}
                      onInput={(e: any) => { globalName.value = e.target.value; }}
                      placeholder="e.g. Default, Formal, VIP Clients" style="margin-top:5px" />
                  </div>
                  <div>
                    <div class="field-label">Description</div>
                    <input class="md-input" value={globalDesc.value}
                      onInput={(e: any) => { globalDesc.value = e.target.value; }}
                      placeholder="When to use (optional)" style="margin-top:5px" />
                  </div>
                </div>
                <div>
                  <div class="field-label">System Prompt *</div>
                  <div style="font-size:11px;color:var(--text-muted);margin:4px 0 6px">
                    This text replaces the built-in base instructions. The AI will follow these rules for every email.
                  </div>
                  <textarea class="edit-area" rows={10}
                    value={globalBody.value}
                    onInput={(e: any) => { globalBody.value = e.target.value; }}
                    placeholder="You are a professional email assistant for Acme Corp. You always..."
                    style="font-family:var(--mono);font-size:12px;line-height:1.6"
                  />
                  <div style="font-size:11px;color:var(--text-muted)">{globalBody.value.length} chars</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn btn-primary" style="height:34px"
                    onClick={() => saveGlobal(true)} disabled={!!saving.value}>
                    <span class="material-symbols-rounded" style="font-size:15px">check</span>
                    {saving.value ? 'Saving…' : 'Save & Activate'}
                  </button>
                  <button class="btn btn-outline" style="height:34px"
                    onClick={() => saveGlobal(false)} disabled={!!saving.value}>
                    Save only
                  </button>
                  <button class="btn btn-ghost" style="height:34px"
                    onClick={() => { showNewGlobal.value = false; editingGlobalId.value = ''; }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Saved profiles */}
          {loading.value ? (
            <div class="empty-state"><span class="material-symbols-rounded">sync</span><p>Loading…</p></div>
          ) : globalProfiles.value.length === 0 && !showNewGlobal.value ? (
            <div class="empty-state" style="padding:32px">
              <span class="material-symbols-rounded">psychology</span>
              <p>No global prompts yet</p>
              <p style="font-size:12px">Click "New" above to create your first global prompt.</p>
            </div>
          ) : (
            <div style="display:flex;flex-direction:column;gap:8px">
              {globalProfiles.value.map((p) => (
                <div key={p.id} class="card" style={`padding:0;overflow:hidden;border-color:${p.is_active ? 'var(--c-low)' : 'var(--border)'}`}>
                  <div style="display:flex;align-items:center;gap:10px;padding:12px 16px">
                    <div style={`width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${p.is_active ? 'var(--c-low)' : 'var(--border-strong)'}`} />
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;gap:8px">
                        <span style="font-size:13px;font-weight:600">{p.name}</span>
                        {p.is_active && <span class="chip" style="background:var(--c-low-bg);color:var(--c-low);font-size:10px">Active</span>}
                      </div>
                      {p.description && <div style="font-size:11px;color:var(--text-muted)">{p.description}</div>}
                      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                        {p.system_prompt.slice(0, 80)}…
                      </div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                      <button class="btn btn-ghost" style="height:28px;padding:0 8px" onClick={() => startEditGlobal(p)} title="Edit">
                        <span class="material-symbols-rounded" style="font-size:16px">edit</span>
                      </button>
                      {!p.is_active && (
                        <button class="btn btn-outline" style="height:28px;font-size:12px;padding:0 10px"
                          onClick={() => activateGlobal(p.id)}>
                          Activate
                        </button>
                      )}
                      {p.is_active && (
                        <button class="btn btn-ghost" style="height:28px;font-size:12px;padding:0 10px" onClick={deactivateAll}>
                          Deactivate
                        </button>
                      )}
                      <button class="btn btn-ghost btn-danger" style="height:28px;padding:0 8px"
                        onClick={() => { deleteId.value = deleteId.value === p.id ? '' : p.id; }}>
                        <span class="material-symbols-rounded" style="font-size:16px">delete</span>
                      </button>
                    </div>
                  </div>
                  {deleteId.value === p.id && (
                    <div style="padding:10px 16px;border-top:1px solid var(--border);background:var(--c-critical-bg);display:flex;align-items:center;gap:10px">
                      <span style="font-size:13px;color:var(--c-critical);flex:1">Delete «{p.name}»?</span>
                      <button class="btn" style="height:28px;font-size:12px;background:var(--c-critical);color:#fff;padding:0 12px"
                        onClick={() => deleteProfile(p.id)}>Delete</button>
                      <button class="btn btn-ghost" style="height:28px;font-size:12px"
                        onClick={() => { deleteId.value = ''; }}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════ INTENT TAB ══════════ */}
      {tab.value === 'intent' && (
        <div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">
            Each rule below is injected automatically when the AI detects that email type.
            Prompts marked <span style="color:var(--c-low);font-weight:600">●</span> are active.
          </div>

          {/* Intent grid */}
          <div style="display:flex;flex-direction:column;gap:8px">
            {INTENTS.map((intent) => {
              const existing  = intentMap.value[intent.id];
              const isEditing = editingIntent.value === intent.id;
              const isSaving  = saving.value === intent.id;

              return (
                <div key={intent.id} class="card" style={`padding:0;overflow:hidden;border-color:${existing ? intent.color + '60' : 'var(--border)'}`}>
                  {/* Header row */}
                  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer"
                    onClick={() => {
                      if (isEditing) { editingIntent.value = ''; }
                      else openIntentEditor(intent.id);
                    }}>
                    <div style={`width:32px;height:32px;border-radius:var(--r-md);background:${intent.color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0`}>
                      <span class="material-symbols-rounded" style={`font-size:17px;color:${intent.color}`}>{intent.icon}</span>
                    </div>
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;gap:8px">
                        <span style="font-size:13px;font-weight:600">{intent.label}</span>
                        {existing
                          ? <span style={`width:6px;height:6px;border-radius:50%;background:${intent.color};display:inline-block`} />
                          : <span style="font-size:11px;color:var(--text-muted)">not set</span>
                        }
                      </div>
                      <div style="font-size:11px;color:var(--text-muted)">{intent.hint}</div>
                      {existing && !isEditing && (
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;font-family:var(--mono)">
                          {existing.system_prompt.slice(0, 90)}…
                        </div>
                      )}
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0" onClick={(e) => e.stopPropagation()}>
                      {existing && (
                        <button class="btn btn-ghost btn-danger" style="height:28px;padding:0 8px"
                          onClick={() => deleteIntent(intent.id)} title="Remove rule">
                          <span class="material-symbols-rounded" style="font-size:16px">delete</span>
                        </button>
                      )}
                      <button class="btn btn-outline" style="height:28px;font-size:12px;padding:0 10px"
                        onClick={() => {
                          if (isEditing) editingIntent.value = '';
                          else openIntentEditor(intent.id);
                        }}>
                        {isEditing ? 'Cancel' : existing ? 'Edit' : '+ Add Rule'}
                      </button>
                    </div>
                  </div>

                  {/* Editor panel */}
                  {isEditing && (
                    <div style="padding:0 16px 16px;border-top:1px solid var(--border)">
                      <div style="font-size:11px;color:var(--text-muted);margin:10px 0 6px">
                        Rules to follow specifically when the email intent is <strong>{intent.label}</strong>:
                      </div>
                      <textarea class="edit-area" rows={6}
                        value={intentBody.value}
                        onInput={(e: any) => { intentBody.value = e.target.value; }}
                        placeholder={getIntentPlaceholder(intent.id)}
                        style="font-family:var(--mono);font-size:12px;line-height:1.6"
                      />
                      <div style="display:flex;gap:8px;margin-top:8px">
                        <button class="btn btn-primary" style="height:32px;font-size:12px"
                          onClick={saveIntent} disabled={isSaving || !intentBody.value.trim()}>
                          <span class="material-symbols-rounded" style="font-size:14px">check</span>
                          {isSaving ? 'Saving…' : 'Save Rule'}
                        </button>
                        <button class="btn btn-ghost" style="height:32px;font-size:12px"
                          onClick={() => { editingIntent.value = ''; }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function getIntentPlaceholder(intentId: string): string {
  const EXAMPLES: Record<string, string> = {
    payment:         `- Always acknowledge the invoice number and amount\n- If overdue, apologize and provide payment ETA\n- Offer to send payment confirmation once processed`,
    complaint:       `- Start with genuine empathy, never be defensive\n- Acknowledge the issue clearly before offering a solution\n- Always provide a concrete next step or resolution timeline`,
    meeting_request: `- Offer 2-3 alternative time slots when accepting\n- Always confirm timezone when scheduling international calls\n- Keep confirmation replies brief`,
    follow_up:       `- Be brief — the sender just needs a status update\n- Always give a specific date/ETA, not vague "soon"\n- If blocked, explain why clearly`,
    partnership:     `- Express genuine interest but avoid over-committing\n- Always ask 1-2 clarifying questions about scope/timeline\n- End with a clear next step (call, proposal, etc.)`,
    hiring:          `- Be warm and professional\n- For applications: acknowledge receipt, give clear timeline\n- For interview requests: confirm details (date, format, who attends)`,
  };
  return EXAMPLES[intentId] ?? `Rules to apply specifically for ${intentId} emails…`;
}
