import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { selectedAccount } from '../signals/store.ts';
import { api } from '../api/client.ts';

interface BuildResult {
  name:           string;
  description:    string;
  hooks:          string[];
  permissions:    { network: string[]; env: string[]; storage: boolean; emailSend: boolean };
  code:           string;
  pluginMd:       string;
  analysisReport: string;
  sandboxResult:  { success: boolean; output: string; error?: string; durationMs: number };
  ready:          boolean;
}

interface Plugin {
  name:        string;
  description: string;
  version:     string;
  enabled:     boolean;
  hooks:       string[];
  permissions: { network: string[]; env: string[] };
}

const GALLERY = [
  { label: '🎟 Jira Ticket',    desc: 'critical email → Jira ticket',       template: 'When a critical or high-priority email arrives, create a Jira ticket in project SUPPORT using JIRA_URL and JIRA_TOKEN.' },
  { label: '💬 Slack Summary',  desc: 'daily email digest to Slack',         template: 'After every high or critical email, send a summary to the Slack webhook at SLACK_WEBHOOK_URL.' },
  { label: '📅 Calendar Event', desc: 'email date → calendar event',         template: 'When an email contains a meeting date, create a Google Calendar event using GOOGLE_CALENDAR_TOKEN.' },
  { label: '📱 SMS Alert',      desc: 'urgent email → SMS',                  template: 'When an email from boss@company.com with "urgent" in the subject arrives, send an SMS via Twilio.' },
  { label: '📋 Notion Inbox',   desc: 'important emails → Notion database',  template: 'Save high and critical emails to a Notion database using NOTION_TOKEN.' },
  { label: '🔔 Webhook',        desc: 'send email data to any webhook',      template: 'After every email, POST its data to WEBHOOK_URL.' },
];

export function PluginBuilder() {
  const pageTab     = useSignal<'build' | 'manage'>('build');
  const description = useSignal('');
  const building    = useSignal(false);
  const result      = useSignal<BuildResult | null>(null);
  const error       = useSignal<string | null>(null);
  const activeTab   = useSignal<'spec' | 'code' | 'sandbox'>('spec');
  const enabling    = useSignal(false);
  const enabled     = useSignal(false);

  // manage tab
  const plugins     = useSignal<Plugin[]>([]);
  const pluginsLoad = useSignal(true);
  const pluginErr   = useSignal('');
  const viewCode    = useSignal<{ name: string; code: string; pluginMd: string } | null>(null);
  const toggling    = useSignal('');
  const deleting    = useSignal('');

  const loadPlugins = () => {
    pluginsLoad.value = true;
    pluginErr.value   = '';
    api.plugins.list()
      .then((data: any[]) => { plugins.value = data; })
      .catch((e: any)     => { pluginErr.value = e.message; })
      .finally(()         => { pluginsLoad.value = false; });
  };

  useEffect(() => {
    if (pageTab.value === 'manage') loadPlugins();
  }, [pageTab.value]);

  const togglePlugin = async (name: string, currentEnabled: boolean) => {
    toggling.value = name;
    try {
      if (currentEnabled) await api.plugins.disable(name);
      else                await api.plugins.enable(name);
      plugins.value = plugins.value.map((p) =>
        p.name === name ? { ...p, enabled: !currentEnabled } : p
      );
    } catch (e: any) { pluginErr.value = e.message; }
    finally          { toggling.value = ''; }
  };

  const deletePlugin = async (name: string) => {
    deleting.value = name;
    try {
      await api.plugins.delete(name);
      plugins.value = plugins.value.filter((p) => p.name !== name);
      if (viewCode.value?.name === name) viewCode.value = null;
    } catch (e: any) { pluginErr.value = e.message; }
    finally          { deleting.value = ''; }
  };

  const showCode = async (name: string) => {
    if (viewCode.value?.name === name) { viewCode.value = null; return; }
    try {
      const data = await api.plugins.getCode(name);
      viewCode.value = { name, ...data };
    } catch (e: any) { pluginErr.value = e.message; }
  };

  const build = async () => {
    if (!description.value.trim()) return;
    building.value = true;
    error.value    = null;
    result.value   = null;

    try {
      const accountId = selectedAccount.value ?? 'web-user';
      result.value = await api.plugins.build(description.value, accountId);
    } catch (e: any) {
      error.value = e.message;
    } finally {
      building.value = false;
    }
  };

  const enable = async () => {
    if (!result.value) return;
    enabling.value = true;
    try {
      await api.plugins.enable(result.value.name);
      enabled.value = true;
    } catch (e: any) {
      error.value = e.message;
    } finally {
      enabling.value = false;
    }
  };

  return (
    <div>
      {/* ── Page tabs ── */}
      <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px">
        {(['build', 'manage'] as const).map((t) => (
          <button key={t}
            onClick={() => { pageTab.value = t; }}
            style={`
              padding:8px 20px;background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;
              font-family:var(--font);
              color:${pageTab.value === t ? 'var(--accent)' : 'var(--text-muted)'};
              border-bottom:2px solid ${pageTab.value === t ? 'var(--accent)' : 'transparent'};
              margin-bottom:-2px;
            `}>
            {t === 'build' ? 'Build Plugin' : 'Installed Plugins'}
            {t === 'manage' && plugins.value.length > 0 && (
              <span class="chip" style="margin-left:6px;font-size:10px">{plugins.value.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════ MANAGE TAB ══════════ */}
      {pageTab.value === 'manage' && (
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <div style="font-size:12px;color:var(--text-muted)">
              Enable, disable or remove installed plugins. View generated code.
            </div>
            <button class="btn btn-ghost" style="height:28px;font-size:12px" onClick={loadPlugins}>
              <span class="material-symbols-rounded" style="font-size:14px">refresh</span>
            </button>
          </div>

          {pluginErr.value && (
            <div style="padding:10px 14px;background:var(--c-critical-bg);color:var(--c-critical);border-radius:var(--r-md);margin-bottom:14px;font-size:13px">
              {pluginErr.value}
            </div>
          )}

          {pluginsLoad.value ? (
            <div class="empty-state"><span class="material-symbols-rounded">sync</span><p>Loading…</p></div>
          ) : plugins.value.length === 0 ? (
            <div class="empty-state" style="padding:48px">
              <span class="material-symbols-rounded" style="font-size:40px">extension</span>
              <p>No plugins installed</p>
              <p style="font-size:12px">Switch to Build Plugin tab to create your first plugin.</p>
            </div>
          ) : (
            <div style="display:flex;flex-direction:column;gap:8px">
              {plugins.value.map((p) => (
                <div key={p.name} class="card" style="padding:0;overflow:hidden">
                  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px">
                    <div style={`width:36px;height:36px;border-radius:var(--r-md);background:${p.enabled ? 'var(--accent-subtle)' : 'var(--surface-2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0`}>
                      <span class="material-symbols-rounded" style={`font-size:18px;color:${p.enabled ? 'var(--accent)' : 'var(--text-muted)'}`}>extension</span>
                    </div>
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <span style="font-size:13px;font-weight:600">{p.name}</span>
                        <span class="chip" style={`font-size:10px;background:${p.enabled ? 'var(--c-low-bg)' : 'var(--surface-3)'};color:${p.enabled ? 'var(--c-low)' : 'var(--text-muted)'}`}>
                          {p.enabled ? 'Active' : 'Disabled'}
                        </span>
                        {p.version && <span style="font-size:11px;color:var(--text-muted)">v{p.version}</span>}
                      </div>
                      <div style="font-size:12px;color:var(--text-muted);margin-top:2px">{p.description}</div>
                      {p.hooks?.length > 0 && (
                        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">
                          {p.hooks.map((h: string) => (
                            <code key={h} style="font-size:10px;background:var(--surface-2);padding:1px 6px;border-radius:3px;color:var(--text-secondary)">{h}</code>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                      <button class="btn btn-ghost" style="height:28px;padding:0 8px" title="View code"
                        onClick={() => showCode(p.name)}>
                        <span class="material-symbols-rounded" style="font-size:16px">code</span>
                      </button>
                      <button class={`btn ${p.enabled ? 'btn-outline' : 'btn-primary'}`}
                        style="height:28px;font-size:12px;padding:0 12px"
                        disabled={toggling.value === p.name}
                        onClick={() => togglePlugin(p.name, p.enabled)}>
                        {toggling.value === p.name ? '…' : p.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button class="btn btn-ghost btn-danger" style="height:28px;padding:0 8px"
                        disabled={deleting.value === p.name}
                        onClick={() => deletePlugin(p.name)}>
                        <span class="material-symbols-rounded" style="font-size:16px">delete</span>
                      </button>
                    </div>
                  </div>
                  {viewCode.value?.name === p.name && (
                    <div style="border-top:1px solid var(--border);background:var(--surface-2)">
                      <div style="display:flex;gap:0;padding:0 16px;border-bottom:1px solid var(--border)">
                        {(['code', 'spec'] as const).map((tab) => (
                          <button key={tab} onClick={() => { activeTab.value = tab as any; }}
                            style={`padding:6px 14px;background:none;border:none;cursor:pointer;font-size:12px;font-weight:600;font-family:var(--font);color:${activeTab.value === tab ? 'var(--accent)' : 'var(--text-muted)'};border-bottom:2px solid ${activeTab.value === tab ? 'var(--accent)' : 'transparent'};margin-bottom:-1px`}>
                            {tab === 'code' ? 'Code' : 'Spec'}
                          </button>
                        ))}
                      </div>
                      <pre style="font-size:11px;font-family:var(--mono);white-space:pre-wrap;padding:12px 16px;max-height:300px;overflow:auto;margin:0;line-height:1.5;color:var(--text-primary)">
                        {activeTab.value === 'code' ? viewCode.value.code : viewCode.value.pluginMd}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════ BUILD TAB ══════════ */}
      {pageTab.value === 'build' && (<div>
      <div class="section-header">AI Plugin Builder</div>
      <p style="color:var(--text-muted);margin-bottom:20px;font-size:13px;line-height:1.6">
        Describe what the plugin should do — AI writes the code, tests it in a sandbox, and prepares it for activation.
      </p>

      {/* Gallery */}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-bottom:20px">
        {GALLERY.map((item) => (
          <button
            key={item.label}
            class="card"
            style="text-align:left;cursor:pointer;border:1px solid var(--border);width:100%;background:var(--surface-1)"
            onClick={() => { description.value = item.template; }}
          >
            <div style="font-size:13px;font-weight:600;margin-bottom:4px">{item.label}</div>
            <div style="font-size:12px;color:var(--text-muted)">{item.desc}</div>
          </button>
        ))}
      </div>

      {/* Input */}
      <div style="margin-bottom:16px">
        <textarea
          class="edit-area"
          value={description.value}
          onInput={(e) => { description.value = (e.target as HTMLTextAreaElement).value; }}
          placeholder="Example: When an email from hr@company.com arrives with 'vacation' in the subject, create a Google Calendar event..."
          rows={4}
          style="width:100%;resize:vertical"
        />
      </div>

      <button
        class="btn btn-primary"
        onClick={build}
        disabled={building.value || !description.value.trim()}
        style="min-width:160px"
      >
        {building.value ? '🔄 Building...' : '✨ Build with AI'}
      </button>

      {error.value && (
        <div style="margin-top:14px;padding:10px 14px;background:var(--c-critical-bg);border-radius:var(--r-md);color:var(--c-critical);font-size:13px">
          {error.value}
        </div>
      )}

      {/* Result */}
      {result.value && (
        <div style="margin-top:24px">
          <div style="height:1px;background:var(--border);margin-bottom:20px" />

          <div style="display:flex;align-items:center;gap:12px;margin:16px 0">
            <span style="font-size:15px;font-weight:600">{result.value.name}</span>
            <span class={`chip ${result.value.ready ? '' : ''}`} style={`background:${result.value.ready ? 'var(--c-low-bg)' : 'var(--c-critical-bg)'};color:${result.value.ready ? 'var(--c-low)' : 'var(--c-critical)'}`}>
              {result.value.ready ? 'Ready' : 'Failed'}
            </span>
          </div>
          <p style="color:var(--text-muted);margin-bottom:16px;font-size:13px">{result.value.description}</p>

          {/* Permissions summary */}
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
            {result.value.permissions.network.map((d) => (
              <span key={d} class="chip">Network: {d}</span>
            ))}
            {result.value.permissions.env.map((e) => (
              <span key={e} class="chip">Env: {e}</span>
            ))}
          </div>

          {/* Tabs */}
          <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:16px">
            {(['spec', 'code', 'sandbox'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { activeTab.value = tab; }}
                style={`
                  padding:8px 16px;border:none;background:none;
                  font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;
                  border-bottom:2px solid ${activeTab.value === tab ? 'var(--accent)' : 'transparent'};
                  margin-bottom:-2px;
                  color:${activeTab.value === tab ? 'var(--accent)' : 'var(--text-muted)'};
                `}
              >
                {tab === 'spec' ? 'Spec' : tab === 'code' ? 'Code' : 'Sandbox'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style="background:var(--surface-2);border-radius:var(--r-md);padding:16px;overflow:auto;max-height:400px">
            {activeTab.value === 'spec' && (
              <pre style="font-size:13px;white-space:pre-wrap;margin:0">{result.value.pluginMd}</pre>
            )}
            {activeTab.value === 'code' && (
              <pre style="font-size:12px;white-space:pre-wrap;margin:0;font-family:monospace">{result.value.code}</pre>
            )}
            {activeTab.value === 'sandbox' && (
              <div>
                <p style="margin-bottom:12px;font-size:13px">
                  {result.value.sandboxResult.success ? 'Pass' : 'Fail'} — {result.value.sandboxResult.durationMs}ms
                  {result.value.sandboxResult.error && <span style="color:var(--c-critical)"> — {result.value.sandboxResult.error}</span>}
                </p>
                <pre style="font-size:12px;white-space:pre-wrap;margin:0;font-family:var(--mono)">{result.value.analysisReport}</pre>
                <div style="height:1px;background:var(--border);margin:12px 0" />
                <pre style="font-size:12px;white-space:pre-wrap;margin:0">{result.value.sandboxResult.output}</pre>
              </div>
            )}
          </div>

          {/* Actions */}
          {result.value.ready && !enabled.value && (
            <div style="display:flex;gap:8px;margin-top:16px">
              <button class="btn btn-primary" onClick={enable} disabled={enabling.value}>
                {enabling.value ? 'Enabling…' : 'Enable Plugin'}
              </button>
              <button class="btn btn-outline" onClick={() => { result.value = null; description.value = ''; }}>
                Build Another
              </button>
            </div>
          )}
          {enabled.value && (
            <div style="margin-top:16px;padding:10px 14px;background:var(--c-low-bg);border-radius:var(--r-md);color:var(--c-low);font-weight:500">
              Plugin <strong>{result.value.name}</strong> is now active and will run on incoming emails.
            </div>
          )}
        </div>
      )}
      </div>)}
    </div>
  );
}
