---
name: security-audit
description: Run a comprehensive cybersecurity audit of the codebase. Checks 200+ security issues across authentication, authorization, injection, cryptography, SSRF, XSS, secrets exposure, rate limiting, input validation, and more. Reports every finding with severity, file, line number, and exact fix.
disable-model-invocation: false
argument-hint: [path or "full"]
allowed-tools: Bash Read
---

# Cybersecurity Audit

You are acting as a senior penetration tester and secure code reviewer. Your job is to perform a **thorough, systematic security audit** of this codebase and produce a structured report.

## Target

```!
echo "=== Project structure ==="
find . -type f -name "*.ts" -o -name "*.js" -o -name "*.json" | grep -v node_modules | grep -v dist | grep -v ".git" | head -120
echo ""
echo "=== Package info ==="
cat package.json 2>/dev/null | head -40
echo ""
echo "=== Environment variables referenced ==="
grep -rh "process\.env\." src/ 2>/dev/null | grep -oP '(?<=process\.env\.)[A-Z_0-9]+' | sort -u
echo ""
echo "=== All route files ==="
find src -name "*.ts" | xargs grep -l "Router\|router\|app\." 2>/dev/null
echo ""
echo "=== Auth middleware usage ==="
grep -rn "requireAuth\|optionalAuth\|middleware" src/ 2>/dev/null | grep -v "node_modules" | head -40
```

## Phase 1 — Quick Surface Scan

Run the grep patterns from [quick-patterns.md](quick-patterns.md) first to surface risky code quickly:

```!
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
echo "=== SQL/Template injection candidates ==="
grep -rn --include="*.ts" --include="*.js" 'query.*`\|query.*+.*req\|\${.*req\.' src/ 2>/dev/null | grep -v "//\|node_modules" | head -20
echo ""
echo "=== eval / exec / dynamic code ==="
grep -rn --include="*.ts" "eval(\|new Function(\|execSync(\|exec(" src/ 2>/dev/null | grep -v "//\|node_modules" | head -20
echo ""
echo "=== fetch with variable URL ==="
grep -rn --include="*.ts" "fetch(" src/ 2>/dev/null | grep -v "fetch('" | grep -v "fetch(\`https\|//\|node_modules" | head -20
echo ""
echo "=== err.message → client ==="
grep -rn --include="*.ts" "err\.message\|error\.message" src/interfaces/ 2>/dev/null | grep "json\|send\|res\." | head -20
echo ""
echo "=== parseInt without clamp ==="
grep -rn --include="*.ts" "parseInt" src/ 2>/dev/null | grep -v "Math\.\|, 10)" | head -20
echo ""
echo "=== Routes overview ==="
grep -rn --include="*.ts" "router\.\(get\|post\|put\|patch\|delete\)" src/interfaces/web/routes/ 2>/dev/null | head -60
echo ""
echo "=== requireAuth placement ==="
grep -n "requireAuth\|router\.use\|use(auth" src/interfaces/web/routes/index.ts 2>/dev/null
```

## Phase 2 — Deep File-by-File Audit

Read ALL source files systematically. For each file, apply **every relevant check** from the checklist. Do not skip files. Do not skip checks.

When you find an issue:
- Record: **severity**, **file:line**, **check ID**, **description**, **exact fix**
- Keep going — do not stop at the first finding

---

## CHECKLIST — 200+ Security Checks

See [checks.md](checks.md) for the full categorized list (Authentication, Authorization, Injection, XSS, Cryptography, SSRF, Rate Limiting, File Security, Input Validation, API Security, Database, Node.js-specific, Logging, Supply Chain, Business Logic, Plugin Sandbox, Telegram, Infrastructure).

---

## Output Format

After reading all files and completing the audit, output a report in this exact format:

```
## Security Audit Report
Generated: <date>
Files scanned: <count>
Total findings: <count>

---

### CRITICAL (n findings)

| ID | File:Line | Issue | Fix |
|----|-----------|-------|-----|
| A01 | src/auth.ts:42 | ... | ... |

### HIGH (n findings)
...

### MEDIUM (n findings)
...

### LOW (n findings)
...

### INFO (n findings)
...

---

## Summary

- **Most critical**: <top 3 issues>
- **Already fixed patterns**: <any defenses you noticed>
- **Recommended priority order**: <ordered list of top fixes>
```

---

## Execution Plan

1. Run the shell commands above to map the codebase
2. Read every route file, service, middleware, storage adapter, and config file
3. Apply all 200+ checks from checks.md to each file
4. Compile findings into the structured report above
5. Do NOT stop until every file has been checked against every relevant category

**Start the audit now.**
