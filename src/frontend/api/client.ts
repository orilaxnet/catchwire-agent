const BASE = '/api';

export const TOKEN_KEY = 'ea_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, { headers, ...options });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:logout'));
    throw new Error('Unauthenticated');
  }

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EmailItem {
  id:           string;
  account_id:   string;
  thread_id?:   string;
  from_address: string;
  sender_name?: string;
  subject:      string;
  summary?:     string;
  priority:     'critical' | 'high' | 'medium' | 'low';
  intent?:      string;
  created_at:   string;
  user_action?: string;
  agent_response?: {
    suggestedReplies?: Array<{ label: string; body: string }>;
    confidence?: number;
    summary?: string;
    priority?: string;
    intent?: string;
  };
}

export interface EmailDetail extends EmailItem {
  body?:        string;
  in_reply_to?: string;
  references?:  string;
  thread?:      Thread | null;
}

export interface Thread {
  id:              string;
  subject:         string;
  participants:    string[] | string;
  message_count:   number;
  summary?:        string;
  status:          string;
  last_message_at: string;
  first_message_at?: string;
}

export interface Account {
  account_id:    string;
  email_address: string;
  provider:      string;
}

export interface Stats {
  accountId:     string;
  acceptedRatio: number;
  avgResponseMs: number;
  last30Days:    Array<{ date: string; totalEmails: number; autoSent: number }>;
  topSenders:    Array<{ sender: string; count: number }>;
}

export interface SenderOverride {
  id:                string;
  account_id:        string;
  sender_email?:     string;
  sender_domain?:    string;
  priority:          number;
  autonomy_level:    string;
  tone?:             string;
  prompt_template?:  string;
  auto_reply:        boolean;
  forward_to?:       string;
  subject_contains?: string;
  time_start?:       string;
  time_end?:         string;
  enabled:           boolean;
}

export interface ScheduledEmail {
  id:         string;
  account_id: string;
  email_id?:  string;
  to_address: string;
  subject?:   string;
  body?:      string;
  send_at:    string;
  status:     'scheduled' | 'sent' | 'failed' | 'cancelled';
  created_at: string;
}

export interface Webhook {
  id:         string;
  url:        string;
  events:     string[];
  secret?:    string;
  enabled:    boolean;
  created_at: string;
}

export interface Template {
  id:          string;
  name:        string;
  description?: string;
  body_template: string;
  tone?:       string;
  times_used:  number;
  created_at:  string;
}

export interface PromptProfile {
  id:           string;
  account_id:   string;
  name:         string;
  description?: string;
  system_prompt: string;
  scope:        'global' | 'intent';
  intent_type?: string;
  is_active:    boolean;
  created_at:   string;
}

export interface Persona {
  tone:           string;
  autonomyLevel:  string;
  useEmoji:       boolean;
  language:       string;
  shadowMode:     boolean;
  onboardingDone: boolean;
  llmProvider?:   string;
  llmModel?:      string;
  hasApiKey:      boolean;
  systemPrompt?:  string;
}

// ── API client ─────────────────────────────────────────────────────────────────

export const api = {
  auth: {
    setupStatus: () => req<{ needsSetup: boolean; setupDone: boolean }>('/auth/setup-status'),
    setup: (username: string, password: string) =>
      req<{ token: string; userId: string }>('/auth/setup', {
        method: 'POST', body: JSON.stringify({ username, password }),
      }),
    login: (username: string, password: string) =>
      req<{ token: string; userId: string }>('/auth/login', {
        method: 'POST', body: JSON.stringify({ username, password }),
      }),
    refresh: () => req<{ token: string }>('/auth/refresh', { method: 'POST' }),
  },

  accounts: {
    list:   () => req<Account[]>('/accounts'),
    stats:  (id: string) => req<Stats>(`/accounts/${id}/stats`),
    persona: (id: string) => req<Persona>(`/accounts/${id}/persona`),
    updatePersona: (id: string, data: Partial<Persona & { llmApiKey?: string; llmModel?: string }>) =>
      req<{ ok: boolean }>(`/accounts/${id}/persona`, { method: 'PATCH', body: JSON.stringify(data) }),
    create: (data: {
      email_address: string;
      display_name?: string;
      account_type?: string;
      credentials?: object;
    }) => req<{ account_id: string; email_address: string; account_type: string }>('/accounts', {
      method: 'POST', body: JSON.stringify(data),
    }),
  },

  emails: {
    list:   (accountId: string, page = 1) =>
      req<EmailItem[]>(`/accounts/${accountId}/emails?page=${page}`),
    get:    (id: string) => req<EmailDetail>(`/emails/${id}`),
    reply:  (id: string, body: string, from?: string) =>
      req<{ success: boolean; messageId?: string }>(`/emails/${id}/reply`, {
        method: 'POST', body: JSON.stringify({ body, from }),
      }),
    regenerate: (id: string, instruction: string, accountId: string) =>
      req<{ suggestedReplies: Array<{ label: string; body: string; tone?: string }> }>(
        `/emails/${id}/regenerate`,
        { method: 'POST', body: JSON.stringify({ instruction, accountId }) }
      ),
  },

  threads: {
    list:    (accountId: string) => req<Thread[]>(`/accounts/${accountId}/threads`),
    summary: (threadId: string)  => req<{ thread: Thread; messages: EmailItem[] }>(`/threads/${threadId}/summary`),
  },

  scheduled: {
    list:   (accountId: string, status = 'scheduled') =>
      req<ScheduledEmail[]>(`/scheduled?accountId=${accountId}&status=${status}`),
    cancel: (id: string) =>
      req<{ success: boolean }>(`/scheduled/${id}`, { method: 'DELETE' }),
  },

  overrides: {
    list:   (accountId: string) =>
      req<SenderOverride[]>(`/accounts/${accountId}/overrides`),
    create: (accountId: string, data: Partial<SenderOverride>) =>
      req<SenderOverride>(`/accounts/${accountId}/overrides`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    update: (accountId: string, overrideId: string, data: Partial<SenderOverride>) =>
      req<SenderOverride>(`/accounts/${accountId}/overrides/${overrideId}`, {
        method: 'PATCH', body: JSON.stringify(data),
      }),
    delete: (accountId: string, overrideId: string) =>
      req<{ success: boolean }>(`/accounts/${accountId}/overrides/${overrideId}`, {
        method: 'DELETE',
      }),
  },

  webhooks: {
    list:   ()                          => req<Webhook[]>('/webhooks'),
    create: (data: { url: string; events: string[]; secret?: string }) =>
      req<Webhook>('/webhooks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { enabled?: boolean; events?: string[] }) =>
      req<Webhook>(`/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) =>
      req<{ success: boolean }>(`/webhooks/${id}`, { method: 'DELETE' }),
  },

  templates: {
    list:   (accountId: string)         => req<Template[]>(`/accounts/${accountId}/templates`),
    listAll: ()                         => req<Template[]>('/templates'),
    create: (data: { name: string; body_template: string; tone?: string; description?: string; account_id?: string }) =>
      req<Template>('/templates', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; description?: string; body_template?: string; tone?: string }) =>
      req<Template>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    test:   (id: string, variables: Array<{ key: string; value: string }>) =>
      req<{ rendered: string; subject?: string }>(`/templates/${id}/test`, {
        method: 'POST', body: JSON.stringify(variables),
      }),
    delete: (id: string) =>
      req<{ success: boolean }>(`/templates/${id}`, { method: 'DELETE' }),
  },

  prompts: {
    list:       (accountId: string) => req<PromptProfile[]>(`/accounts/${accountId}/prompts`),
    save:       (accountId: string, data: { name: string; system_prompt: string; description?: string; scope?: 'global' | 'intent'; intent_type?: string; activate?: boolean }) =>
      req<PromptProfile>(`/accounts/${accountId}/prompts`, { method: 'POST', body: JSON.stringify(data) }),
    update:     (accountId: string, id: string, data: { name?: string; description?: string; system_prompt?: string }) =>
      req<PromptProfile>(`/accounts/${accountId}/prompts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    activate:   (accountId: string, id: string) =>
      req<{ success: boolean }>(`/accounts/${accountId}/prompts/${id}/activate`, { method: 'POST' }),
    deactivate: (accountId: string) =>
      req<{ success: boolean }>(`/accounts/${accountId}/prompts/deactivate`, { method: 'POST' }),
    delete:     (accountId: string, id: string) =>
      req<{ success: boolean }>(`/accounts/${accountId}/prompts/${id}`, { method: 'DELETE' }),
  },

  playground: {
    run: (accountId: string, prompt: string, sampleEmail: string) =>
      req<{ result: string; tokens: number }>('/playground/run', {
        method: 'POST', body: JSON.stringify({ accountId, prompt, sampleEmail }),
      }),
  },

  actions: {
    send:   (emailId: string) =>
      req<{ ok: boolean }>('/actions/send', {
        method: 'POST', body: JSON.stringify({ emailId }),
      }),
    ignore: (emailId: string) =>
      req<{ ok: boolean }>('/actions/ignore', {
        method: 'POST', body: JSON.stringify({ emailId }),
      }),
  },

  chat: {
    send: (accountId: string, message: string, history: Array<{role:'user'|'assistant'; content:string}> = []) =>
      req<{ reply: string; action: string; task?: any; result?: any; previewCount?: number }>(
        '/chat', { method: 'POST', body: JSON.stringify({ accountId, message, history }) }
      ),
    execute: (accountId: string, task: any) =>
      req<{ reply: string; result: any }>(
        '/chat/execute', { method: 'POST', body: JSON.stringify({ accountId, task }) }
      ),
  },

  integrations: {
    info: () => req<{ telegramEnabled: boolean; smtpEnabled: boolean; smtpPort: number; apiBaseUrl: string }>('/integrations'),
  },

  plugins: {
    list:    ()                            => req<any[]>('/plugins'),
    build:   (description: string, accountId: string) =>
      req<any>('/plugins/build', {
        method: 'POST', body: JSON.stringify({ description, accountId }),
      }),
    enable:  (name: string) =>
      req<{ success: boolean }>(`/plugins/${name}/enable`, { method: 'POST' }),
    disable: (name: string) =>
      req<{ success: boolean }>(`/plugins/${name}/disable`, { method: 'POST' }),
    delete:  (name: string) =>
      req<{ success: boolean }>(`/plugins/${name}`, { method: 'DELETE' }),
    getCode: (name: string) =>
      req<{ code: string; pluginMd: string }>(`/plugins/${name}/code`),
  },
};
