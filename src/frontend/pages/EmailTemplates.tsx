import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useSignal, computed } from '@preact/signals';
import { selectedAccount } from '../signals/store.ts';
import { api, type Template } from '../api/client.ts';

const TONES = ['professional', 'friendly', 'formal', 'casual'] as const;

const EMPTY_FORM = {
  name: '',
  description: '',
  body_template: '',
  tone: 'professional' as string,
};

// extract {{variable}} names from template body
function extractVars(body: string): string[] {
  const matches = [...body.matchAll(/\{\{([^}]+)\}\}/g)];
  return [...new Set(matches.map((m) => m[1].trim()))];
}

export function EmailTemplates() {
  const templates   = useSignal<Template[]>([]);
  const loading     = useSignal(true);
  const errMsg      = useSignal('');
  const showForm    = useSignal(false);
  const editingId   = useSignal('');
  const form        = useSignal({ ...EMPTY_FORM });
  const saving      = useSignal(false);
  const deleteId    = useSignal('');
  const testingId   = useSignal('');
  const testVars    = useSignal<Record<string, string>>({});
  const testResult  = useSignal('');
  const testLoading = useSignal(false);

  const accountId = selectedAccount.value;

  const load = () => {
    loading.value = true;
    errMsg.value  = '';
    api.templates.listAll()
      .then((data) => { templates.value = data; })
      .catch((e)   => { errMsg.value = e.message; })
      .finally(()  => { loading.value = false; });
  };

  useEffect(load, [accountId]);

  const openNew = () => {
    editingId.value = '';
    form.value = { ...EMPTY_FORM };
    showForm.value = true;
  };

  const openEdit = (t: Template) => {
    editingId.value = t.id;
    form.value = {
      name:          t.name,
      description:   t.description ?? '',
      body_template: t.body_template,
      tone:          t.tone ?? 'professional',
    };
    showForm.value = true;
  };

  const save = async () => {
    if (!form.value.name.trim() || !form.value.body_template.trim()) {
      errMsg.value = 'Name and body are required'; return;
    }
    saving.value = true;
    errMsg.value = '';
    try {
      if (editingId.value) {
        const updated = await api.templates.update(editingId.value, {
          name:          form.value.name.trim(),
          description:   form.value.description.trim() || undefined,
          body_template: form.value.body_template.trim(),
          tone:          form.value.tone,
        });
        templates.value = templates.value.map((t) => t.id === editingId.value ? updated : t);
      } else {
        const created = await api.templates.create({
          name:          form.value.name.trim(),
          description:   form.value.description.trim() || undefined,
          body_template: form.value.body_template.trim(),
          tone:          form.value.tone,
          account_id:    accountId || undefined,
        });
        templates.value = [created, ...templates.value];
      }
      showForm.value  = false;
      editingId.value = '';
    } catch (e: any) { errMsg.value = e.message; }
    finally          { saving.value = false; }
  };

  const remove = async (id: string) => {
    try {
      await api.templates.delete(id);
      templates.value = templates.value.filter((t) => t.id !== id);
      deleteId.value  = '';
      if (testingId.value === id) { testingId.value = ''; testResult.value = ''; }
    } catch (e: any) { errMsg.value = e.message; }
  };

  const openTest = (t: Template) => {
    const vars = extractVars(t.body_template);
    const initial: Record<string, string> = {};
    vars.forEach((v) => { initial[v] = ''; });
    testVars.value    = initial;
    testResult.value  = '';
    testingId.value   = testingId.value === t.id ? '' : t.id;
  };

  const runTest = async (id: string) => {
    testLoading.value = true;
    testResult.value  = '';
    try {
      const vars = Object.entries(testVars.value).map(([key, value]) => ({ key, value }));
      const { rendered } = await api.templates.test(id, vars);
      testResult.value = rendered;
    } catch (e: any) { testResult.value = '⚠ ' + e.message; }
    finally          { testLoading.value = false; }
  };

  const cancel = () => {
    showForm.value  = false;
    editingId.value = '';
    errMsg.value    = '';
  };

  if (!selectedAccount.value) {
    return (
      <div class="empty-state">
        <span class="material-symbols-rounded">description</span>
        <p>Select an account first</p>
      </div>
    );
  }

  return (
    <div style="max-width:720px">

      {/* ── Header ── */}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <div style="font-size:18px;font-weight:700">Email Templates</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
            Reusable reply templates with <code style="font-size:11px;background:var(--surface-2);padding:1px 5px;border-radius:4px">{'{{variable}}'}</code> placeholders
          </div>
        </div>
        <button class="btn btn-primary" onClick={openNew}>
          <span class="material-symbols-rounded">add</span>
          New Template
        </button>
      </div>

      {/* ── Error banner ── */}
      {errMsg.value && (
        <div style="padding:10px 14px;background:var(--c-critical-bg);color:var(--c-critical);border-radius:var(--r-md);margin-bottom:16px;font-size:13px;display:flex;justify-content:space-between;align-items:center">
          {errMsg.value}
          <button style="background:none;border:none;cursor:pointer;color:inherit;font-size:14px" onClick={() => { errMsg.value = ''; }}>✕</button>
        </div>
      )}

      {/* ── Create / Edit form ── */}
      {showForm.value && (
        <div class="card" style="margin-bottom:20px">
          <div style="font-weight:600;font-size:14px;margin-bottom:14px">
            {editingId.value ? 'Edit Template' : 'New Template'}
          </div>
          <div style="display:flex;flex-direction:column;gap:12px">

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <div class="field-label">Name *</div>
                <input class="md-input" style="margin-top:5px"
                  value={form.value.name}
                  onInput={(e: any) => { form.value = { ...form.value, name: e.target.value }; }}
                  placeholder="e.g. Meeting Acceptance, Payment Ack…" />
              </div>
              <div>
                <div class="field-label">Description</div>
                <input class="md-input" style="margin-top:5px"
                  value={form.value.description}
                  onInput={(e: any) => { form.value = { ...form.value, description: e.target.value }; }}
                  placeholder="When to use (optional)" />
              </div>
            </div>

            <div>
              <div class="field-label">Tone</div>
              <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
                {TONES.map((t) => (
                  <button key={t}
                    class={`btn ${form.value.tone === t ? 'btn-primary' : 'btn-outline'}`}
                    style="font-size:12px;height:28px;padding:0 12px;text-transform:capitalize"
                    onClick={() => { form.value = { ...form.value, tone: t }; }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div class="field-label">Body Template *</div>
              <div style="font-size:11px;color:var(--text-muted);margin:4px 0 6px">
                Use <code style="background:var(--surface-2);padding:1px 4px;border-radius:3px">{'{{variable_name}}'}</code> for dynamic values — they'll be filled in at send time.
              </div>
              <textarea class="edit-area" rows={10}
                style="font-family:var(--mono);font-size:12px;line-height:1.65"
                value={form.value.body_template}
                onInput={(e: any) => { form.value = { ...form.value, body_template: e.target.value }; }}
                placeholder={`Dear {{sender_name}},\n\nThank you for reaching out regarding {{subject}}.\n\n…\n\nBest regards`}
              />
              {form.value.body_template && (
                <div style="font-size:11px;color:var(--text-muted);margin-top:3px">
                  {form.value.body_template.length} chars
                  {extractVars(form.value.body_template).length > 0 && (
                    <> · Variables: {extractVars(form.value.body_template).map((v) => (
                      <code key={v} style="background:var(--accent-subtle);color:var(--accent);padding:1px 5px;border-radius:3px;margin-left:4px;font-size:10px">{`{{${v}}}`}</code>
                    ))}</>
                  )}
                </div>
              )}
            </div>

            <div style="display:flex;gap:8px;margin-top:4px">
              <button class="btn btn-primary" onClick={save} disabled={saving.value}>
                <span class="material-symbols-rounded" style="font-size:15px">check</span>
                {saving.value ? 'Saving…' : editingId.value ? 'Save Changes' : 'Create Template'}
              </button>
              <button class="btn btn-ghost" onClick={cancel}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── List ── */}
      {loading.value ? (
        <div class="empty-state">
          <span class="material-symbols-rounded">sync</span>
          <p>Loading…</p>
        </div>
      ) : templates.value.length === 0 && !showForm.value ? (
        <div class="empty-state" style="padding:48px">
          <span class="material-symbols-rounded" style="font-size:40px">description</span>
          <p>No templates yet</p>
          <p style="font-size:12px;color:var(--text-muted)">Create reusable reply templates with dynamic placeholders.</p>
          <button class="btn btn-primary" style="margin-top:12px" onClick={openNew}>
            <span class="material-symbols-rounded">add</span>
            New Template
          </button>
        </div>
      ) : (
        <div style="display:flex;flex-direction:column;gap:8px">
          {templates.value.map((t) => {
            const vars      = extractVars(t.body_template);
            const isTesting = testingId.value === t.id;
            const isDeleting = deleteId.value === t.id;

            return (
              <div key={t.id} class="card" style="padding:0;overflow:hidden">

                {/* Card header */}
                <div style="display:flex;align-items:center;gap:12px;padding:12px 16px">
                  <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--accent-subtle);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <span class="material-symbols-rounded" style="font-size:18px;color:var(--accent)">description</span>
                  </div>
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                      <span style="font-size:13px;font-weight:600">{t.name}</span>
                      {t.tone && (
                        <span class="chip" style="font-size:10px;text-transform:capitalize">{t.tone}</span>
                      )}
                      {t.times_used > 0 && (
                        <span style="font-size:11px;color:var(--text-muted)">used {t.times_used}×</span>
                      )}
                    </div>
                    {t.description && (
                      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">{t.description}</div>
                    )}
                    {vars.length > 0 && (
                      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">
                        {vars.map((v) => (
                          <code key={v} style="font-size:10px;background:var(--surface-2);padding:1px 6px;border-radius:3px;color:var(--text-secondary)">{`{{${v}}}`}</code>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style="display:flex;gap:6px;flex-shrink:0">
                    <button class="btn btn-ghost" style="height:28px;padding:0 8px" title="Test render"
                      onClick={() => openTest(t)}>
                      <span class="material-symbols-rounded" style="font-size:16px">
                        {isTesting ? 'expand_less' : 'play_arrow'}
                      </span>
                    </button>
                    <button class="btn btn-ghost" style="height:28px;padding:0 8px" title="Edit"
                      onClick={() => openEdit(t)}>
                      <span class="material-symbols-rounded" style="font-size:16px">edit</span>
                    </button>
                    <button class="btn btn-ghost btn-danger" style="height:28px;padding:0 8px" title="Delete"
                      onClick={() => { deleteId.value = isDeleting ? '' : t.id; }}>
                      <span class="material-symbols-rounded" style="font-size:16px">delete</span>
                    </button>
                  </div>
                </div>

                {/* Body preview */}
                <div style="padding:0 16px 12px;border-top:1px solid var(--border)">
                  <pre style="font-size:11px;font-family:var(--mono);color:var(--text-secondary);white-space:pre-wrap;margin:8px 0 0;max-height:72px;overflow:hidden;line-height:1.55">
                    {t.body_template}
                  </pre>
                </div>

                {/* Delete confirm */}
                {isDeleting && (
                  <div style="padding:10px 16px;border-top:1px solid var(--border);background:var(--c-critical-bg);display:flex;align-items:center;gap:10px">
                    <span style="font-size:13px;color:var(--c-critical);flex:1">Delete «{t.name}»?</span>
                    <button class="btn" style="height:28px;font-size:12px;background:var(--c-critical);color:#fff;padding:0 12px"
                      onClick={() => remove(t.id)}>Delete</button>
                    <button class="btn btn-ghost" style="height:28px;font-size:12px"
                      onClick={() => { deleteId.value = ''; }}>Cancel</button>
                  </div>
                )}

                {/* Test panel */}
                {isTesting && (
                  <div style="padding:14px 16px;border-top:1px solid var(--border);background:var(--surface-2)">
                    <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">
                      Test Render
                    </div>
                    {vars.length > 0 ? (
                      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:12px">
                        {vars.map((v) => (
                          <div key={v}>
                            <div class="field-label" style="margin-bottom:3px">{`{{${v}}}`}</div>
                            <input class="md-input" style="font-size:12px;height:30px"
                              value={testVars.value[v] ?? ''}
                              onInput={(e: any) => { testVars.value = { ...testVars.value, [v]: e.target.value }; }}
                              placeholder={`value for ${v}`} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">No variables — renders as-is.</div>
                    )}
                    <button class="btn btn-outline" style="height:30px;font-size:12px"
                      onClick={() => runTest(t.id)} disabled={testLoading.value}>
                      <span class="material-symbols-rounded" style="font-size:14px">
                        {testLoading.value ? 'sync' : 'play_arrow'}
                      </span>
                      {testLoading.value ? 'Rendering…' : 'Render'}
                    </button>
                    {testResult.value && (
                      <pre style="margin-top:12px;padding:12px;background:var(--surface-1);border:1px solid var(--border);border-radius:var(--r-md);font-size:12px;font-family:var(--mono);white-space:pre-wrap;line-height:1.6;color:var(--text-primary)">
                        {testResult.value}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
