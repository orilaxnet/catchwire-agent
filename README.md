# Catchwire Agent

> A self-hosted AI email assistant that reads, classifies, and replies to your inbox — so you don't have to.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6)](tsconfig.json)
[![Build](https://img.shields.io/badge/build-passing-brightgreen)]()

**Website:** [catchwire.synthesislogic.com](https://catchwire.synthesislogic.com) &nbsp;·&nbsp;
**Contact:** hello@synthesislogic.com &nbsp;·&nbsp;
**License:** Apache 2.0

---

## Table of Contents

- [Live Demo](#live-demo)
- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Plugin System](#plugin-system)
- [Security](#security)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Live Demo

Try the agent with pre-loaded demo data — no sign-up required.

**[https://catchwire.synthesislogic.com/agent](https://catchwire.synthesislogic.com/agent)**

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin1234` |

The demo inbox includes sample emails across multiple intents (support, billing, security, scheduling), pre-configured webhooks, sender overrides, AI prompt profiles, and 30 days of analytics.

---

## Overview

Catchwire Agent connects to your Gmail or IMAP inbox and runs an autonomous AI pipeline on every incoming email:

1. **Parse** — extract sender, subject, body, quoted text, and attachment metadata
2. **Classify** — determine intent (support, meeting request, newsletter, invoice, …) and priority (critical → low)
3. **Generate** — compose a context-aware reply using your persona, style memory, and custom prompt profiles
4. **Act** — auto-send, queue as a draft, or flag for review — based on your per-account autonomy settings

Everything is configurable through a browser-based UI, a REST API, or natural-language commands in the built-in agent chat.

---

## Features

### Email Ingestion
- **Gmail** — OAuth 2.0 + Google Pub/Sub push webhooks (real-time)
- **IMAP** — polling with configurable interval (Gmail, Outlook, Fastmail, any IMAP server)
- **Built-in SMTP server** — receive forwarded mail on a custom port, no third-party dependency
- **Multi-account** — manage multiple inboxes from one dashboard

### AI Processing
- Intent classification and priority scoring via LLM
- Context-aware reply generation with configurable persona (tone, language, emoji preference)
- **Layered prompt system** — global base prompt + per-intent overrides, fully editable in the UI
- **Prompt Playground** — test any system prompt against a sample email before activating it
- **Style memory** — edit a draft reply and the agent stores your correction as a preference for that sender
- **Research-backed replies** — agent searches the web before composing replies on complex topics
- **Meeting coordination** — extracts meeting requests and surfaces available time slots

### Autonomous Task Runner

Natural-language commands via the Agent Chat sidebar:

```
"Unsubscribe me from all newsletters"
"Forward every invoice to accounting@company.com"
"Summarize everything from last week"
"Reply to all cold pitches with a polite decline"
"Find all emails about the Q3 project"
```

Destructive bulk actions show a preview count and sample before executing.

### Reply Management
- **Auto-send** — reply immediately without human review
- **Draft** — generate a reply, hold for one-click approve / edit / reject
- **Consult-only** — surface email with summary, never auto-reply
- **Scheduled sending** — queue replies for a specific date and time
- **Auto-unsubscribe** — HTTP-based unsubscription via `List-Unsubscribe` headers

### Inbox Intelligence
- **Natural-language search** — find emails by describing what you're looking for, no query syntax
- **Auto-label assignment** — tag incoming emails by intent, sender domain, and content rules
- **Persistent memory** — semantic + episodic store per sender, injected into future reply prompts
- **Thread reconstruction** — full conversation context built into every reply prompt
- **30-day analytics** — volume chart, auto-reply acceptance rate, top senders per account

### Configuration & Control
- **Sender overrides** — per-sender or per-domain rules: autonomy level, tone, forward-to address, time-of-day restrictions
- **Email templates** — reusable bodies with `{{variable}}` placeholders and live test-render
- **Plugin builder** — describe a plugin in plain English; AI writes, tests, and installs the code

### Integrations
- Full REST API + WebSocket for any external tool (n8n, Make, Zapier, custom agents)
- HMAC-SHA256 signed outbound webhooks on any event (`email.received`, `email.replied`, …)
- Optional Telegram bot interface for mobile inbox management

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                      Catchwire Agent                      │
│                                                           │
│  Ingestion                                                │
│  ├── Gmail Webhook    (Pub/Sub push)                      │
│  ├── IMAP Poller      (configurable interval)             │
│  ├── SMTP Server      (port 2525 default)                 │
│  └── Multi-Account Router                                 │
│                                                           │
│  Processing Pipeline                                      │
│  ├── Email Parser       (mailparser)                      │
│  ├── Intent Classifier  (LLM)                             │
│  ├── Priority Scorer    (LLM)                             │
│  ├── Context Builder    (thread history + sender memory)  │
│  ├── Prompt Engine      (layered profile system)          │
│  └── Reply Generator    (LLM)                             │
│                                                           │
│  Action Layer                                             │
│  ├── Auto-send / Draft / Consult routing                  │
│  ├── Scheduled Queue    (Bull + Redis)                    │
│  ├── Plugin Runner      (sandboxed vm)                    │
│  └── Webhook Dispatcher (HMAC-SHA256 signed)              │
│                                                           │
│  Storage                                                  │
│  ├── PostgreSQL  (emails, threads, personas, logs)        │
│  ├── Redis       (job queues, caching)                    │
│  └── SQLite      (fallback / local development)           │
│                                                           │
│  Interfaces                                               │
│  ├── Web UI      (Preact SPA — port 3000)                 │
│  ├── REST API    /api/*  (Express)                        │
│  ├── WebSocket   (real-time inbox push)                   │
│  └── Telegram Bot        (optional)                       │
└───────────────────────────────────────────────────────────┘
```

### Supported LLM Providers

| Provider | Notes |
|----------|-------|
| **OpenRouter** | Default — 200+ models via one API key |
| **OpenAI** | GPT-4o, GPT-4 Turbo, GPT-3.5 |
| **Anthropic (Claude)** | Claude Opus, Sonnet, Haiku |
| **Google (Gemini)** | Gemini 1.5 Flash / Pro |
| **Ollama** | Local models — no API key required |
| **Custom** | Any OpenAI-compatible endpoint (Grok, LM Studio, …) |

Primary + fallback provider configuration is supported per account.

---

## Quick Start

### Prerequisites

| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | ≥ 18 | |
| PostgreSQL | ≥ 14 | SQLite used as fallback in dev |
| Redis | ≥ 6 | Required for scheduled sending only |
| LLM API key | — | OpenRouter, OpenAI, Anthropic, or Google |

### 1. Clone and install

```bash
git clone https://github.com/orilaxnet/catchwire-agent.git
cd catchwire-agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Minimum required values:

```env
# Security
JWT_SECRET=your-random-64-character-string
ENCRYPTION_KEY=your-64-hex-character-string

# LLM
LLM_PROVIDER=openrouter
LLM_API_KEY=sk-or-your-api-key
LLM_MODEL=google/gemini-flash-1.5

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/catchwire
```

### 3. Initialise the database

```bash
npm run db:migrate       # create schema
npm run db:seed          # optional: load demo data
```

### 4. Build and run

```bash
# Production
npm run build            # compile TypeScript + Vite frontend
npm start                # serve on http://localhost:3000

# Development (hot reload)
npm run dev              # backend with tsx watch
npm run dev:frontend     # Vite dev server (separate terminal)
```

Open **http://localhost:3000**, complete the one-time setup wizard, then connect your first inbox.

---

## Configuration

### Full Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Token signing secret (min 32 chars) |
| `ENCRYPTION_KEY` | Yes | — | AES-256 key for credential encryption (64 hex chars / 32 bytes) |
| `LLM_PROVIDER` | Yes | `openrouter` | `openrouter` \| `openai` \| `claude` \| `gemini` \| `ollama` \| `custom` |
| `LLM_API_KEY` | Yes* | — | Provider API key (*not required for Ollama) |
| `LLM_MODEL` | No | `google/gemini-flash-1.5` | Model identifier string |
| `DATABASE_URL` | No | SQLite | PostgreSQL connection string |
| `REDIS_URL` | No | — | Redis URL for Bull job queues |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Set `production` to enable HSTS and strict security |
| `CORS_ORIGINS` | No | same-origin | Comma-separated list of allowed origins |
| `GMAIL_CLIENT_ID` | Gmail | — | Google OAuth 2.0 client ID |
| `GMAIL_CLIENT_SECRET` | Gmail | — | Google OAuth 2.0 client secret |
| `GMAIL_REDIRECT_URI` | Gmail | — | OAuth callback URL |
| `TELEGRAM_BOT_TOKEN` | Telegram | — | Token from @BotFather |
| `TELEGRAM_ALLOWED_USERS` | Telegram | — | Comma-separated Telegram user IDs (empty = open) |
| `SMTP_PORT` | No | `2525` | Built-in SMTP server port |
| `LOG_LEVEL` | No | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_FILE` | No | — | Path for rotating log file (max 10 MB × 5 files) |

---

## API Reference

All endpoints are under `/api/`. Protected endpoints require:

```
Authorization: Bearer <jwt>
```

> Full reference with request/response shapes: [`BACKEND_API.md`](BACKEND_API.md)

### Authentication

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `GET` | `/auth/setup-status` | Public | Check if first-time setup is needed |
| `POST` | `/auth/setup` | Public | One-time admin account creation |
| `POST` | `/auth/login` | Public | Username + password → JWT |
| `POST` | `/auth/refresh` | Public | Refresh a JWT |
| `POST` | `/auth/telegram` | Public | Telegram WebApp initData → JWT |
| `GET` | `/auth/magic/redeem` | Public | Exchange magic link token → JWT |
| `POST` | `/auth/magic/generate` | JWT | Generate a magic link (Telegram bot use) |

### Accounts & Emails

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/accounts` | List connected email accounts |
| `POST` | `/accounts` | Add a new account |
| `GET` | `/accounts/:id/stats` | 30-day analytics |
| `GET` | `/accounts/:id/emails` | Paginated email log (`?page=1`) |
| `GET` | `/accounts/:id/threads` | Latest 20 threads |
| `GET` | `/emails/:id` | Full email detail + thread |
| `POST` | `/emails/:id/reply` | Send a reply |
| `POST` | `/emails/:id/regenerate` | Regenerate AI reply with a new instruction |
| `POST` | `/emails/:id/unsubscribe` | Execute unsubscribe |
| `GET` | `/emails/:id/meeting-slots` | Extract meeting times + suggest slots |
| `GET` | `/threads/:id/summary` | Thread with all messages |

### Persona & Prompts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/accounts/:id/persona` | Get AI persona settings |
| `PATCH` | `/accounts/:id/persona` | Update tone, autonomy, LLM config |
| `POST` | `/accounts/:id/style-dna` | Extract writing style from sample emails |
| `GET` | `/accounts/:id/prompts` | List prompt profiles |
| `POST` | `/accounts/:id/prompts` | Create a profile (global or per-intent) |
| `PATCH` | `/accounts/:accountId/prompts/:id` | Update a profile |
| `DELETE` | `/accounts/:accountId/prompts/:id` | Delete a profile |
| `POST` | `/accounts/:accountId/prompts/:id/activate` | Set as active global prompt |
| `POST` | `/accounts/:id/prompts/deactivate` | Revert to built-in default |

### Templates, Overrides & Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/accounts/:id/templates` | Templates for an account |
| `POST` | `/templates` | Create a template |
| `PATCH` | `/templates/:id` | Update a template |
| `DELETE` | `/templates/:id` | Delete a template |
| `POST` | `/templates/:id/test` | Test-render with variables |
| `GET` | `/accounts/:id/overrides` | Sender overrides for an account |
| `POST` | `/accounts/:id/overrides` | Create a sender override |
| `PATCH` | `/accounts/:id/overrides/:overrideId` | Update an override |
| `DELETE` | `/accounts/:id/overrides/:overrideId` | Delete an override |
| `GET` | `/webhooks` | List registered webhooks |
| `POST` | `/webhooks` | Register a webhook |
| `PATCH` | `/webhooks/:id` | Update events or enabled state |
| `DELETE` | `/webhooks/:id` | Remove a webhook |

### Agent Chat, Tasks & Search

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Send a natural-language message to the agent |
| `POST` | `/chat/execute` | Confirm and execute a bulk task |
| `POST` | `/tasks/parse` | Parse a NL command into a structured task |
| `POST` | `/tasks/execute` | Execute a parsed task |
| `POST` | `/tasks/run` | Parse + execute in one request |
| `POST` | `/search` | Natural-language inbox search |
| `POST` | `/playground/run` | Test a prompt against a sample email |

### Memory & Labels

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/memory` | List agent memories for an account |
| `DELETE` | `/memory/:id` | Delete a memory |
| `GET` | `/labels` | List labels for an account |
| `POST` | `/labels` | Create a label |
| `DELETE` | `/labels/:id` | Remove a label |

### Plugins

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/plugins` | List installed plugins |
| `POST` | `/plugins/build` | Build a plugin from a plain-English description |
| `POST` | `/plugins/:name/enable` | Enable a plugin |
| `POST` | `/plugins/:name/disable` | Disable a plugin |
| `DELETE` | `/plugins/:name` | Delete a plugin |
| `GET` | `/plugins/:name/code` | View generated plugin code |

---

## Plugin System

Plugins extend the agent with custom logic that executes after each email is processed.

### Built-in Plugins

| Plugin | What it does |
|--------|-------------|
| **Google Calendar** | Detects meeting requests and creates calendar events |
| **Slack Notify** | Posts to a Slack channel for critical-priority emails |
| **Notion** | Creates a Notion database entry for each new email |

### Building a Custom Plugin

1. Go to **Settings → Plugin Builder** in the UI
2. Describe what you want in plain English — e.g. *"Create a Jira ticket for every bug report email and assign it to the on-call engineer"*
3. Click **Build** — the AI generates TypeScript code, runs static analysis, and executes it in a sandbox
4. Review the analysis report and sandbox output, then click **Enable**

Plugins run in a Node.js `vm` context with a restricted environment:

- No `require()`, no `eval()`, no dynamic `import()`
- No filesystem writes
- Network access limited to domains explicitly declared in the plugin spec
- All private/loopback IP addresses blocked unconditionally

> **Note:** Node.js `vm` is not a true security boundary. Treat plugin code as trusted code — do not allow untrusted users to submit plugins in a shared deployment.

---

## Security

### Authentication & Authorisation
- Custom HMAC-HS256 JWT with `timingSafeEqual` signature verification; 1-hour expiry
- Login timing oracle: scrypt always runs (even for unknown users) to prevent user enumeration via timing
- Magic links use atomic `DELETE ... RETURNING` — immune to race-condition double-redemption
- Every data endpoint enforces `user_id` ownership: cross-account access returns `403 Forbidden`
- `/auth/magic/generate` requires an authenticated JWT — it is not publicly callable

### Encryption
- IMAP passwords, OAuth tokens, and LLM API keys stored encrypted with AES-256-GCM
- Unique random IV per encryption operation; authentication tag verified on decrypt
- Master encryption key loaded exclusively from `ENCRYPTION_KEY` env var — never stored in the database

### Transport & Headers
- HSTS enabled in `NODE_ENV=production` (`max-age=63072000; includeSubDomains; preload`)
- CORS restricted to explicit origin allowlist via `CORS_ORIGINS`
- Full security header set on every response:

  | Header | Value |
  |--------|-------|
  | `Content-Security-Policy` | `default-src 'self'` — no inline scripts |
  | `X-Frame-Options` | `DENY` |
  | `X-Content-Type-Options` | `nosniff` |
  | `X-XSS-Protection` | `1; mode=block` |
  | `Referrer-Policy` | `strict-origin-when-cross-origin` |
  | `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` |

### SSRF Protection
- Outbound webhook URLs validated against a private-IP blocklist at both registration and delivery time (guards against DNS rebinding)
- IMAP `host` validated before test-connection (blocks `localhost`, RFC-1918, loopback, link-local)
- Unsubscribe URLs validated against the same blocklist before HTTP execution

### Rate Limiting
- Per-IP in-memory rate buckets on all routes
- Tighter window on auth endpoints (5 attempts / 5 minutes)

### Input Validation
- JSON body capped at 512 KB
- All SQL queries fully parameterised — zero string interpolation in queries
- Plugin code subject to static analysis before execution (blocked: `eval`, `new Function`, `child_process`, sandbox-escape vectors, `WebAssembly`)
- ReDoS guard on user-defined template regex patterns (pattern length cap + nested-quantifier detection)
- Email format validated at RFC-5321 ASCII grammar with a 320-character length cap

---

## Roadmap

| Feature | Status |
|---------|--------|
| Multi-user / team accounts | Planned |
| Attachment download and inline display | Planned |
| DKIM / SPF for built-in SMTP | Planned |
| Redis-backed rate limiting (multi-instance) | Planned |
| Gmail Pub/Sub auto-setup | Manual GCP setup required today |
| Slack / Discord native interface | Scaffolding only |
| Mobile-optimised UI | In progress |

---

## Project Structure

```
catchwire-agent/
├── src/
│   ├── main.ts                    # Entry point
│   ├── index.ts                   # App bootstrap
│   ├── types/index.ts             # Shared TypeScript types
│   │
│   ├── frontend/                  # Preact SPA
│   │   ├── app.tsx
│   │   ├── pages/                 # One file per page
│   │   ├── components/            # Shared UI components
│   │   ├── api/client.ts          # Typed API client
│   │   └── signals/store.ts       # Global state (Preact Signals)
│   │
│   ├── interfaces/
│   │   ├── web/                   # Express server, routes, middleware, WebSocket
│   │   ├── telegram/              # Telegraf bot + command handlers
│   │   └── shared/                # IUserInterface contract
│   │
│   ├── ingestion/                 # Gmail webhook, IMAP poller, SMTP server
│   ├── llm/                       # LLM router, prompt engine, provider adapters
│   ├── services/                  # Email sender, webhook dispatcher, unsubscriber
│   ├── plugins/                   # Plugin manager, builder, sandbox runner, analyzer
│   ├── analytics/                 # Analytics engine
│   ├── scheduling/                # Scheduled email queue, follow-up manager
│   ├── security/                  # Encryption, credential manager, rate limiter
│   ├── storage/                   # PostgreSQL, Redis, SQLite adapters
│   ├── memory/                    # Memory manager (semantic + episodic)
│   ├── persona/                   # Persona manager, style extractor
│   ├── template/                  # Template engine, macro expander
│   └── utils/                     # Logger, env validator
│
├── scripts/
│   ├── migrate.ts                 # Run database migrations
│   ├── seed.ts                    # Load demo data
│   ├── export.ts                  # Export all data to JSON
│   └── import.ts                  # Import from JSON backup
│
├── tests/
│   ├── unit/                      # Vitest unit tests
│   └── integration/               # Integration tests (real DB)
│
├── public/index.html              # Landing page (served at /)
├── BACKEND_API.md                 # Complete API reference with request/response shapes
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Contributing

1. Fork the repository and create a feature branch

   ```bash
   git checkout -b feat/your-feature
   ```

2. Install dependencies and start dev mode

   ```bash
   npm install
   npm run dev
   ```

3. Make your changes and add tests where applicable

4. Verify everything passes

   ```bash
   npm run typecheck
   npm test
   npm run lint
   ```

5. Submit a pull request with a clear description of the change and the motivation behind it

For significant changes, please open an issue first to discuss the approach.

---

## License

Copyright © 2024 Synthesis Logic  
Website: [catchwire.synthesislogic.com](https://catchwire.synthesislogic.com)  
Contact: [hello@synthesislogic.com](mailto:hello@synthesislogic.com)

Licensed under the **Apache License, Version 2.0** — see [`LICENSE`](LICENSE) for the full text.
