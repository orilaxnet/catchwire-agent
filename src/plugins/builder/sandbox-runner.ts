import { createContext, runInContext } from 'vm';
import { logger } from '../../utils/logger.ts';
import type { PluginSpec } from './plugin-spec.ts';
import type { ParsedEmail, AgentResponse } from '../../types/index.ts';

export interface SandboxResult {
  success:    boolean;
  output:     string;
  error?:     string;
  durationMs: number;
}

/**
 * Runs generated plugin code in a restricted Node.js vm context.
 * - No access to require/import, fs, child_process, or process.env beyond allowed vars
 * - Fetch is replaced with a filtered proxy that enforces permission.network
 * - Timeout: 10 seconds
 *
 * SECURITY NOTE: Node.js `vm` is NOT a true security sandbox. It is documented
 * by Node.js as unsuitable for running untrusted code — a determined attacker
 * can escape the context. Plugin code should only ever be trusted/reviewed code.
 * For production multi-tenant use, replace with a proper sandbox such as an
 * isolated subprocess, Deno worker, or a WASM runtime.
 */
export class SandboxRunner {
  async run(
    code:         string,
    spec:         PluginSpec,
    sampleEmail:  ParsedEmail,
    sampleAnalysis: AgentResponse,
  ): Promise<SandboxResult> {
    const start  = Date.now();
    const logs:  string[] = [];

    const safeConsole = {
      log:   (...a: any[]) => logs.push(a.join(' ')),
      warn:  (...a: any[]) => logs.push('[warn] ' + a.join(' ')),
      error: (...a: any[]) => logs.push('[error] ' + a.join(' ')),
      info:  (...a: any[]) => logs.push('[info] ' + a.join(' ')),
    };

    const allowedEnv: Record<string, string> = {};
    for (const key of spec.permissions.env) {
      if (process.env[key]) allowedEnv[key] = process.env[key]!;
    }

    const filteredFetch = this.buildFilteredFetch(spec.permissions.network, logs);

    const sandbox = createContext({
      console:      safeConsole,
      fetch:        filteredFetch,
      setTimeout:   (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 5_000)),
      clearTimeout,
      JSON,
      Math,
      Date,
      Promise,
      process:      { env: new Proxy(allowedEnv, {
        get: (t, k: string) => t[k] ?? undefined,
        set: () => { throw new Error('process.env is read-only in plugin sandbox'); },
      }) },
      // email data injected directly
      __email:    sampleEmail,
      __analysis: sampleAnalysis,
    });

    // Wrap user code so the hook can be called
    const wrapped = `
      'use strict';
      ${code}

      // Auto-invoke the first declared hook for testing
      (async () => {
        const instance = new (Object.values(exports ?? {}).find(v => typeof v === 'function') ?? class{})();
        if (instance.afterEmailProcess) {
          await instance.afterEmailProcess(__email, __analysis);
        } else if (instance.beforeEmailProcess) {
          await instance.beforeEmailProcess(__email);
        }
      })().then(() => '__done__').catch(e => { throw e; });
    `;

    try {
      await Promise.race([
        runInContext(wrapped, sandbox, {
          timeout:        10_000,
          displayErrors:  true,
          filename:       `plugin:${spec.name}`,
        }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Sandbox timeout (10s)')), 10_000)
        ),
      ]);

      return {
        success:    true,
        output:     logs.join('\n') || '(no console output)',
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      logger.warn('Sandbox execution error', { plugin: spec.name, err: err.message });
      return {
        success:    false,
        output:     logs.join('\n'),
        error:      err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  private buildFilteredFetch(allowedDomains: string[], logs: string[]) {
    return async (url: string, options?: RequestInit): Promise<Response> => {
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }

      const allowed = allowedDomains.some((d) => hostname === d || hostname.endsWith('.' + d));
      if (!allowed) {
        throw new Error(
          `Network access to "${hostname}" blocked — not in plugin permissions. Allowed: ${allowedDomains.join(', ')}`
        );
      }

      logs.push(`[fetch] → ${url}`);
      const res = await fetch(url, options);
      logs.push(`[fetch] ← ${res.status} ${url}`);
      return res;
    };
  }
}
