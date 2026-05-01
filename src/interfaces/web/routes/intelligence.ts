/**
 * Intelligence routes — search, memory, labels, meeting coordination
 */

import { Router } from 'express';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger }  from '../../../utils/logger.ts';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware.ts';

const router = Router();

async function assertOwnsAccount(accountId: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'SELECT 1 FROM email_accounts WHERE id = $1 AND user_id = $2',
    [accountId, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ── Natural Language Search ────────────────────────────────────────────────

router.post('/search', rateLimitMiddleware('llm_requests'), async (req, res) => {
  const { accountId, query, limit = 20 } = req.body as { accountId?: string; query?: string; limit?: number };
  if (!query?.trim()) { res.status(400).json({ error: 'query is required' }); return; }

  try {
    const userId = (req as any).user?.sub;
    if (accountId && !await assertOwnsAccount(accountId, userId)) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    // Get LLM config for this account (or default)
    const { Encryption }        = await import('../../../security/encryption.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);
    const persona  = accountId ? await personas.get(accountId) : null;
    const llmConfig = persona?.llmConfig ?? {
      provider: (process.env.LLM_PROVIDER as any) ?? 'grok',
      model:    process.env.LLM_MODEL ?? 'grok-4-1-fast-non-reasoning',
      apiKey:   process.env.LLM_API_KEY,
      baseUrl:  process.env.LLM_BASE_URL,
    };

    const { NLSearch } = await import('../../../services/nl-search.ts');
    const searcher = new NLSearch(llmConfig);
    const results  = await searcher.search(accountId ?? 'acc-demo-001', query, Math.max(1, Math.max(1, Math.min(limit, 50))));

    res.json({ query, results, count: results.length });
  } catch (err) {
    logger.error('POST /search error', { err });
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── Labels ─────────────────────────────────────────────────────────────────

router.get('/labels', async (req, res) => {
  try {
    const { accountId } = req.query as { accountId?: string };
    if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { LabelManager } = await import('../../../labels/label-manager.ts');
    res.json(await new LabelManager().list(accountId));
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

router.post('/labels', async (req, res) => {
  try {
    const { accountId, name, color } = req.body as { accountId?: string; name?: string; color?: string };
    if (!accountId || !name?.trim()) { res.status(400).json({ error: 'accountId and name required' }); return; }
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { LabelManager } = await import('../../../labels/label-manager.ts');
    res.status(201).json(await new LabelManager().create(accountId, name, color));
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

router.delete('/labels/:id', async (req, res) => {
  try {
    const { accountId } = req.query as { accountId?: string };
    if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { LabelManager } = await import('../../../labels/label-manager.ts');
    await new LabelManager().delete(accountId, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

// ── Memory ─────────────────────────────────────────────────────────────────

router.get('/memory', async (req, res) => {
  try {
    const { accountId, limit = '20' } = req.query as { accountId?: string; limit?: string };
    if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const { rows } = await getPool().query(
      `SELECT id, type, content, importance, created_at FROM memories
       WHERE account_id = $1 ORDER BY importance DESC, created_at DESC LIMIT $2`,
      [accountId, safeLimit]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

router.delete('/memory/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.sub;
    // Verify the authenticated user owns this memory via the account chain
    const result = await getPool().query(
      `DELETE FROM memories WHERE id = $1
         AND account_id IN (SELECT id FROM email_accounts WHERE user_id = $2)`,
      [req.params.id, userId]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Memory not found' }); return; }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

// ── Unsubscribe ────────────────────────────────────────────────────────────

router.post('/emails/:id/unsubscribe', rateLimitMiddleware('unsubscribe'), async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT unsubscribe_url, unsubscribed_at FROM email_log WHERE id = $1`, [req.params.id]
    );
    const row = rows[0];
    if (!row) { res.status(404).json({ error: 'Email not found' }); return; }
    if (row.unsubscribed_at) { res.json({ success: true, alreadyDone: true }); return; }
    if (!row.unsubscribe_url) { res.status(400).json({ error: 'No unsubscribe URL found' }); return; }

    const { executeUnsubscribe } = await import('../../../services/unsubscriber.ts');
    const result = await executeUnsubscribe(row.unsubscribe_url);

    if (result.success) {
      await getPool().query(`UPDATE email_log SET unsubscribed_at = NOW() WHERE id = $1`, [req.params.id]);
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Unsubscribe failed' }); }
});

// ── Meeting coordination ───────────────────────────────────────────────────

router.get('/emails/:id/meeting-slots', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT agent_response, subject, from_address FROM email_log WHERE id = $1`, [req.params.id]
    );
    const row = rows[0];
    if (!row) { res.status(404).json({ error: 'Email not found' }); return; }

    const agentResp = row.agent_response ?? {};

    // Sanitize email-derived data before embedding in LLM prompt to prevent
    // prompt injection via crafted email content.
    const meetingTimes = ((agentResp.extractedData?.meetingTimes ?? []) as unknown[])
      .filter((t): t is string => typeof t === 'string' && t.length <= 100)
      .map((t) => t.replace(/['"\\<>\n\r`]/g, '').trim())
      .slice(0, 10);
    const safeSubject = String(row.subject ?? '').replace(/['"\\`]/g, '').slice(0, 200);

    // Generate suggested slots using LLM
    const llmConfig = {
      provider: (process.env.LLM_PROVIDER as any) ?? 'grok',
      model:    process.env.LLM_MODEL ?? 'grok-4-1-fast-non-reasoning',
      apiKey:   process.env.LLM_API_KEY,
      baseUrl:  process.env.LLM_BASE_URL,
    };

    const { LLMRouter } = await import('../../../llm/router.ts');
    const llm    = new LLMRouter(llmConfig);
    const prompt = `A meeting request email has these proposed times: ${meetingTimes.join(', ') || 'not specified'}.
Subject: "${safeSubject}"
Today is ${new Date().toDateString()}.

Suggest 3 alternative meeting slots for the next 5 business days. Return JSON:
{
  "proposedTimes": ["extracted times from email"],
  "suggestedSlots": [
    { "datetime": "YYYY-MM-DD HH:MM", "label": "e.g. Monday May 5 at 10:00 AM" }
  ],
  "draftResponse": "short polite reply confirming or proposing times"
}`;

    const raw  = await llm.complete(prompt, { maxTokens: 400, temperature: 0.3 });
    const m    = raw.match(/\{[\s\S]*\}/);
    const data = m ? JSON.parse(m[0]) : { proposedTimes: meetingTimes, suggestedSlots: [], draftResponse: '' };

    res.json({ emailId: req.params.id, ...data });
  } catch (err) {
    logger.error('GET /emails/:id/meeting-slots error', { err });
    res.status(500).json({ error: 'Failed to generate meeting slots' });
  }
});

// ── Agent Task Runner ──────────────────────────────────────────────────────

router.post('/tasks/parse', rateLimitMiddleware('llm_requests'), async (req, res) => {
  const { accountId, command } = req.body as { accountId?: string; command?: string };
  if (!accountId || !command?.trim()) {
    res.status(400).json({ error: 'accountId and command are required' }); return;
  }
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { Encryption }        = await import('../../../security/encryption.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);
    const persona  = await personas.get(accountId);

    const { AgentTaskRunner } = await import('../../../services/agent-task-runner.ts');
    const runner = new AgentTaskRunner(persona.llmConfig);
    const task   = await runner.parseCommand(accountId, command);
    res.json(task);
  } catch (err) {
    logger.error('POST /tasks/parse error', { err });
    res.status(500).json({ error: 'Failed to parse command' });
  }
});

router.post('/tasks/execute', rateLimitMiddleware('llm_requests'), async (req, res) => {
  const { accountId, task, limit = 30 } = req.body as { accountId?: string; task?: any; limit?: number };
  if (!accountId || !task) {
    res.status(400).json({ error: 'accountId and task are required' }); return;
  }
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { Encryption }        = await import('../../../security/encryption.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);
    const persona  = await personas.get(accountId);

    const { AgentTaskRunner } = await import('../../../services/agent-task-runner.ts');
    const runner = new AgentTaskRunner(persona.llmConfig);
    const result = await runner.execute(accountId, task, Math.max(1, Math.min(limit, 50)));
    res.json(result);
  } catch (err) {
    logger.error('POST /tasks/execute error', { err });
    res.status(500).json({ error: 'Failed to execute task' });
  }
});

// Convenience: parse + execute in one shot
router.post('/tasks/run', rateLimitMiddleware('llm_requests'), async (req, res) => {
  const { accountId, command, limit = 30 } = req.body as { accountId?: string; command?: string; limit?: number };
  if (!accountId || !command?.trim()) {
    res.status(400).json({ error: 'accountId and command are required' }); return;
  }
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { Encryption }        = await import('../../../security/encryption.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);
    const persona  = await personas.get(accountId);

    const { AgentTaskRunner } = await import('../../../services/agent-task-runner.ts');
    const runner = new AgentTaskRunner(persona.llmConfig);
    const task   = await runner.parseCommand(accountId, command);
    const result = await runner.execute(accountId, task, Math.max(1, Math.min(limit, 50)));
    res.json({ task, result });
  } catch (err) {
    logger.error('POST /tasks/run error', { err });
    res.status(500).json({ error: 'Failed to run task' });
  }
});

export default router;
