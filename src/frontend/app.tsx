import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { LocationProvider, Router, Route } from 'preact-iso';
import { NavRail }          from './components/NavRail.tsx';
import { TopAppBar }        from './components/TopAppBar.tsx';
import { PageInfoContent }  from './components/PageInfo.tsx';
import { Inbox }            from './pages/Inbox.tsx';
import { Threads }          from './pages/Threads.tsx';
import { Analytics }        from './pages/Analytics.tsx';
import { Templates }        from './pages/Templates.tsx';
import { Scheduled }        from './pages/Scheduled.tsx';
import { Webhooks }         from './pages/Webhooks.tsx';
import { Settings }         from './pages/Settings.tsx';
import { PluginBuilder }    from './pages/PluginBuilder.tsx';
import { SenderOverrides }  from './pages/SenderOverrides.tsx';
import { PromptPlayground } from './pages/PromptPlayground.tsx';
import { Login }            from './pages/Login.tsx';
import { EmailTemplates }   from './pages/EmailTemplates.tsx';
import { Onboarding }       from './pages/Onboarding.tsx';
import { AgentChat }        from './components/AgentChat.tsx';
import { accounts, selectedAccount } from './signals/store.ts';
import { api, getToken, setToken, clearToken } from './api/client.ts';
import './styles/global.css';

const PAGE_TITLES: Record<string, string> = {
  '/agent/inbox':            'Inbox',
  '/agent/threads':          'Threads',
  '/agent/analytics':        'Analytics',
  '/agent/email-templates':  'Email Templates',
  '/agent/templates':        'AI Prompts',
  '/agent/scheduled':        'Scheduled',
  '/agent/webhooks':         'Webhooks',
  '/agent/plugins':          'Plugin Builder',
  '/agent/overrides':        'Sender Overrides',
  '/agent/playground':       'Prompt Playground',
  '/agent/settings':         'Settings',
};

const PAGE_INFO: Record<string, PageInfoContent> = {
  '/agent/threads': {
    description: 'View email conversations grouped by thread. Each thread shows all messages between you and a contact.',
    actions: [
      'Browse all email threads sorted by latest activity',
      'Expand a thread to read individual messages',
      'See AI-generated summaries for each message',
    ],
  },
  '/agent/analytics': {
    description: 'Monitor how the AI agent is performing — email volume, auto-reply rate, and top senders.',
    actions: [
      'Track accepted vs. rejected AI reply ratio',
      'View daily email volume for the last 30 days',
      'See which senders email you most frequently',
    ],
  },
  '/agent/email-templates': {
    description: 'Manage reusable email body templates with dynamic variables like {{name}} or {{date}}.',
    actions: [
      'Create templates with {{variable}} placeholders',
      'Test-render a template by filling in variables',
      'Edit or delete existing templates',
      'Pick a tone for each template (professional, friendly…)',
    ],
  },
  '/agent/templates': {
    description: 'Configure AI system prompts that control how the agent writes replies — globally or per email intent.',
    actions: [
      'Create a global prompt applied to all emails',
      'Create intent-specific prompts (e.g. for "support" emails only)',
      'Activate or deactivate individual prompt profiles',
      'Edit the prompt text at any time',
    ],
  },
  '/agent/scheduled': {
    description: 'See emails queued to be sent at a future time and manage the scheduled queue.',
    actions: [
      'View all pending scheduled emails with their send time',
      'Cancel a scheduled email before it is sent',
      'Filter by status: scheduled, sent, failed, or cancelled',
    ],
  },
  '/agent/webhooks': {
    description: 'Register HTTP endpoints to receive real-time notifications when the agent processes emails.',
    actions: [
      'Add a webhook URL for any event (email.received, reply.sent…)',
      'Enable or disable individual webhooks without deleting them',
      'Each delivery is signed with HMAC-SHA256 for verification',
      'Delete webhooks you no longer need',
    ],
  },
  '/agent/plugins': {
    description: 'Build custom automation plugins using AI — describe what you want and the agent writes, tests, and installs the code.',
    actions: [
      'Describe a plugin in plain text and let AI build it',
      'Review generated code and sandbox test results before enabling',
      'Enable or disable installed plugins at any time',
      'View the generated code and spec for any plugin',
    ],
  },
  '/agent/overrides': {
    description: 'Define custom behaviour for specific senders or domains — override tone, autonomy level, and routing.',
    actions: [
      'Match by exact email address or entire domain (*@company.com)',
      'Set autonomy level: auto-send, draft, or consult-only',
      'Override the reply tone per sender',
      'Forward emails from a sender to another address',
      'Restrict a rule to specific hours of the day',
    ],
  },
  '/agent/playground': {
    description: 'Test a system prompt against a sample email before applying it to your account — no real emails involved.',
    actions: [
      'Write or paste a system prompt',
      'Paste a sample email body to test against',
      'See the AI reply and token usage',
    ],
  },
  '/agent/settings': {
    description: 'Configure your email accounts, LLM provider, reply behaviour, and personal preferences.',
    actions: [
      'Connect Gmail, IMAP, or forwarding email accounts',
      'Authorize Gmail via OAuth (click the OAuth button on a Gmail account)',
      'Choose LLM provider and model (OpenAI, Claude, Gemini, Ollama…)',
      'Set reply tone and autonomy level',
      'Enable emoji, change language, or toggle shadow mode',
    ],
  },
};

export function App() {
  const path           = useSignal(window.location.pathname);
  const authed         = useSignal(!!getToken());
  const accsLoaded     = useSignal(false);
  const showOnboarding = useSignal(false);
  const magicPending   = useSignal(false);
  const isDemo         = useSignal(false);
  const chatOpen       = useSignal(false);

  // Magic link auto-login: ?magic=<token> in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magic  = params.get('magic');
    if (!magic || authed.value) return;

    magicPending.value = true;
    fetch(`/api/auth/magic/redeem?token=${encodeURIComponent(magic)}`)
      .then((r) => r.json())
      .then((data: any) => {
        if (data.token) {
          setToken(data.token);
          authed.value = true;
          // Strip magic param from URL without reload
          const clean = window.location.pathname;
          window.history.replaceState({}, '', clean);
        }
      })
      .catch(console.error)
      .finally(() => { magicPending.value = false; });
  }, []);

  useEffect(() => {
    const onLogout = () => { clearToken(); authed.value = false; };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  // Check demo mode once on mount
  useEffect(() => {
    fetch('/api/demo/status').then((r) => r.json()).then((d: any) => {
      if (d.demo) isDemo.value = true;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!authed.value) return;
    api.accounts.list().then((data) => {
      accounts.value = data;
      if (data.length && !selectedAccount.value) {
        selectedAccount.value = data[0].account_id;
      }
      // Show onboarding if no accounts, or returning from Gmail OAuth (pending key set)
      const pendingOAuth = !!localStorage.getItem('ea_onboarding_account');
      showOnboarding.value = data.length === 0 || pendingOAuth;
      accsLoaded.value = true;
    }).catch(console.error);
  }, [authed.value]);

  if (magicPending.value) {
    return (
      <div style="height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:var(--surface-1)">
        <span class="material-symbols-rounded" style="font-size:40px;color:var(--accent);animation:spin 1s linear infinite">sync</span>
        <div style="font-size:14px;color:var(--text-muted)">Signing you in…</div>
      </div>
    );
  }

  if (!authed.value) {
    return <Login onLogin={() => {
      authed.value = true;
      if (path.value.includes('login') || path.value === '/agent' || path.value === '/agent/' || path.value === '/') {
         path.value = '/agent/inbox';
      }
    }} />;
  }

  // While loading accounts, show nothing (avoids flash)
  if (!accsLoaded.value) return null;

  if (showOnboarding.value) {
    return (
      <Onboarding onComplete={() => {
        showOnboarding.value = false;
      }} />
    );
  }

  const isInbox = path.value === '/agent/inbox' || path.value === '/agent' || path.value === '/agent/';

  return (
    <LocationProvider>
      {isDemo.value && (
        <div class="demo-banner">
          <span class="material-symbols-rounded" style="font-size:16px">lock</span>
          <span>Demo mode — changes are disabled.</span>
          <a href="https://github.com/orilaxnet/catchwire-agent" target="_blank" rel="noopener">
            Fork to self-host →
          </a>
        </div>
      )}
      <div class={`app-shell${isDemo.value ? ' demo-offset' : ''}`}>
        <NavRail currentPath={path.value} />
        <div class="main-content">
          <TopAppBar
            title={isInbox ? 'Inbox' : (PAGE_TITLES[path.value] ?? 'Email Agent')}
            info={PAGE_INFO[path.value]}
            onChatToggle={() => { chatOpen.value = !chatOpen.value; }}
            chatOpen={chatOpen.value}
          />
          <div class={isInbox ? 'inbox-wrapper' : 'page-wrapper'}>
            <Router onRouteChange={(url) => { path.value = url; }}>
              <Route path="/agent"           component={Inbox}            />
              <Route path="/agent/"          component={Inbox}            />
              <Route path="/agent/inbox"     component={Inbox}            />
              <Route path="/agent/threads"    component={Threads}          />
              <Route path="/agent/analytics"  component={Analytics}        />
              <Route path="/agent/email-templates" component={EmailTemplates}  />
              <Route path="/agent/templates"      component={Templates}        />
              <Route path="/agent/scheduled"  component={Scheduled}        />
              <Route path="/agent/webhooks"   component={Webhooks}         />
              <Route path="/agent/plugins"    component={PluginBuilder}    />
              <Route path="/agent/overrides"  component={SenderOverrides}  />
              <Route path="/agent/playground" component={PromptPlayground} />
              <Route path="/agent/settings"   component={Settings}         />
            </Router>
          </div>
        </div>

        {/* Right sidebar: Agent Chat */}
        <AgentChat open={chatOpen.value} onClose={() => { chatOpen.value = false; }} />
      </div>
    </LocationProvider>
  );
}
