import { h } from 'preact';
import { useSignal } from '@preact/signals';
import { api, setToken } from '../api/client.ts';

interface Props {
  onLogin: () => void;
}

export function Login({ onLogin }: Props) {
  const username    = useSignal('');
  const password    = useSignal('');
  const confirm     = useSignal('');
  const error       = useSignal('');
  const loading     = useSignal(false);
  const isSetup     = useSignal<boolean | null>(null);

  // Check whether initial setup is needed
  if (isSetup.value === null) {
    api.auth.setupStatus()
      .then(({ needsSetup }) => { isSetup.value = needsSetup; })
      .catch(() => { isSetup.value = false; });
    return (
      <div class="login-container">
        <div class="login-card">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  const setupMode = isSetup.value;

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error.value   = '';
    loading.value = true;

    try {
      if (setupMode && password.value !== confirm.value) {
        error.value = 'Passwords do not match';
        return;
      }
      const fn = setupMode ? api.auth.setup : api.auth.login;
      const { token } = await fn(username.value, password.value);
      setToken(token);
      onLogin();
    } catch (err: any) {
      error.value = err.message ?? 'Login failed';
    } finally {
      loading.value = false;
    }
  }

  return (
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">
          <span class="login-icon">📧</span>
          <h1>Email Agent</h1>
          {setupMode && <p class="login-subtitle">Create admin account</p>}
        </div>

        <form onSubmit={handleSubmit} class="login-form">
          <div class="form-field">
            <label for="username">Username</label>
            <input
              id="username"
              type="text"
              value={username.value}
              onInput={(e) => { username.value = (e.target as HTMLInputElement).value; }}
              placeholder="admin"
              autocomplete="username"
              required
            />
          </div>

          <div class="form-field">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              value={password.value}
              onInput={(e) => { password.value = (e.target as HTMLInputElement).value; }}
              placeholder="••••••••"
              autocomplete={setupMode ? 'new-password' : 'current-password'}
              required
            />
          </div>

          {setupMode && (
            <div class="form-field">
              <label for="confirm">Confirm Password</label>
              <input
                id="confirm"
                type="password"
                value={confirm.value}
                onInput={(e) => { confirm.value = (e.target as HTMLInputElement).value; }}
                placeholder="••••••••"
                autocomplete="new-password"
                required
              />
            </div>
          )}

          {error.value && <p class="login-error">{error.value}</p>}

          <button type="submit" class="login-btn" disabled={loading.value}>
            {loading.value ? 'Please wait…' : setupMode ? 'Create Account' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
