# Email Agent — Backend API Reference

> Auto-generated from source. All routes require `Authorization: Bearer <jwt>` unless marked **public**.
> Base URL: `/api`

---

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/setup-status` | public | Returns `{ needsSetup, setupDone }` — whether first-time setup is needed |
| POST | `/auth/setup` | public | One-time admin creation `{ username, password }` → `{ token, userId, expiresIn }` |
| POST | `/auth/login` | public | Username+password login → `{ token, userId, expiresIn }` |
| POST | `/auth/refresh` | public | Refresh JWT token → `{ token, expiresIn }` |
| POST | `/auth/telegram` | public | Telegram initData auth → `{ token, expiresIn }` |

Password rules: username ≥ 3 chars, password ≥ 8 chars.
Token expiry: 3600 seconds (1 hour).

---

## Accounts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/accounts` | List all enabled accounts → `[{ account_id, email_address, provider }]` |
| POST | `/accounts` | Create account `{ email_address, display_name?, account_type?, credentials? }` |
| GET | `/accounts/:id/stats` | 30-day analytics → `{ last30Days, acceptedRatio, topSenders, avgResponseMs }` |
| GET | `/accounts/:id/emails` | Paginated emails (20/page) query `?page=1` → `[EmailItem]` |
| GET | `/accounts/:id/threads` | Thread list (20 max) → `[Thread]` |
| GET | `/accounts/:id/templates` | Templates for account → `[Template]` |

**Account types:** `gmail` | `outlook` | `imap` | `forward`

### EmailItem shape
```json
{
  "id": "uuid",
  "account_id": "uuid",
  "thread_id": "uuid | null",
  "from_address": "user@example.com",
  "sender_name": "John Doe",
  "subject": "Hello",
  "summary": "AI-generated summary",
  "priority": "critical | high | medium | low",
  "intent": "question | complaint | request | info | ...",
  "agent_response": { "suggestedReplies": [{ "label": "Accept", "body": "..." }], "confidence": 0.92 },
  "user_action": "sent_as_is | ignored | replied | null",
  "created_at": "ISO-8601"
}
```

---

## Emails

| Method | Path | Description |
|--------|------|-------------|
| GET | `/emails/:id` | Full email detail including thread → `{ ...EmailItem, body, thread }` |
| POST | `/emails/:id/reply` | Send reply `{ body, from? }` → `{ success, messageId?, error? }` |
| GET | `/threads/:id/summary` | Thread messages → `{ thread, messages: [EmailItem] }` |

---

## Persona (per-account AI settings)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/accounts/:id/persona` | Load persona → `{ tone, autonomyLevel, useEmoji, language, shadowMode, onboardingDone, llmProvider, llmModel, hasApiKey }` |
| PATCH | `/accounts/:id/persona` | Update persona `{ tone?, autonomyLevel?, useEmoji?, language?, llmProvider?, llmModel?, llmApiKey? }` |

**Tone values:** `professional` | `friendly` | `formal` | `casual`
**Autonomy values:**
- `full` — auto-sends if AI confidence ≥ 90%
- `draft` — always asks before sending
- `consultative` — shows summary only, no draft

**LLM providers:** `openrouter` | `openai` | `gemini` | `claude` | `ollama` | `custom`

---

## Sender Overrides

Rule-based overrides per sender/domain — override AI behaviour for specific senders.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/accounts/:id/overrides` | List overrides (sorted by priority DESC) |
| POST | `/accounts/:id/overrides` | Create override |
| PATCH | `/accounts/:id/overrides/:oid` | Update override |
| DELETE | `/accounts/:id/overrides/:oid` | Delete override |

**Override fields:**
```json
{
  "sender_email": "specific@example.com",
  "sender_domain": "example.com",
  "subject_contains": "invoice",
  "priority": 50,
  "autonomy_level": "suggest | auto_reply | full_auto",
  "tone": "formal",
  "prompt_template": "Custom system prompt...",
  "auto_reply": false,
  "forward_to": "manager@company.com",
  "time_start": "09:00",
  "time_end": "17:00",
  "enabled": true
}
```

---

## Templates

Reusable reply templates with trigger matching.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/templates` | All templates sorted by usage |
| POST | `/templates` | Create template |
| POST | `/templates/:id/test` | Test render `{ variables: [{key,value}] }` → `{ rendered, subject? }` |
| GET | `/accounts/:id/templates` | Templates for specific account |

---

## Scheduled Emails

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scheduled` | List scheduled emails `?accountId=&status=scheduled` → `[ScheduledEmail]` |
| DELETE | `/scheduled/:id` | Cancel scheduled email (only if status=scheduled) |

**ScheduledEmail shape:**
```json
{
  "id": "uuid",
  "account_id": "uuid",
  "to_address": "user@example.com",
  "subject": "...",
  "body": "...",
  "send_at": "ISO-8601",
  "status": "scheduled | sent | failed | cancelled",
  "created_at": "ISO-8601"
}
```

---

## Webhooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/webhooks` | List all webhooks |
| POST | `/webhooks` | Create webhook `{ url, events[], secret? }` |
| PATCH | `/webhooks/:id` | Update `{ enabled?, events? }` |
| DELETE | `/webhooks/:id` | Delete webhook |

**Valid events:** `email.received` | `email.replied` | `email.ignored` | `priority.critical` | `draft.created` | `account.error`

Each delivery includes header `X-EmailAgent-Signature: sha256=<hmac>`.

---

## Actions (User Feedback)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/actions/send` | Record "sent" feedback `{ emailId, accountId }` |
| POST | `/actions/ignore` | Record "ignored" feedback `{ emailId, accountId }` |

---

## Playground

| Method | Path | Description |
|--------|------|-------------|
| POST | `/playground/run` | Test prompt `{ accountId?, prompt, sampleEmail }` → `{ result, tokens }` |

Prompt variables: `{{tone}}` `{{max_words}}` `{{email_body}}` `{{sender_name}}`
Limits: prompt ≤ 4096 chars, sampleEmail ≤ 8192 chars.

---

## Plugins

| Method | Path | Description |
|--------|------|-------------|
| GET | `/plugins` | List all plugins |
| POST | `/plugins/build` | AI-build plugin `{ description, accountId? }` |
| POST | `/plugins/:name/enable` | Enable plugin |
| POST | `/plugins/:name/disable` | Disable plugin |
| DELETE | `/plugins/:name` | Delete plugin |
| GET | `/plugins/:name/code` | View plugin code → `{ code, pluginMd }` |

---

## WebSocket

Connect to `ws://host/` with `?token=<jwt>` or `Authorization: Bearer <jwt>` header.
Real-time push of email events and notifications.

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | Admin/Telegram users with password hash |
| `email_accounts` | Connected email accounts |
| `personas` | Per-account AI configuration |
| `sender_overrides` | Rule-based sender handling |
| `threads` | Email conversation threads |
| `email_log` | All processed emails + AI analysis |
| `feedback` | User feedback on AI predictions |
| `email_templates` | Reusable reply templates |
| `scheduled_emails` | Outbound emails queued for later |
| `webhooks` | Outbound webhook registrations |
| `follow_ups` | Follow-up reminders |
| `macros` | Text expansion shortcuts |
| `analytics_daily` | Daily aggregated stats |
| `audit_log` | Security audit trail |
| `kv_store` | Generic key-value state |

---

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome menu |
| `/addaccount` | Connect email account |
| `/setllm` | Choose AI provider |
| `/setmodel <name>` | Set AI model |
| `/setstyle` | Upload writing samples |
| `/settings` | View/manage settings |
| `/analytics` | 7-day stats |
| `/deleteall` | Delete all data |
| `/help` | Help text |

---

## Webhook Events Dispatched

| Event | Trigger | Payload |
|-------|---------|---------|
| `email.received` | New email processed | `{ emailId, accountId, from, subject, priority, summary, agentDraft }` |
| `email.replied` | Reply sent | `{ emailId, accountId, to, auto }` |
| `priority.critical` | Critical email received | `{ emailId, accountId, from, subject, summary }` |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | ≥32 char secret for JWT signing |
| `ENCRYPTION_KEY` | ✅ | — | Key for credential encryption |
| `LLM_PROVIDER` | — | `openrouter` | Default AI provider |
| `LLM_MODEL` | — | `google/gemini-flash-1.5` | Default AI model |
| `LLM_API_KEY` | — | — | AI provider API key |
| `TELEGRAM_BOT_TOKEN` | — | — | Telegram bot token |
| `TELEGRAM_ALLOWED_USERS` | — | — | Comma-separated Telegram user IDs |
| `GMAIL_CLIENT_ID` | — | — | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | — | — | Google OAuth client secret |
| `SMTP_HOST` | — | — | SMTP server host |
| `SMTP_PORT` | — | `25` | SMTP ingestion port |
| `CORS_ORIGINS` | — | — | Comma-separated allowed origins |
| `PORT` | — | `3000` | Web server port |
