import { Router } from 'express';
import { logger } from '../../../utils/logger.ts';

const router = Router();

/** POST /playground/run — test a prompt against a sample email */
router.post('/playground/run', async (req, res) => {
  const { accountId, prompt, sampleEmail } = req.body as {
    accountId?: string;
    prompt?:    string;
    sampleEmail?: string;
  };

  if (!prompt?.trim() || !sampleEmail?.trim()) {
    res.status(400).json({ error: 'prompt and sampleEmail are required' });
    return;
  }

  if (prompt.length > 4096 || sampleEmail.length > 8192) {
    res.status(400).json({ error: 'prompt or sampleEmail exceeds maximum length' });
    return;
  }

  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) {
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  try {
    const userId = (req as any).user?.sub;
    if (accountId) {
      const { getPool } = await import('../../../storage/pg-pool.ts');
      const { rowCount } = await getPool().query(
        'SELECT 1 FROM email_accounts WHERE id = $1 AND user_id = $2',
        [accountId, userId]
      );
      if (!rowCount) { res.status(403).json({ error: 'Forbidden' }); return; }
    }

    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { Encryption }        = await import('../../../security/encryption.ts');

    const enc      = new Encryption(encKey);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);

    const persona   = accountId ? await personas.get(accountId) : null;
    const llmConfig = persona?.llmConfig ?? {
      provider: (process.env.LLM_PROVIDER as any) ?? 'openrouter',
      model:    process.env.LLM_MODEL ?? 'google/gemini-flash-1.5',
      apiKey:   process.env.LLM_API_KEY,
      baseUrl:  process.env.LLM_BASE_URL ?? undefined,
    };

    const expandedPrompt = prompt
      .replace(/\{\{tone\}\}/g,        persona?.tone ?? 'professional')
      .replace(/\{\{max_words\}\}/g,   '200')
      .replace(/\{\{email_body\}\}/g,  sampleEmail)
      .replace(/\{\{sender_name\}\}/g, extractSenderName(sampleEmail));

    const { LLMRouter } = await import('../../../llm/router.ts');
    const llm    = new LLMRouter(llmConfig);
    const result = await llm.complete(expandedPrompt, { temperature: 0.7, maxTokens: 500 });

    res.json({ result, tokens: 0 });
  } catch (err: any) {
    logger.error('Playground run error', { err });
    res.status(500).json({ error: 'LLM request failed' });
  }
});

function extractSenderName(email: string): string {
  const match = email.match(/^From:\s*(.+?)(?:\s*<|$)/im);
  return match?.[1]?.trim() ?? 'Unknown Sender';
}

export default router;
