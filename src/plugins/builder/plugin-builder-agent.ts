import { z } from 'zod';
import { LLMRouter } from '../../llm/router.ts';
import { StaticAnalyzer } from './static-analyzer.ts';
import { SandboxRunner } from './sandbox-runner.ts';
import { PluginSpecSchema, type PluginSpec } from './plugin-spec.ts';
import { logger } from '../../utils/logger.ts';
import type { ParsedEmail, AgentResponse } from '../../types/index.ts';

export interface BuildRequest {
  userDescription: string;
  accountId:       string;
  authorEmail?:    string;
}

export interface BuildResult {
  spec:          PluginSpec;
  pluginMd:      string;
  code:          string;
  analysisReport: string;
  sandboxResult:  { success: boolean; output: string; error?: string; durationMs: number };
  ready:         boolean;
}

const SPEC_EXTRACTION_SCHEMA = z.object({
  name:        z.string(),
  description: z.string(),
  hooks:       z.array(z.string()),
  permissions: z.object({
    network:   z.array(z.string()).default([]),
    env:       z.array(z.string()).default([]),
    storage:   z.boolean().default(false),
    emailSend: z.boolean().default(false),
  }),
  reasoning: z.string(),
});

export class PluginBuilderAgent {
  private analyzer = new StaticAnalyzer();
  private sandbox  = new SandboxRunner();

  constructor(private llm: LLMRouter) {}

  /**
   * Full pipeline: description → spec → code → analysis → sandbox test → result
   */
  async build(req: BuildRequest): Promise<BuildResult> {
    logger.info('PluginBuilderAgent: starting build', { accountId: req.accountId });

    // Step 1: Extract structured spec from natural language
    const spec = await this.extractSpec(req);
    logger.info('PluginBuilderAgent: spec extracted', { name: spec.name });

    // Step 2: Generate plugin PLUGIN.md
    const pluginMd = this.renderPluginMd(spec, req.userDescription);

    // Step 3: Generate TypeScript code
    const code = await this.generateCode(spec, req.userDescription);
    logger.info('PluginBuilderAgent: code generated', { bytes: code.length });

    // Step 4: Static analysis
    const analysis = this.analyzer.analyze(code, spec);
    const analysisReport = this.analyzer.formatReport(analysis);

    if (!analysis.safe) {
      logger.warn('PluginBuilderAgent: static analysis failed', { issues: analysis.issues });
    }

    // Step 5: Sandbox test with a sample email
    const sampleEmail    = this.makeSampleEmail();
    const sampleResponse = this.makeSampleResponse();
    const sandboxResult  = analysis.safe
      ? await this.sandbox.run(code, spec, sampleEmail, sampleResponse)
      : { success: false, output: '', error: 'Skipped due to static analysis failure', durationMs: 0 };

    return {
      spec,
      pluginMd,
      code,
      analysisReport,
      sandboxResult,
      ready: analysis.safe && sandboxResult.success,
    };
  }

  private async extractSpec(req: BuildRequest): Promise<PluginSpec> {
    const prompt = `
You are an Email Agent Plugin Architect.

A user wants to build a plugin for their email agent. Extract a structured plugin specification from their description.

User description:
"""
${req.userDescription}
"""

Available hooks:
- beforeEmailProcess — runs before LLM analysis, can modify the email
- afterEmailProcess  — runs after LLM analysis, can modify the response
- beforeSendReply    — runs before reply is sent, can modify draft text
- afterSendReply     — runs after reply is sent (side effects only)
- onFeedback         — runs when user gives feedback on a response

Rules for permissions:
- network: list only the EXACT domains the plugin needs (no wildcards)
- env: list the environment variable names the plugin needs
- storage: true only if plugin must persist data between calls
- emailSend: true only if plugin needs to send emails itself

Respond with JSON only:
${JSON.stringify(SPEC_EXTRACTION_SCHEMA.shape, null, 2)}
`;

    const raw = await this.llm.completeWithRetry(
      prompt,
      (parsed) => SPEC_EXTRACTION_SCHEMA.parse(parsed),
    );

    return PluginSpecSchema.parse({
      name:        raw.name,
      description: raw.description,
      hooks:       raw.hooks,
      permissions: raw.permissions,
      version:     '1.0.0',
      author:      req.authorEmail,
      enabled:     false,  // disabled until user explicitly enables
    });
  }

  private async generateCode(spec: PluginSpec, userDescription: string): Promise<string> {
    const envAccessCode = spec.permissions.env.length > 0
      ? spec.permissions.env.map((k) => `  // process.env.${k}`).join('\n')
      : '  // no env vars needed';

    const prompt = `
You are a TypeScript expert writing a plugin for an email agent system.

Plugin spec:
${JSON.stringify(spec, null, 2)}

User requirement:
"""
${userDescription}
"""

Generate a complete, working TypeScript plugin class.

STRICT RULES:
1. The class must implement IPlugin interface
2. Only implement the hooks listed: ${spec.hooks.join(', ')}
3. Network: ONLY fetch to these domains: ${spec.permissions.network.join(', ') || 'none'}
4. Env vars allowed: ${spec.permissions.env.join(', ') || 'none'}
5. NO require(), NO eval(), NO fs writes, NO child_process
6. Handle all errors with try/catch — plugin failures must never crash the agent
7. Use ESM syntax (import/export)
8. The class must be the DEFAULT export

Available types (already imported in runtime):
\`\`\`typescript
interface ParsedEmail {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  receivedAt: Date;
  accountId: string;
}
interface AgentResponse {
  priority: 'critical' | 'high' | 'medium' | 'low';
  intent: string;
  summary: string;
  suggestedReplies: string[];
  confidence: number;
  extractedData?: Record<string, unknown>;
}
\`\`\`

Allowed env vars in this plugin:
${envAccessCode}

Output ONLY the TypeScript code, no markdown fences.
`;

    return this.llm.complete(prompt);
  }

  private renderPluginMd(spec: PluginSpec, userDescription: string): string {
    const frontmatter = [
      '---',
      `name: ${spec.name}`,
      `version: ${spec.version}`,
      `description: ${spec.description}`,
      'permissions:',
      `  network: [${spec.permissions.network.map((d) => `"${d}"`).join(', ')}]`,
      `  env: [${spec.permissions.env.map((e) => `"${e}"`).join(', ')}]`,
      `  storage: ${spec.permissions.storage}`,
      `  emailSend: ${spec.permissions.emailSend}`,
      `hooks:`,
      ...spec.hooks.map((h) => `  - ${h}`),
      `enabled: false`,
      '---',
    ].join('\n');

    return `${frontmatter}\n\n## User Description\n\n${userDescription}\n\n## Auto-generated by Email Agent AI Plugin Builder`;
  }

  private makeSampleEmail(): ParsedEmail {
    return {
      messageId:  '<sample@test.local>',
      from:       'test@example.com',
      to:         ['me@mycompany.com'],
      subject:    '[TEST] Sample email for plugin testing',
      body:       'This is a test email body used to validate the plugin.',
      receivedAt: new Date(),
      accountId:  'test-account',
    } as any;
  }

  private makeSampleResponse(): AgentResponse {
    return {
      priority:         'high',
      intent:           'information_request',
      summary:          'Test email for plugin validation',
      suggestedReplies: ['Thank you for your message.'],
      confidence:       0.9,
      extractedData:    {},
    } as any;
  }
}
