import { getPool } from '../storage/pg-pool.ts';
import { CredentialManager } from '../security/credential-manager.ts';
import type { Persona, LLMConfig } from '../types/index.ts';

export class PersonaManager {
  constructor(private credManager: CredentialManager) {}

  async get(accountId: string): Promise<Persona> {
    const { rows } = await getPool().query(
      'SELECT * FROM personas WHERE account_id = $1', [accountId]
    );
    const row = rows[0];
    if (!row) return this.defaultPersona(accountId);

    let apiKey: string | undefined;
    try {
      apiKey = row.llm_api_key_enc ? await this.credManager.getAPIKey(accountId) : undefined;
    } catch { /* no key stored */ }

    const llmConfig: LLMConfig = {
      provider: row.llm_provider ?? (process.env.LLM_PROVIDER as any) ?? 'openrouter',
      model:    row.llm_model    ?? process.env.LLM_MODEL ?? 'google/gemini-flash-1.5',
      apiKey:   apiKey           ?? process.env.LLM_API_KEY,
      baseUrl:  row.llm_base_url ?? process.env.LLM_BASE_URL ?? undefined,
    };

    return {
      accountId,
      tone:           row.tone            ?? 'professional',
      useEmoji:       Boolean(row.use_emoji),
      language:       row.language        ?? 'auto',
      autonomyLevel:  row.autonomy_level  ?? 'draft',
      styleDna:       row.style_dna       ?? undefined,
      systemPrompt:   row.system_prompt   ?? undefined,
      llmConfig,
      onboardingDone: Boolean(row.onboarding_done),
      shadowMode:     Boolean(row.shadow_mode),
    };
  }

  async update(accountId: string, patch: Partial<Pick<Persona, 'tone' | 'useEmoji' | 'language' | 'autonomyLevel' | 'styleDna' | 'systemPrompt' | 'onboardingDone' | 'shadowMode'>>): Promise<void> {
    const fields = Object.entries({
      tone:            patch.tone,
      use_emoji:       patch.useEmoji,
      language:        patch.language,
      autonomy_level:  patch.autonomyLevel,
      style_dna:       patch.styleDna,
      system_prompt:   patch.systemPrompt,
      onboarding_done: patch.onboardingDone,
      shadow_mode:     patch.shadowMode,
    }).filter(([, v]) => v !== undefined);

    if (!fields.length) return;

    // Ensure persona row exists
    await getPool().query(
      `INSERT INTO personas (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`,
      [accountId]
    );

    const setClauses = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    await getPool().query(
      `UPDATE personas SET ${setClauses}, updated_at = NOW() WHERE account_id = $${fields.length + 1}`,
      [...fields.map(([, v]) => v), accountId]
    );
  }

  async setLLMConfig(accountId: string, config: LLMConfig): Promise<void> {
    await getPool().query(
      `UPDATE personas SET llm_provider = $1, llm_model = $2, llm_base_url = $3, updated_at = NOW()
       WHERE account_id = $4`,
      [config.provider, config.model, config.baseUrl ?? null, accountId]
    );
    if (config.apiKey) {
      await this.credManager.storeAPIKey(accountId, config.apiKey);
    }
  }

  async setStyleSamples(accountId: string, samples: string[]): Promise<void> {
    await getPool().query(
      'UPDATE personas SET style_dna = $1, updated_at = NOW() WHERE account_id = $2',
      [JSON.stringify(samples), accountId]
    );
  }

  private defaultPersona(accountId: string): Persona {
    return {
      accountId,
      tone:          'professional',
      useEmoji:      false,
      language:      'auto',
      autonomyLevel: 'draft',
      llmConfig: {
        provider: (process.env.LLM_PROVIDER as any) ?? 'openrouter',
        model:    process.env.LLM_MODEL ?? 'google/gemini-flash-1.5',
        apiKey:   process.env.LLM_API_KEY,
        baseUrl:  process.env.LLM_BASE_URL ?? undefined,
      },
      onboardingDone: false,
      shadowMode:     true,
    };
  }
}
