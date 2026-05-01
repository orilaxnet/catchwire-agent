# Quick Grep Patterns for Security Audit

Run these shell commands to quickly surface risky patterns before deep-reading files.

## Injection risks
```bash
# SQL concatenation
grep -rn "query.*\`\|query.*+.*req\|query.*\${" src/ 2>/dev/null

# eval / dynamic code
grep -rn "eval(\|new Function(\|vm\.run" src/ 2>/dev/null

# child_process
grep -rn "exec(\|execSync(\|spawn(" src/ 2>/dev/null

# dynamic import/require
grep -rn "require(\|dynamic.*import\|import(" src/ 2>/dev/null | grep -v "//\|\.test\."
```

## Auth & secrets
```bash
# hardcoded secrets
grep -rn "password\s*=\s*['\"][^'\"]\|apiKey\s*=\s*['\"][^'\"]" src/ 2>/dev/null

# JWT issues
grep -rn "\.verify\|\.sign\|jwt\." src/ 2>/dev/null

# timing-safe comparisons
grep -rn "==.*token\|token.*==\|===.*hash\|hash.*===" src/ 2>/dev/null | grep -v timingSafe
```

## Missing auth
```bash
# routes without auth
grep -rn "router\.\(get\|post\|put\|patch\|delete\)" src/interfaces/web/routes/ 2>/dev/null
grep -rn "requireAuth" src/interfaces/web/routes/index.ts 2>/dev/null
```

## SSRF
```bash
# fetch with variable URL
grep -rn "fetch(\|axios\." src/ 2>/dev/null | grep -v "fetch('" | grep -v "//.*fetch"

# unsubscribe / webhook fetch
grep -rn "unsubscribe\|webhook.*url\|hook\.url" src/ 2>/dev/null
```

## Error exposure
```bash
# err.message to client
grep -rn "err\.message\|error\.message" src/interfaces/ 2>/dev/null | grep "json\|send\|res\."

# stack traces
grep -rn "err\.stack\|error\.stack" src/interfaces/ 2>/dev/null | grep "json\|send\|res\."
```

## Rate limiting
```bash
# routes missing rate limit
grep -rn "router\.\(post\|put\|patch\|delete\)" src/interfaces/web/routes/ 2>/dev/null
grep -rn "rateLimitMiddleware" src/interfaces/web/routes/ 2>/dev/null
```

## Path traversal
```bash
# join with user input
grep -rn "join(.*req\.\|join(.*params\.\|join(.*body\." src/ 2>/dev/null

# fs operations
grep -rn "readFile\|writeFile\|readdir\|unlink" src/ 2>/dev/null | grep -v test
```

## Sensitive logging
```bash
# potential secret in logs
grep -rn "logger\.\|console\." src/ 2>/dev/null | grep -i "password\|secret\|key\|token\|pass"
```

## parseInt without clamp
```bash
grep -rn "parseInt" src/ 2>/dev/null | grep -v "Math\.max\|Math\.min\|radix\|, 10"
```

## Process.env without validation
```bash
grep -rn "process\.env\." src/ 2>/dev/null | grep -v "env-validator\|\.ts:" | head -40
```
