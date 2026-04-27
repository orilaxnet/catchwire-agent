import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { selectedAccount, accounts } from '../signals/store.ts';
import { api } from '../api/client.ts';

const LLM_PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-v1-...' },
  { id: 'openai',     label: 'OpenAI',     placeholder: 'sk-...' },
  { id: 'gemini',     label: 'Gemini',     placeholder: 'AIza...' },
  { id: 'claude',     label: 'Claude',     placeholder: 'sk-ant-...' },
  { id: 'ollama',     label: 'Ollama',     placeholder: 'http://localhost:11434' },
  { id: 'custom',     label: 'Custom',     placeholder: 'API Key' },
] as const;

const LLM_MODELS: Record<string, string[]> = {
  openrouter: ['google/gemini-flash-1.5', 'google/gemini-2.0-flash-exp', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'meta-llama/llama-3.3-70b-instruct'],
  openai:     ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
  gemini:     ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  claude:     ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  ollama:     ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5', 'deepseek-r1'],
  custom:     [],
};

const TONES    = ['professional', 'friendly', 'formal', 'casual'] as const;
const AUTONOMY = [
  { id: 'full',         label: 'Auto-Send',    desc: 'Sends if AI confidence ≥ 90%' },
  { id: 'draft',        label: 'Draft Mode',   desc: 'Always asks before sending' },
  { id: 'consultative', label: 'Consult Only', desc: 'Shows summary, no draft' },
] as const;
const LANGUAGES = ['auto','en','fa','de','fr','es','ar','zh'] as const;

export function Settings() {
  const provider   = useSignal('openrouter');
  const llmModel   = useSignal('');
  const apiKey     = useSignal('');
  const baseUrl    = useSignal('');
  const tone       = useSignal('professional');
  const autonomy   = useSignal('draft');
  const language   = useSignal('auto');
  const useEmoji   = useSignal(false);
  const savedMsg   = useSignal('');
  const loadingP   = useSignal(false);
  const showKey    = useSignal(false);

  const showAddAcc = useSignal(false);
  const newEmail   = useSignal('');
  const newDisplay = useSignal('');
  const newType    = useSignal('imap');
  const imapHost   = useSignal('');
  const imapPort   = useSignal('993');
  const imapUser   = useSignal('');
  const imapPass   = useSignal('');
  const addingAcc  = useSignal(false);
  const addAccErr  = useSignal('');

  useEffect(() => {
    if (!selectedAccount.value) return;
    loadingP.value = true;
    api.accounts.persona(selectedAccount.value).then((p) => {
      provider.value  = p.llmProvider  ?? 'openrouter';
      llmModel.value  = p.llmModel     ?? '';
      tone.value      = p.tone         ?? 'professional';
      autonomy.value  = p.autonomyLevel ?? 'draft';
      language.value  = p.language     ?? 'auto';
      useEmoji.value  = p.useEmoji     ?? false;
    }).catch(console.error).finally(() => { loadingP.value = false; });
  }, [selectedAccount.value]);

  const savePersona = () => {
    if (!selectedAccount.value) return;
    const patch: any = {
      tone: tone.value, autonomyLevel: autonomy.value,
      language: language.value, useEmoji: useEmoji.value,
      llmProvider: provider.value,
      llmModel: llmModel.value || undefined,
    };
    if (apiKey.value.trim())  patch.llmApiKey = apiKey.value.trim();
    if (baseUrl.value.trim()) patch.llmBaseUrl = baseUrl.value.trim();

    api.accounts.updatePersona(selectedAccount.value, patch).then(() => {
      savedMsg.value = 'saved';
      apiKey.value   = '';
      setTimeout(() => { savedMsg.value = ''; }, 3000);
    }).catch((e) => { savedMsg.value = `error:${e.message}`; });
  };

  const addAccount = async () => {
    if (!newEmail.value.trim()) { addAccErr.value = 'Email is required'; return; }
    addingAcc.value = true; addAccErr.value = '';
    try {
      const creds = newType.value === 'imap' ? {
        imap_host: imapHost.value, imap_port: parseInt(imapPort.value),
        imap_user: imapUser.value || newEmail.value, imap_pass: imapPass.value,
      } : undefined;
      await api.accounts.create({
        email_address: newEmail.value.trim(),
        display_name:  newDisplay.value.trim() || undefined,
        account_type:  newType.value, credentials: creds,
      });
      const updated = await api.accounts.list();
      accounts.value = updated;
      showAddAcc.value = false;
      newEmail.value = newDisplay.value = imapHost.value = imapUser.value = imapPass.value = '';
    } catch (e: any) { addAccErr.value = e.message; }
    finally { addingAcc.value = false; }
  };

  const suggestedModels = LLM_MODELS[provider.value] ?? [];
  const providerInfo    = LLM_PROVIDERS.find((p) => p.id === provider.value);

  return (
    <div style="max-width:560px">

        {/* ── Accounts ── */}
        <section style="margin-bottom:32px">
          <div class="section-header">Email Accounts</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
            {accounts.value.length === 0 && (
              <div class="empty-state" style="padding:24px">
                <span class="material-symbols-rounded">email</span>
                <p>No accounts connected yet</p>
              </div>
            )}
            {accounts.value.map((a) => (
              <div key={a.account_id}
                onClick={() => { selectedAccount.value = a.account_id; }}
                style={`
                  display:flex;align-items:center;gap:12px;padding:10px 14px;
                  border-radius:var(--r-md);cursor:pointer;transition:background 100ms;
                  background:${a.account_id === selectedAccount.value ? 'var(--accent-subtle)' : 'var(--surface-2)'};
                  border:1.5px solid ${a.account_id === selectedAccount.value ? 'var(--accent)' : 'transparent'};
                `}>
                <span class="material-symbols-rounded" style="color:var(--accent);font-size:18px">email</span>
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:600">{a.email_address}</div>
                  <div style="font-size:11px;color:var(--text-muted)">{a.provider}</div>
                </div>
                {a.provider === 'gmail' && (
                  <a href={`/api/auth/gmail/start?accountId=${a.account_id}`}
                    class="btn btn-outline"
                    style="height:26px;font-size:11px;padding:0 10px;text-decoration:none"
                    title="Connect Gmail OAuth">
                    <span class="material-symbols-rounded" style="font-size:13px">link</span>
                    OAuth
                  </a>
                )}
                {a.account_id === selectedAccount.value && (
                  <span class="material-symbols-rounded" style="font-size:16px;color:var(--accent)">check_circle</span>
                )}
              </div>
            ))}
            <button class="btn btn-outline" style="align-self:flex-start;margin-top:4px"
              onClick={() => { showAddAcc.value = !showAddAcc.value; }}>
              <span class="material-symbols-rounded">add</span>
              Add Account
            </button>
          </div>

          {showAddAcc.value && (
            <div class="card" style="margin-bottom:16px">
              <div style="font-weight:600;font-size:13px;margin-bottom:12px">Connect Email Account</div>
              <div style="display:flex;flex-direction:column;gap:10px">
                <div>
                  <div class="field-label">Email Address *</div>
                  <input class="md-input" value={newEmail.value}
                    onInput={(e: any) => { newEmail.value = e.target.value; }}
                    placeholder="you@example.com" />
                </div>
                <div>
                  <div class="field-label">Display Name</div>
                  <input class="md-input" value={newDisplay.value}
                    onInput={(e: any) => { newDisplay.value = e.target.value; }}
                    placeholder="Optional display name" />
                </div>
                <div>
                  <div class="field-label">Account Type</div>
                  <select class="md-input" value={newType.value}
                    onChange={(e: any) => { newType.value = e.target.value; }}>
                    {['gmail','outlook','imap','forward'].map((t) => <option value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                {newType.value === 'imap' && (
                  <>
                    <div style="display:grid;grid-template-columns:1fr auto;gap:8px">
                      <div>
                        <div class="field-label">IMAP Host</div>
                        <input class="md-input" value={imapHost.value}
                          onInput={(e: any) => { imapHost.value = e.target.value; }}
                          placeholder="imap.gmail.com" />
                      </div>
                      <div style="width:80px">
                        <div class="field-label">Port</div>
                        <input class="md-input" value={imapPort.value} type="number"
                          onInput={(e: any) => { imapPort.value = e.target.value; }} />
                      </div>
                    </div>
                    <div>
                      <div class="field-label">Username</div>
                      <input class="md-input" value={imapUser.value}
                        onInput={(e: any) => { imapUser.value = e.target.value; }}
                        placeholder="Leave blank to use email address" />
                    </div>
                    <div>
                      <div class="field-label">Password / App Password</div>
                      <input class="md-input" type="password" value={imapPass.value}
                        onInput={(e: any) => { imapPass.value = e.target.value; }}
                        placeholder="••••••••" />
                    </div>
                  </>
                )}
                {addAccErr.value && (
                  <div style="font-size:12px;color:var(--c-critical)">{addAccErr.value}</div>
                )}
                <div style="display:flex;gap:8px;margin-top:4px">
                  <button class="btn btn-primary" onClick={addAccount} disabled={addingAcc.value}>
                    {addingAcc.value ? 'Connecting…' : 'Connect Account'}
                  </button>
                  <button class="btn btn-ghost" onClick={() => { showAddAcc.value = false; }}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </section>

        {selectedAccount.value && (
          <>
            <div class="divider" />

            {/* ── AI / LLM Config ── */}
            <section style="margin-top:24px;margin-bottom:32px">
              <div class="section-header" style="margin-bottom:16px">
                AI Configuration
                {loadingP.value && <span style="font-size:11px;color:var(--text-muted);margin-left:8px;font-weight:400">Loading…</span>}
              </div>

              {/* Provider selector */}
              <div style="margin-bottom:16px">
                <div class="field-label">LLM Provider</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                  {LLM_PROVIDERS.map((p) => (
                    <button key={p.id}
                      class={`btn ${provider.value === p.id ? 'btn-primary' : 'btn-outline'}`}
                      style="font-size:12px;height:30px;padding:0 12px"
                      onClick={() => { provider.value = p.id; llmModel.value = LLM_MODELS[p.id]?.[0] ?? ''; }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model */}
              <div style="margin-bottom:16px">
                <div class="field-label">Model</div>
                {suggestedModels.length > 0 ? (
                  <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
                    <div style="display:flex;flex-wrap:wrap;gap:6px">
                      {suggestedModels.map((m) => (
                        <button key={m}
                          class={`btn ${llmModel.value === m ? 'btn-primary' : 'btn-outline'}`}
                          style="font-size:11px;height:28px;padding:0 10px;font-family:var(--mono)"
                          onClick={() => { llmModel.value = m; }}>
                          {m.includes('/') ? m.split('/').pop() : m}
                        </button>
                      ))}
                    </div>
                    <input class="md-input" value={llmModel.value}
                      onInput={(e: any) => { llmModel.value = e.target.value; }}
                      placeholder="Or type a custom model name" style="margin-top:4px" />
                  </div>
                ) : (
                  <input class="md-input" value={llmModel.value}
                    onInput={(e: any) => { llmModel.value = e.target.value; }}
                    placeholder="model name or path" style="margin-top:6px" />
                )}
              </div>

              {/* API Key */}
              <div style="margin-bottom:16px">
                <div class="field-label">API Key</div>
                <div style="position:relative;margin-top:6px">
                  <input class="md-input" type={showKey.value ? 'text' : 'password'}
                    value={apiKey.value}
                    onInput={(e: any) => { apiKey.value = e.target.value; }}
                    placeholder={providerInfo?.placeholder ?? 'Leave blank to keep existing key'}
                    style="padding-right:40px" />
                  <button onClick={() => { showKey.value = !showKey.value; }}
                    style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0">
                    <span class="material-symbols-rounded" style="font-size:16px">
                      {showKey.value ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
                  Leave blank to keep the existing key. Stored encrypted in the database.
                </div>
              </div>

              {/* Base URL (Ollama / Custom) */}
              {(provider.value === 'ollama' || provider.value === 'custom') && (
                <div style="margin-bottom:16px">
                  <div class="field-label">Base URL</div>
                  <input class="md-input" value={baseUrl.value}
                    onInput={(e: any) => { baseUrl.value = e.target.value; }}
                    placeholder={provider.value === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
                    style="margin-top:6px" />
                </div>
              )}
            </section>

            <div class="divider" />

            {/* ── Behavior ── */}
            <section style="margin-top:24px;margin-bottom:32px">
              <div class="section-header" style="margin-bottom:16px">Reply Behavior</div>

              {/* Tone */}
              <div style="margin-bottom:16px">
                <div class="field-label">Reply Tone</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                  {TONES.map((t) => (
                    <button key={t}
                      class={`btn ${tone.value === t ? 'btn-primary' : 'btn-outline'}`}
                      style="font-size:12px;height:30px;padding:0 14px;text-transform:capitalize"
                      onClick={() => { tone.value = t; }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Autonomy */}
              <div style="margin-bottom:16px">
                <div class="field-label">Autonomy Level</div>
                <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
                  {AUTONOMY.map((a) => (
                    <label key={a.id} style={`
                      display:flex;align-items:center;gap:12px;padding:10px 14px;
                      border-radius:var(--r-md);cursor:pointer;transition:background 100ms;
                      background:${autonomy.value === a.id ? 'var(--accent-subtle)' : 'var(--surface-2)'};
                      border:1.5px solid ${autonomy.value === a.id ? 'var(--accent)' : 'transparent'};
                    `}>
                      <input type="radio" name="autonomy" value={a.id}
                        checked={autonomy.value === a.id}
                        onChange={() => { autonomy.value = a.id; }}
                        style="accent-color:var(--accent)" />
                      <div>
                        <div style="font-size:13px;font-weight:600">{a.label}</div>
                        <div style="font-size:11px;color:var(--text-muted)">{a.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div style="margin-bottom:16px">
                <div class="field-label">Reply Language</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                  {LANGUAGES.map((l) => (
                    <button key={l}
                      class={`btn ${language.value === l ? 'btn-primary' : 'btn-outline'}`}
                      style="font-size:12px;height:30px;padding:0 12px"
                      onClick={() => { language.value = l; }}>
                      {l === 'auto' ? 'Auto Detect' : l.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Emoji */}
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;background:var(--surface-2);border-radius:var(--r-md)">
                <input type="checkbox" checked={useEmoji.value}
                  onChange={(e: any) => { useEmoji.value = e.target.checked; }}
                  style="accent-color:var(--accent);width:16px;height:16px" />
                <div>
                  <div style="font-size:13px;font-weight:500">Use emoji in replies</div>
                  <div style="font-size:11px;color:var(--text-muted)">Add contextual emoji for a friendlier tone</div>
                </div>
              </label>
            </section>

            {/* ── Save ── */}
            <div style="display:flex;align-items:center;gap:12px;padding-bottom:40px">
              <button class="btn btn-primary" style="height:38px;padding:0 24px"
                onClick={savePersona} disabled={loadingP.value}>
                Save Settings
              </button>
              {savedMsg.value === 'saved' && (
                <span style="font-size:13px;color:var(--c-low);font-weight:500">✓ Settings saved</span>
              )}
              {savedMsg.value.startsWith('error:') && (
                <span style="font-size:13px;color:var(--c-critical)">{savedMsg.value.slice(6)}</span>
              )}
            </div>
          </>
        )}
    </div>
  );
}
