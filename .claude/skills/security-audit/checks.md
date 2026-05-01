# Security Checks — 200+ Items

Each check has: **ID · Category · What to look for · Severity if found**

---

## A — Authentication & Session Management

| ID | What to look for | Severity |
|----|-----------------|----------|
| A01 | Passwords stored as plaintext or reversible encoding (base64, hex) | CRITICAL |
| A02 | Weak hashing: MD5, SHA1, SHA256 for passwords (no KDF) | CRITICAL |
| A03 | Missing salt in password hashing | HIGH |
| A04 | scrypt/bcrypt/argon2 with insufficient parameters (N<16384, rounds<10) | HIGH |
| A05 | JWT secret shorter than 256 bits (32 bytes) | HIGH |
| A06 | JWT `alg: none` accepted or `alg` header trusted from token | CRITICAL |
| A07 | JWT `exp` claim not validated | HIGH |
| A08 | JWT payload decoded but signature not verified | CRITICAL |
| A09 | Hardcoded JWT secret or API key in source code | CRITICAL |
| A10 | Session tokens in URL query parameters (logged by proxies) | HIGH |
| A11 | Session tokens in logs | HIGH |
| A12 | Missing timing-safe comparison for secrets (use `timingSafeEqual`) | MEDIUM |
| A13 | Login endpoint reveals whether username exists (timing or message difference) | MEDIUM |
| A14 | No rate limiting on login endpoint | HIGH |
| A15 | No account lockout after N failed attempts | MEDIUM |
| A16 | Password reset token not single-use or no expiry | HIGH |
| A17 | Magic link / one-time token: SELECT then DELETE (race condition) — use DELETE...RETURNING | MEDIUM |
| A18 | Token not invalidated on logout | MEDIUM |
| A19 | Refresh token reuse allowed without rotation | MEDIUM |
| A20 | Auth bypass via HTTP method override (X-HTTP-Method-Override) | HIGH |
| A21 | Default credentials left in code (admin/admin, test/test) | CRITICAL |
| A22 | Telegram initData not verified with HMAC before trusting user ID | CRITICAL |
| A23 | OAuth state parameter missing or not validated (CSRF on OAuth flow) | HIGH |
| A24 | OAuth redirect_uri not validated against allowlist | HIGH |
| A25 | Magic link or reset token guessable (< 128 bits entropy) | HIGH |

---

## B — Authorization & Access Control

| ID | What to look for | Severity |
|----|-----------------|----------|
| B01 | Route returns data for resource ID from URL without ownership check | CRITICAL |
| B02 | `GET /accounts` or similar list endpoint returns all records regardless of user | HIGH |
| B03 | DELETE/PATCH on a resource without verifying caller owns it | HIGH |
| B04 | `accountId` accepted from request body/query without ownership verification | HIGH |
| B05 | Admin-only route missing role check | CRITICAL |
| B06 | IDOR: incrementing/guessing integer IDs to access other users' data | HIGH |
| B07 | Insecure direct object reference on file download/upload | HIGH |
| B08 | Multi-tenant data leak: query missing `WHERE user_id = $n` | CRITICAL |
| B09 | Privilege escalation: user can modify their own role/permissions | CRITICAL |
| B10 | Missing `requireAuth` middleware on state-changing route | CRITICAL |
| B11 | `requireAuth` applied after route registration (middleware order bug) | CRITICAL |
| B12 | Unauthenticated endpoint that can create/modify data | HIGH |
| B13 | Sub-resource authorization missing (user owns parent but not child) | HIGH |
| B14 | Forceful browsing: static files with sensitive data not protected | MEDIUM |
| B15 | Frontend-only authorization check (no server-side verification) | HIGH |

---

## C — Injection

| ID | What to look for | Severity |
|----|-----------------|----------|
| C01 | SQL string concatenation: `` `SELECT ... WHERE id = '${input}'` `` | CRITICAL |
| C02 | SQL template literal with user input not using parameterized query | CRITICAL |
| C03 | `eval()` or `new Function(code)` with user-controlled input | CRITICAL |
| C04 | `child_process.exec()` or `execSync()` with user input (shell=true) | CRITICAL |
| C05 | `child_process.spawn()` with shell:true and user-controlled args | HIGH |
| C06 | Dynamic `require(userInput)` or `import(userInput)` | CRITICAL |
| C07 | LDAP injection: user input in LDAP filter without escaping | HIGH |
| C08 | XML/XPath injection: user input in XML query | HIGH |
| C09 | NoSQL injection: `{ $where: userInput }` or `{ $regex: userInput }` | HIGH |
| C10 | Template injection: user input rendered in server-side template (Handlebars, Pug, EJS) | HIGH |
| C11 | LLM prompt injection: unsanitized email content/subject embedded in LLM prompt | MEDIUM |
| C12 | Email header injection: CR/LF in From/To/Subject headers | HIGH |
| C13 | Log injection: user input logged with `\n` allowing fake log entries | LOW |
| C14 | ReDoS: `new RegExp(userInput)` or catastrophic backtracking regex | HIGH |
| C15 | CSV/formula injection: user data in CSV starting with `=`, `+`, `-`, `@` | MEDIUM |
| C16 | HTTP response splitting: `\r\n` in response headers from user input | HIGH |
| C17 | CRLF injection in redirects: `res.redirect(userInput)` | HIGH |

---

## D — Cross-Site Scripting (XSS)

| ID | What to look for | Severity |
|----|-----------------|----------|
| D01 | `innerHTML`, `outerHTML`, `document.write()` with user data | HIGH |
| D02 | `dangerouslySetInnerHTML` in React/Preact without escaping | HIGH |
| D03 | Server-rendered HTML with unescaped user data | HIGH |
| D04 | `href`, `src`, `action` attributes set to user-controlled URLs | HIGH |
| D05 | `javascript:` URLs not blocked in href validation | HIGH |
| D06 | Missing CSP (Content-Security-Policy) header | MEDIUM |
| D07 | CSP allows `unsafe-inline` or `unsafe-eval` | MEDIUM |
| D08 | Missing `X-Content-Type-Options: nosniff` header | LOW |
| D09 | Missing `X-Frame-Options` or `frame-ancestors` CSP directive | MEDIUM |
| D10 | DOM-based XSS: `location.hash`, `document.referrer` used without sanitization | HIGH |
| D11 | Telegram Markdown injection: LLM output in message with parse_mode: Markdown | MEDIUM |
| D12 | Stored XSS: user content saved to DB and rendered without escaping | HIGH |
| D13 | Reflected XSS: query param echoed in response | HIGH |

---

## E — Cryptography

| ID | What to look for | Severity |
|----|-----------------|----------|
| E01 | AES in ECB mode (no IV) | CRITICAL |
| E02 | AES-CBC without authentication (no HMAC/GCM) — malleable | HIGH |
| E03 | IV/nonce reuse in AES-GCM | CRITICAL |
| E04 | IV/nonce not cryptographically random (`Math.random()` for IV) | HIGH |
| E05 | `Math.random()` used for security decisions (tokens, OTPs) | HIGH |
| E06 | `crypto.randomBytes()` output not checked for errors | LOW |
| E07 | Hardcoded encryption key in source | CRITICAL |
| E08 | Encryption key derived from low-entropy source | HIGH |
| E09 | MD5 or SHA1 used for security purposes | MEDIUM |
| E10 | RSA key shorter than 2048 bits | HIGH |
| E11 | TLS verification disabled (`rejectUnauthorized: false`) in production | HIGH |
| E12 | Secrets stored in localStorage or sessionStorage | MEDIUM |
| E13 | Encryption key in .env committed to version control | CRITICAL |
| E14 | Insufficient key length for AES (< 128 bit) | HIGH |
| E15 | HMAC comparison with `===` instead of `timingSafeEqual` | MEDIUM |

---

## F — Sensitive Data Exposure

| ID | What to look for | Severity |
|----|-----------------|----------|
| F01 | API keys, passwords, tokens in source code | CRITICAL |
| F02 | Secrets in comments | HIGH |
| F03 | Credentials in error messages sent to client | HIGH |
| F04 | Stack traces sent to client in error responses | MEDIUM |
| F05 | `err.message` returned in API response without sanitization | HIGH |
| F06 | Internal file paths in error responses | MEDIUM |
| F07 | Database schema/table names in error responses | MEDIUM |
| F08 | LLM API keys logged (even at debug level) | MEDIUM |
| F09 | IMAP/SMTP passwords logged | HIGH |
| F10 | LLM error response body logged (may contain auth info) | LOW |
| F11 | Sensitive fields in `console.log` | MEDIUM |
| F12 | PII (email, name, phone) logged unnecessarily | MEDIUM |
| F13 | JWT payload logged (contains user ID, claims) | LOW |
| F14 | Response includes fields the caller shouldn't see (e.g., `password_hash`) | HIGH |
| F15 | `/health` or `/metrics` endpoint exposing internal state | LOW |
| F16 | Version numbers in responses or headers (fingerprinting) | INFO |
| F17 | `X-Powered-By` header not removed | INFO |

---

## G — SSRF & Request Forgery

| ID | What to look for | Severity |
|----|-----------------|----------|
| G01 | `fetch(userInput)` or `axios.get(userInput)` without URL validation | CRITICAL |
| G02 | No private IP block: 127.x, 10.x, 172.16-31.x, 192.168.x, ::1 | CRITICAL |
| G03 | No protocol check: only http/https should be allowed | HIGH |
| G04 | DNS rebinding: URL checked at registration but re-fetched later | MEDIUM |
| G05 | `file://` protocol allowed in user-supplied URLs | HIGH |
| G06 | Redirect following to internal addresses | HIGH |
| G07 | Unsubscribe URL from email body fetched without SSRF check | HIGH |
| G08 | Webhook URL stored and later fetched without re-validation | MEDIUM |
| G09 | Image/resource proxy without URL validation | HIGH |
| G10 | XML external entity (XXE) in XML parser | HIGH |

---

## H — Rate Limiting & DoS

| ID | What to look for | Severity |
|----|-----------------|----------|
| H01 | Login endpoint not rate-limited | HIGH |
| H02 | LLM-triggering endpoints not rate-limited | HIGH |
| H03 | Email send endpoint not rate-limited | HIGH |
| H04 | Password reset / magic link generation not rate-limited | HIGH |
| H05 | Search endpoint not rate-limited (expensive queries) | MEDIUM |
| H06 | File upload without size limit | HIGH |
| H07 | JSON body parser without size limit | MEDIUM |
| H08 | No LIMIT on database queries (unbounded SELECT) | HIGH |
| H09 | Negative LIMIT value not clamped (SQL error or unexpected result) | MEDIUM |
| H10 | Recursive or nested data structures accepted without depth limit | MEDIUM |
| H11 | Long-running sync operations blocking event loop | MEDIUM |
| H12 | KV store / cache growth without TTL or eviction | MEDIUM |
| H13 | Array input not bounded (can send 100k items) | MEDIUM |
| H14 | Telegram callback data KV store growing without cleanup | MEDIUM |
| H15 | No database connection pool timeout or statement timeout | MEDIUM |
| H16 | ReDoS via user-controlled regex pattern | HIGH |

---

## I — File & Path Security

| ID | What to look for | Severity |
|----|-----------------|----------|
| I01 | Path traversal: `join(baseDir, userInput)` without validation | HIGH |
| I02 | `fs.readFile(userInput)` or similar with user-controlled path | CRITICAL |
| I03 | Plugin/config name used in file path without sanitization | HIGH |
| I04 | Zip/tar extraction without checking for `../` in entry names | HIGH |
| I05 | Symlink following in file operations | MEDIUM |
| I06 | Temp files with predictable names | LOW |
| I07 | Sensitive files (.env, private keys) in static serving directory | CRITICAL |
| I08 | File type validation by extension only (not magic bytes) | MEDIUM |
| I09 | Unlimited file size for uploads | HIGH |

---

## J — Input Validation

| ID | What to look for | Severity |
|----|-----------------|----------|
| J01 | TypeScript `as` cast used instead of runtime validation | MEDIUM |
| J02 | Missing required field check before use | MEDIUM |
| J03 | Missing string length cap on user input stored in DB | MEDIUM |
| J04 | Integer fields not validated as integers (could be NaN, Infinity, -1) | MEDIUM |
| J05 | Email field: permissive regex allows Unicode domains or control chars | LOW |
| J06 | URL field: only `http/https` should be allowed | HIGH |
| J07 | Enum/whitelist field: value not checked against allowlist | HIGH |
| J08 | Array input: no max length check | MEDIUM |
| J09 | Nested object input: prototype pollution risk (`__proto__`, `constructor`) | HIGH |
| J10 | `parseInt()` without radix (default radix 10 but explicit is safer) | INFO |
| J11 | `parseInt()` result not clamped — can be NaN or negative | MEDIUM |
| J12 | Date input not validated (can cause NaN or far-future date) | LOW |
| J13 | JSON.parse without try/catch | LOW |
| J14 | User-supplied regex compiled with `new RegExp(input)` | HIGH |
| J15 | CSV/TSV input: field count not validated | LOW |

---

## K — API Security

| ID | What to look for | Severity |
|----|-----------------|----------|
| K01 | CORS: wildcard `*` with `credentials: true` | HIGH |
| K02 | CORS allowlist includes `null` origin | HIGH |
| K03 | CORS allowlist not checked securely (substring match allows `evil.example.com`) | HIGH |
| K04 | Missing CORS configuration entirely on public API | MEDIUM |
| K05 | API key in query string (logged by servers/proxies) | HIGH |
| K06 | API key in Authorization header with wrong scheme | LOW |
| K07 | No input content-type enforcement (Accept only application/json) | LOW |
| K08 | HTTP verb confusion: route handles GET but should be POST (idempotency) | LOW |
| K09 | Mass assignment: `Object.assign(record, req.body)` without field filtering | HIGH |
| K10 | GraphQL: introspection enabled in production | LOW |
| K11 | GraphQL: unbounded query depth/complexity | HIGH |
| K12 | Webhook signature not verified on inbound webhooks | HIGH |
| K13 | Missing `X-Request-ID` or request tracing (makes incident response harder) | INFO |

---

## L — Database Security

| ID | What to look for | Severity |
|----|-----------------|----------|
| L01 | Database connection string with password in logs | HIGH |
| L02 | DB user has superuser/full privileges | MEDIUM |
| L03 | No connection pool max size (can exhaust DB connections) | MEDIUM |
| L04 | No query timeout (hung query can exhaust pool) | MEDIUM |
| L05 | Raw SQL with JSONB operations that might allow injection | MEDIUM |
| L06 | Storing sensitive data (passwords, API keys) in plaintext columns | HIGH |
| L07 | No at-rest encryption for sensitive tables | MEDIUM |
| L08 | `DELETE` without `WHERE` clause (accidental full-table delete) | HIGH |
| L09 | Migration SQL runs user-controlled input | CRITICAL |
| L10 | DB error message exposed in HTTP response | MEDIUM |
| L11 | Row-level security not used in multi-tenant schema | MEDIUM |

---

## M — Node.js / TypeScript Specific

| ID | What to look for | Severity |
|----|-----------------|----------|
| M01 | `vm.runInContext` with user code (Node.js VM is not a true sandbox) | HIGH |
| M02 | Sandbox escape patterns not blocked: `this.constructor`, `Object.getPrototypeOf`, `globalThis`, `process.binding` | CRITICAL |
| M03 | `process.env` writable inside sandbox | HIGH |
| M04 | Dynamic `require()` with user-controlled module name | CRITICAL |
| M05 | `__proto__` or `constructor.prototype` manipulation via JSON.parse | HIGH |
| M06 | Using `==` instead of `===` for security comparisons | MEDIUM |
| M07 | `typeof null === 'object'` not handled | LOW |
| M08 | Prototype pollution via `Object.assign({}, req.body)` | HIGH |
| M09 | Unhandled promise rejections (can crash process or swallow errors) | MEDIUM |
| M10 | `setInterval` / `setTimeout` without `.unref()` blocking process exit | INFO |
| M11 | Express trust proxy not configured (affects IP rate limiting) | MEDIUM |
| M12 | `req.ip` returns proxy IP instead of real IP when trust proxy not set | MEDIUM |
| M13 | `express.json()` without body size limit | MEDIUM |
| M14 | CORS before auth middleware (auth state not checked in CORS handler) | LOW |
| M15 | Using `parseInt(x)` without base when x could start with `0x` | INFO |

---

## N — Configuration & Secrets Management

| ID | What to look for | Severity |
|----|-----------------|----------|
| N01 | `.env` file committed to version control | CRITICAL |
| N02 | Secrets in `package.json`, `Makefile`, `Dockerfile` | HIGH |
| N03 | Secrets in CI/CD config files (GitHub Actions, CircleCI) | HIGH |
| N04 | `NODE_ENV` not set (defaults to development in production) | MEDIUM |
| N05 | Debug mode enabled in production | HIGH |
| N06 | Stack traces in production | MEDIUM |
| N07 | Verbose error messages in production | MEDIUM |
| N08 | `rejectUnauthorized: false` in TLS config | HIGH |
| N09 | Weak password policy (< 8 chars, no complexity) | MEDIUM |
| N10 | SMTP relay open (no authentication, binds to 0.0.0.0) | HIGH |
| N11 | Default ports for internal services exposed externally | MEDIUM |
| N12 | Missing ENCRYPTION_KEY entropy check | MEDIUM |
| N13 | JWT_SECRET entropy check missing | MEDIUM |
| N14 | Environment variables not validated at startup | MEDIUM |
| N15 | `process.env.FOO!` non-null assertion without runtime check | LOW |

---

## O — Logging & Monitoring

| ID | What to look for | Severity |
|----|-----------------|----------|
| O01 | No audit log for authentication events (login, logout, failed login) | MEDIUM |
| O02 | No audit log for data deletion events | MEDIUM |
| O03 | No audit log for privilege escalation | HIGH |
| O04 | Log level too verbose in production (debug logs in prod) | LOW |
| O05 | Sensitive data (passwords, tokens) in log messages | HIGH |
| O06 | Log injection: user input in log without sanitization | LOW |
| O07 | Error objects logged directly (serialize as `{}` in JSON) | INFO |
| O08 | No structured logging (plain strings, hard to parse) | INFO |
| O09 | Missing request ID for distributed tracing | INFO |
| O10 | Logs not rotated / unbounded log growth | LOW |

---

## P — Third-party & Supply Chain

| ID | What to look for | Severity |
|----|-----------------|----------|
| P01 | `npm install` without lockfile (package-lock.json or yarn.lock) | HIGH |
| P02 | Dependencies with known CVEs (run `npm audit`) | HIGH |
| P03 | Wildcard version ranges (`*`, `>=`) in production deps | MEDIUM |
| P04 | `postinstall` scripts from untrusted packages | HIGH |
| P05 | Direct eval of npm package output | HIGH |
| P06 | `require('child_process')` in node_modules | HIGH |
| P07 | Unpinned base Docker image (`:latest` tag) | MEDIUM |
| P08 | Package from unknown registry / typosquatting risk | HIGH |
| P09 | Bundling dev dependencies in production image | LOW |
| P10 | No Subresource Integrity (SRI) on CDN-loaded scripts | MEDIUM |

---

## Q — Business Logic

| ID | What to look for | Severity |
|----|-----------------|----------|
| Q01 | Price, quantity, or limit manipulable via client request | HIGH |
| Q02 | Negative amounts not rejected (negative price, negative transfer) | HIGH |
| Q03 | Race condition in check-then-act operations (TOCTOU) | HIGH |
| Q04 | Account enumeration via registration (different response for existing vs new) | MEDIUM |
| Q05 | Mass action without confirmation/preview for destructive ops | MEDIUM |
| Q06 | Unsubscribe action not rate-limited (spam external services) | MEDIUM |
| Q07 | Forward-all action with no per-email limit | MEDIUM |
| Q08 | Scheduled actions can be manipulated to send at past dates | LOW |
| Q09 | Multi-step flow can skip steps by crafting direct request | HIGH |
| Q10 | Feature flag bypassable via client parameter | MEDIUM |

---

## R — Plugin & Code Execution Safety

| ID | What to look for | Severity |
|----|-----------------|----------|
| R01 | User-generated code executed without sandbox | CRITICAL |
| R02 | Sandbox allows access to `require`, `import`, `process` | CRITICAL |
| R03 | Plugin name used in file path without sanitization (`../`) | HIGH |
| R04 | Generated plugin code returned to client before sanitization | MEDIUM |
| R05 | Plugin fetch: no SSRF guard (can fetch internal services) | HIGH |
| R06 | Plugin fetch: no protocol restriction (file://, javascript://) | HIGH |
| R07 | Forbidden code patterns not checked before execution | HIGH |
| R08 | Plugin timeout too long (> 30s allows extended DoS) | MEDIUM |
| R09 | WebAssembly execution allowed in plugin sandbox | HIGH |
| R10 | Dynamic import() allowed in plugin sandbox | HIGH |

---

## S — Telegram Bot Security

| ID | What to look for | Severity |
|----|-----------------|----------|
| S01 | TELEGRAM_ALLOWED_USERS not set — bot responds to anyone | HIGH |
| S02 | Telegram initData HMAC not verified | CRITICAL |
| S03 | Callback query data not validated against expected schema | MEDIUM |
| S04 | User ID from callback not cross-checked with original sender | HIGH |
| S05 | Bot command injection via username or callback data | MEDIUM |
| S06 | Markdown injection in bot messages with parse_mode: Markdown | MEDIUM |
| S07 | Sensitive data (API keys, credentials) sent to Telegram | HIGH |
| S08 | Bot token exposed in logs or error messages | CRITICAL |
| S09 | Webhook secret not validated on Telegram webhook endpoint | HIGH |
| S10 | User can trigger expensive LLM ops via bot without rate limit | HIGH |

---

## T — Infrastructure & Deployment

| ID | What to look for | Severity |
|----|-----------------|----------|
| T01 | HTTP instead of HTTPS in production | HIGH |
| T02 | HTTP Strict Transport Security (HSTS) header missing | MEDIUM |
| T03 | `Secure` flag missing on cookies | HIGH |
| T04 | `HttpOnly` flag missing on session cookies | HIGH |
| T05 | `SameSite` attribute missing on cookies (CSRF risk) | HIGH |
| T06 | Running as root in Docker container | HIGH |
| T07 | Sensitive ports exposed in docker-compose (DB, Redis, SMTP) | HIGH |
| T08 | `/admin` or management interfaces exposed publicly | HIGH |
| T09 | Debug/profiling endpoints accessible in production | MEDIUM |
| T10 | Backup files in web root (`.bak`, `.old`, `~`) | HIGH |
