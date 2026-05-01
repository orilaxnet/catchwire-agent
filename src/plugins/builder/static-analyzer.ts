import type { PluginSpec } from './plugin-spec.ts';

export interface AnalysisResult {
  safe:     boolean;
  issues:   AnalysisIssue[];
  warnings: string[];
}

export interface AnalysisIssue {
  severity: 'error' | 'warning';
  rule:     string;
  message:  string;
  line?:    number;
}

/** Patterns that are always forbidden in generated plugin code */
const FORBIDDEN: Array<{ rule: string; pattern: RegExp; message: string }> = [
  {
    rule:    'no-child-process',
    pattern: /require\s*\(\s*['"`]child_process/,
    message: 'Shell execution is not allowed in plugins',
  },
  {
    rule:    'no-eval',
    pattern: /\beval\s*\(/,
    message: 'eval() is not allowed',
  },
  {
    rule:    'no-dynamic-function',
    pattern: /new\s+Function\s*\(/,
    message: 'new Function() is not allowed',
  },
  {
    rule:    'no-fs-write',
    pattern: /\bfs\s*\.\s*(write|append|unlink|rm|mkdir|chmod|chown)/,
    message: 'File system writes are not allowed',
  },
  {
    rule:    'no-require',
    pattern: /\brequire\s*\(\s*['"`](?!node:)/,
    message: 'require() is not allowed — use ESM imports declared in dependencies',
  },
  {
    rule:    'no-process-exit',
    pattern: /process\s*\.\s*exit/,
    message: 'process.exit() is not allowed',
  },
  {
    rule:    'no-prototype-pollution',
    pattern: /__proto__|constructor\s*\[|Object\.setPrototypeOf/,
    message: 'Prototype pollution patterns are not allowed',
  },
  // VM sandbox escape vectors
  {
    rule:    'no-sandbox-escape',
    pattern: /\bthis\s*\.\s*constructor\b|\bObject\s*\.\s*getPrototypeOf\b|\bglobalThis\b|\bprocess\s*\.\s*mainModule\b|\bprocess\s*\.\s*binding\b/,
    message: 'VM sandbox escape patterns are not allowed',
  },
  {
    rule:    'no-wasm',
    pattern: /\bWebAssembly\b/,
    message: 'WebAssembly is not allowed in plugins',
  },
  {
    rule:    'no-dynamic-import',
    pattern: /\bimport\s*\(/,
    message: 'Dynamic import() is not allowed in plugins',
  },
];

export class StaticAnalyzer {
  analyze(code: string, spec: PluginSpec): AnalysisResult {
    const issues:   AnalysisIssue[] = [];
    const warnings: string[]         = [];
    const lines = code.split('\n');

    // ── Forbidden patterns ────────────────────────────────────────────────
    for (const { rule, pattern, message } of FORBIDDEN) {
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          issues.push({ severity: 'error', rule, message, line: i + 1 });
        }
      });
    }

    // ── Network access must be in permissions ─────────────────────────────
    const fetchCalls = [...code.matchAll(/fetch\s*\(\s*['"`](https?:\/\/[^'"` ]+)/g)];
    for (const match of fetchCalls) {
      const url    = match[1];
      const domain = new URL(url).hostname;
      if (!spec.permissions.network.some((d) => domain.endsWith(d))) {
        issues.push({
          severity: 'error',
          rule:     'unauthorized-network',
          message:  `Network access to "${domain}" not declared in permissions.network`,
        });
      }
    }

    // ── env access must be declared ───────────────────────────────────────
    const envAccess = [...code.matchAll(/process\.env\[?['"`]([A-Z0-9_]+)/g)];
    for (const match of envAccess) {
      const varName = match[1];
      if (!spec.permissions.env.includes(varName)) {
        issues.push({
          severity: 'error',
          rule:     'unauthorized-env',
          message:  `Access to env var "${varName}" not declared in permissions.env`,
        });
      }
    }

    // ── Hooks must be implemented ─────────────────────────────────────────
    for (const hook of spec.hooks) {
      if (!code.includes(hook)) {
        warnings.push(`Hook "${hook}" declared in spec but not found in code`);
      }
    }

    // ── Size check ────────────────────────────────────────────────────────
    if (code.length > 50_000) {
      warnings.push('Plugin code is very large (>50KB). Consider splitting into multiple plugins.');
    }

    return {
      safe:     issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      warnings,
    };
  }

  formatReport(result: AnalysisResult): string {
    const lines: string[] = [];
    if (result.safe) {
      lines.push('✅ Static analysis passed');
    } else {
      lines.push('❌ Static analysis failed');
    }
    for (const issue of result.issues) {
      const loc = issue.line ? `:${issue.line}` : '';
      lines.push(`  ${issue.severity === 'error' ? '🔴' : '🟡'} [${issue.rule}${loc}] ${issue.message}`);
    }
    for (const w of result.warnings) {
      lines.push(`  ⚠️  ${w}`);
    }
    return lines.join('\n');
  }
}
