# Catchwire Agent

> AI-powered email automation agent — reads, classifies, and replies to your emails so you don't have to.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](tsconfig.json)

**Website:** [catchwire.synthesislogic.com](https://catchwire.synthesislogic.com/)  
**Contact:** hello@synthesislogic.com  
**License:** Apache 2.0

---

## Live Demo

Try the agent with pre-loaded demo data — no sign-up required.

**[https://catchwire.synthesislogic.com/agent](https://catchwire.synthesislogic.com/agent)**

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `admin1234` |

The demo inbox contains sample emails across multiple intents (support, billing, security, scheduling), pre-configured webhooks, sender overrides, AI prompt profiles, and 30 days of analytics data.

---

## What Is It?

Catchwire Agent is a self-hosted AI email assistant. It connects to your Gmail or IMAP inbox, reads incoming emails, classifies them by intent and priority, generates context-aware replies using any major LLM, and either sends them automatically or queues them for your review.

You control everything: which emails get auto-replied, what tone to use, which LLM provider and model to call, and what happens for specific senders or domains. There is a browser-based UI for managing everything, a WebSocket-powered inbox, and a REST API for integration with external tools like n8n or custom agents.

---

## Features

### Email Ingestion
- **Gmail** via Google OAuth 2.0 + Pub/Sub push webhooks (real-time)
- **IMAP** polling with configurable interval (Gmail, Outlook, Fastmail, any IMAP server)
- **SMTP server** — receive forwarded email on a custom port (no third-party dependency)
- **Multi-account** — connect and manage multiple inboxes from one dashboard

### AI Processing
- Email parsing: sender, subject, body, quoted text, attachments metadata
- Intent classification: support, sales, meeting request, newsletter, spam, etc.
- Priority scoring: critical / high / medium / low
- Context-aware reply generation with persona (tone, language, emoji preference)
- **Layered prompt system**: global base prompt + per-intent overrides, all user-editable
- **Prompt Playground**: test any prompt against any sample email before applying

### Reply Management
- **Auto-send mode**: reply immediately without human review
- **Draft mode**: generate a reply, hold for approval
- **Consult-only**: surface email with summary, never auto-reply
- Scheduled sending: queue replies for a specific date and time
- One-click approve / edit / reject in the inbox UI

### Sender Overrides
- Per-sender or per-domain rules (`*@company.com`)
- Override autonomy level, tone, or forward to another address
- Restrict rules to specific hours of the day

### Email Templates
- Reusable body templates with `{{variable}}` placeholders
- Test-render with live variable substitution
- Tone selection per template

### Plugin System
- Describe a plugin in plain English — the AI writes, tests, and installs the code
- Sandboxed execution via Node.js `vm` module
- Built-in plugins: Google Calendar, Slack notifications, Notion
- Enable / disable / delete plugins from the UI
- View generated code and spec for any installed plugin

### Webhooks
- Register HTTP endpoints for any event (`email.received`, `reply.sent`, `reply.rejected`, etc.)
- HMAC-SHA256 signed payloads for verification
- Enable / disable individual webhooks without deleting

### Analytics
- Daily email volume chart (last 30 days)
- Auto-reply acceptance vs. rejection ratio
- Top senders by email volume
- Per-account stats

### Integrations
- **REST API** — all agent actions available via authenticated HTTP endpoints
- **WebSocket** — real-time push updates to the browser inbox
- **n8n / Make / Zapier** — trigger workflows via outbound webhooks on any event
- **Custom agents / OpenClaw** — any tool that can make HTTP requests can query or control the agent through the API
- **Telegram bot interface** (built-in, optional)
- **Slack, Discord, WhatsApp, iMessage** interface stubs (scaffolding present, not production-ready)

---

## Security

### Authentication & Authorization
- JWT-based authentication with 1-hour token expiry
- Tokens signed with a user-defined `JWT_SECRET` (min 32 characters recommended)
- All API endpoints except `/api/auth/login` and `/api/auth/register` require a valid JWT
- WebSocket connections authenticated via token in query string or `Authorization` header
- No JWT tokens exposed in server-side logs

### Encryption
- All stored credentials (IMAP passwords, OAuth tokens, API keys) encrypted with AES-256-GCM
- Unique IV per encryption operation
- Encryption key loaded from `ENCRYPTION_KEY` environment variable — never stored in the database

### Transport Security
- HTTPS / HSTS enforced in production (`NODE_ENV=production`): `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- CORS restricted to explicit origin allowlist (`CORS_ORIGINS` env var); same-origin only by default
- Secure headers on every response:
  - `Content-Security-Policy`: default-src 'self', no inline scripts
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: geolocation=(), microphone=(), camera=()`

### Rate Limiting
- Per-IP rate limits on all API routes and auth endpoints
- Auth endpoints (`/api/auth/*`) have tighter limits to resist brute-force
- Gmail OAuth start endpoint rate-limited separately

### Webhook Security
- All outbound webhook payloads signed with HMAC-SHA256 (`X-Signature` header)
- Consumers can verify the signature using their shared secret

### Gmail OAuth
- CSRF state tokens generated with `crypto.randomBytes(32)` for each OAuth flow
- State tokens expire after 10 minutes and are single-use
- Tokens compared with `timingSafeEqual` to prevent timing attacks

### Input Validation
- JSON request body capped at 512 KB
- SQL queries use parameterized statements throughout — no string interpolation
- Template variable substitution uses plain string replacement (no regex injection via user-controlled keys)

### Plugin Sandbox
- Plugin code runs inside Node.js `vm` module with a restricted context
- Static analysis checks for obviously dangerous patterns before execution
- **Note:** `vm` is not a true security boundary. Treat plugin code as trusted user code, not untrusted third-party code.

### What Is Not Covered
- No WAF or DDoS protection — use a reverse proxy (Nginx, Cloudflare) in front for production
- No secrets scanning on plugin code — do not allow untrusted users to submit plugins
- SMTP server has no authentication by default — bind to localhost and use a trusted relay for outbound

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Catchwire Agent                   │
│                                                     │
│  Ingestion Layer                                    │
│  ├── Gmail Webhook (Pub/Sub push)                   │
│  ├── IMAP Poller (configurable interval)            │
│  ├── SMTP Server (port 2525 by default)             │
│  └── Multi-Account Router                          │
│                                                     │
│  Processing Pipeline                                │
│  ├── Email Parser (mailparser)                      │
│  ├── Intent Classifier (LLM)                        │
│  ├── Priority Scorer (LLM)                          │
│  ├── Context Builder (thread history)               │
│  ├── Prompt Engine (layered prompt system)          │
│  └── Reply Generator (LLM)                         │
│                                                     │
│  Action Layer                                       │
│  ├── Auto-send / Draft / Consult                    │
│  ├── Scheduled Queue (Bull + Redis)                 │
│  ├── Plugin Runner (sandboxed vm)                   │
│  └── Webhook Dispatcher (HMAC-signed)               │
│                                                     │
│  Storage                                            │
│  ├── PostgreSQL (primary — emails, threads, logs)   │
│  ├── Redis (queue, rate-limit counters)             │
│  └── SQLite (fallback / dev mode)                   │
│                                                     │
│  Interfaces                                         │
│  ├── Web UI (Preact SPA — port 3000)                │
│  ├── REST API  /api/*                               │
│  ├── WebSocket (real-time inbox updates)            │
│  └── Telegram Bot (optional)                        │
└─────────────────────────────────────────────────────┘
```

### LLM Providers Supported

| Provider | Notes |
|---|---|
| **OpenRouter** | Default — access to hundreds of models via one API key |
| **OpenAI** | GPT-4o, GPT-4 Turbo, GPT-3.5 |
| **Claude (Anthropic)** | Claude Opus, Sonnet, Haiku |
| **Gemini (Google)** | Gemini 1.5 Flash, Pro |
| **Ollama** | Local models — no API key required |
| **Custom** | Any OpenAI-compatible endpoint |

Primary + fallback provider configuration is supported.

---

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or SQLite for local dev)
- Redis (required for scheduled sending; optional otherwise)
- An LLM API key (OpenRouter, OpenAI, Anthropic, or Google)

### 1. Clone and install

```bash
git clone https://github.com/yourusername/catchwire-agent.git
cd catchwire-agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — minimum required fields:

```env
# Auth
JWT_SECRET=change-this-to-a-random-64-char-string
ENCRYPTION_KEY=change-this-to-a-random-32-char-string

# LLM
LLM_PROVIDER=openrouter
LLM_API_KEY=sk-or-...
LLM_MODEL=google/gemini-flash-1.5

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/catchwire
```

### 3. Set up the database

```bash
npm run db:migrate
npm run db:seed        # optional demo data
```

### 4. Build and start

```bash
npm run build          # compiles TypeScript + Vite frontend
npm start              # starts the server on port 3000
```

Or for development with hot reload:

```bash
npm run dev            # backend with tsx watch
npm run dev:frontend   # Vite dev server (separate terminal)
```

Open **http://localhost:3000** — the landing page loads. Click "Get Started" or go directly to **http://localhost:3000/agent/inbox**.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | Yes | — | Secret for signing JWT tokens (min 32 chars) |
| `ENCRYPTION_KEY` | Yes | — | AES-256 key for credential encryption (32 chars) |
| `LLM_PROVIDER` | Yes | `openrouter` | `openrouter` \| `openai` \| `claude` \| `gemini` \| `ollama` \| `custom` |
| `LLM_API_KEY` | Yes* | — | API key for chosen provider (*not needed for Ollama) |
| `LLM_MODEL` | No | `google/gemini-flash-1.5` | Model identifier |
| `DATABASE_URL` | No | SQLite fallback | PostgreSQL connection string |
| `REDIS_URL` | No | — | Redis connection for job queues |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Set to `production` to enable HSTS and stricter settings |
| `CORS_ORIGINS` | No | — | Comma-separated allowed origins (empty = same-origin only) |
| `GMAIL_CLIENT_ID` | Gmail only | — | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Gmail only | — | Google OAuth client secret |
| `GMAIL_REDIRECT_URI` | Gmail only | — | OAuth callback URL |
| `TELEGRAM_BOT_TOKEN` | Telegram only | — | Token from @BotFather |
| `SMTP_PORT` | No | `2525` | Port for the built-in SMTP server |
| `LOG_LEVEL` | No | `info` | `debug` \| `info` \| `warn` \| `error` |

---

## API Reference

All endpoints are under `/api/`. Protected endpoints require `Authorization: Bearer <token>`.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login, returns JWT |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/refresh` | Refresh JWT |

### Accounts

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/accounts` | List connected email accounts |
| `POST` | `/api/accounts` | Add a new account |
| `DELETE` | `/api/accounts/:id` | Remove account |
| `GET` | `/api/accounts/:id/stats` | Account analytics |
| `GET` | `/api/accounts/:id/emails` | Paginated email log |
| `GET` | `/api/accounts/:id/threads` | Email threads |
| `GET` | `/api/accounts/:id/persona` | Account persona settings |

### Emails & Actions

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/actions/approve` | Approve a draft reply |
| `POST` | `/api/actions/reject` | Reject a draft reply |
| `POST` | `/api/actions/edit` | Edit and send a draft reply |

### Prompts (AI Prompt Profiles)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/prompts` | List all prompt profiles |
| `POST` | `/api/prompts` | Create a prompt profile |
| `PATCH` | `/api/prompts/:id` | Update a prompt profile |
| `DELETE` | `/api/prompts/:id` | Delete a prompt profile |
| `POST` | `/api/prompts/:id/activate` | Activate a profile |
| `POST` | `/api/prompts/:id/deactivate` | Deactivate a profile |

### Email Templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/accounts/:id/templates` | List templates for account |
| `POST` | `/api/templates` | Create a template |
| `PATCH` | `/api/templates/:id` | Update a template |
| `DELETE` | `/api/templates/:id` | Delete a template |
| `POST` | `/api/templates/:id/test` | Test-render with variables |

### Scheduled Emails

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/scheduled` | List scheduled emails |
| `DELETE` | `/api/scheduled/:id` | Cancel a scheduled email |

### Webhooks

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/webhooks` | List webhooks |
| `POST` | `/api/webhooks` | Register a webhook |
| `PATCH` | `/api/webhooks/:id` | Update webhook |
| `DELETE` | `/api/webhooks/:id` | Delete webhook |

### Sender Overrides

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/overrides` | List overrides |
| `POST` | `/api/overrides` | Create override |
| `PATCH` | `/api/overrides/:id` | Update override |
| `DELETE` | `/api/overrides/:id` | Delete override |

### Plugins

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/plugins` | List installed plugins |
| `POST` | `/api/plugins/build` | Build a plugin from description |
| `POST` | `/api/plugins/:id/enable` | Enable plugin |
| `POST` | `/api/plugins/:id/disable` | Disable plugin |
| `DELETE` | `/api/plugins/:id` | Delete plugin |

### Playground

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/playground/run` | Test a prompt against a sample email |

---

## Connecting External Agents

Catchwire Agent exposes a REST API that any external tool can use.

### n8n

1. Use the **HTTP Request** node with `POST /api/auth/login` to get a token
2. Store the token in n8n credentials
3. Register a webhook URL via `POST /api/webhooks` pointing to your n8n webhook node
4. On `email.received`, query `/api/accounts/:id/emails` or approve/reject via `/api/actions/*`

### Make (Integromat) / Zapier

Same approach — use the HTTP module to authenticate and call any API endpoint. Register an outbound webhook to trigger your scenario on each incoming email.

### Custom Agent / OpenClaw

The API is fully RESTful and JSON. Any agent framework can:
- Poll `/api/accounts/:id/emails` for new emails
- Call `POST /api/actions/approve` or `POST /api/actions/edit` to take action
- Use the WebSocket connection (`ws://host:3000?token=<jwt>`) for real-time events instead of polling

---

## Plugin System

Plugins extend the agent with custom logic that runs after an email is processed.

### Built-in Plugins

| Plugin | What it does |
|---|---|
| **Google Calendar** | Parses meeting requests and creates calendar events |
| **Slack Notify** | Posts a Slack message for high-priority emails |
| **Notion** | Creates a Notion database entry for each email |

### Building a Custom Plugin

In the UI, go to **Plugin Builder** → **Build Plugin** tab, describe what you want in plain text, and click **Build**. The AI generates the plugin code, runs it in a sandbox, and shows you the results before you enable it.

---

## What Is Not Yet Implemented

| Feature | Status |
|---|---|
| Slack / Discord / WhatsApp / iMessage interfaces | Scaffolding only — no message routing |
| Gmail Pub/Sub push setup | OAuth works; Pub/Sub subscription must be created manually in GCP |
| Multi-user / team support | Single-user only — no per-user data isolation |
| Mobile-optimized UI | Responsive but not optimized for small screens |
| Attachment handling | Metadata only — no download or inline display |
| Full thread summarization | Per-message summary only |
| Unsubscribe automation | Not implemented |
| DKIM / SPF for built-in SMTP | Not implemented — use a relay for production outbound mail |

---

## Project Structure

```
catchwire-agent/
├── src/
│   ├── main.ts                  # Entry point
│   ├── frontend/                # Preact SPA
│   │   ├── app.tsx
│   │   ├── pages/               # One file per page
│   │   ├── components/          # Shared UI components
│   │   ├── api/                 # API client
│   │   └── signals/             # Global state (Preact signals)
│   ├── interfaces/
│   │   ├── web/                 # Express server, routes, WebSocket
│   │   ├── telegram/
│   │   └── shared/
│   ├── ingestion/               # Gmail webhook, IMAP poller, SMTP server
│   ├── llm/                     # LLM router, prompt engine, provider adapters
│   ├── plugins/                 # Plugin manager, builder, sandbox runner
│   ├── analytics/               # Analytics engine
│   ├── scheduling/              # Bull queue for scheduled sends
│   ├── security/                # Encryption, credential manager, rate limiter
│   ├── storage/                 # PostgreSQL, Redis, SQLite adapters
│   └── utils/                   # Logger, helpers
├── public/
│   └── index.html               # Landing page (served at /)
├── scripts/                     # DB migration, seed, export/import
├── docs/                        # Internal documentation
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes and add tests where applicable
4. Run `npm test` and `npm run typecheck`
5. Submit a pull request

Please open an issue first for significant changes.

---

## License

Copyright 2024 Synthesis Logic  
Contact: hello@synthesislogic.com  
Website: https://catchwire.synthesislogic.com/

Licensed under the **Apache License, Version 2.0**. See [LICENSE](LICENSE) for the full text.
