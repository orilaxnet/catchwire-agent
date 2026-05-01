/**
 * Intelligence routes — search, memory, labels, meeting coordination
 */

import { Router } from 'express';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger }  from '../../../utils/logger.ts';

const router = Router();

// ── Natural Language Search ────────────────────────────────────────────────

router.post('/search', async (req, res) => {
  const { accountId, query, limit = 20 } = req.body as { accountId?: string; query?: string; limit?: number };
  if (!query?.trim()) { res.status(400).json({ error: 'query is required' }); return; }

  try {
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
    const results  = await searcher.search(accountId ?? 'acc-demo-001', query, Math.min(limit, 50));

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
    const { LabelManager } = await import('../../../labels/label-manager.ts');
    res.json(await new LabelManager().list(accountId));
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

router.post('/labels', async (req, res) => {
  try {
    const { accountId, name, color } = req.body as { accountId?: string; name?: string; color?: string };
    if (!accountId || !name?.trim()) { res.status(400).json({ error: 'accountId and name required' }); return; }
    const { LabelManager } = await import('../../../labels/label-manager.ts');
    res.status(201).json(await new LabelManager().create(accountId, name, color));
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

router.delete('/labels/:id', async (req, res) => {
  try {
    const { accountId } = req.query as { accountId?: string };
    if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
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
    const { rows } = await getPool().query(
      `SELECT id, type, content, importance, created_at FROM memories
       WHERE account_id = $1 ORDER BY importance DESC, created_at DESC LIMIT $2`,
      [accountId, parseInt(limit)]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

router.delete('/memory/:id', async (req, res) => {
  try {
    await getPool().query(`DELETE FROM memories WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal error' }); }
});

// ── Unsubscribe ────────────────────────────────────────────────────────────

router.post('/emails/:id/unsubscribe', async (req, res) => {
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
    const meetingTimes = agentResp.extractedData?.meetingTimes ?? [];

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
Subject: "${row.subject}"
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

router.post('/tasks/parse', async (req, res) => {
  const { accountId, command } = req.body as { accountId?: string; command?: string };
  if (!accountId || !command?.trim()) {
    res.status(400).json({ error: 'accountId and command are required' }); return;
  }
  try {
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

router.post('/tasks/execute', async (req, res) => {
  const { accountId, task, limit = 30 } = req.body as { accountId?: string; task?: any; limit?: number };
  if (!accountId || !task) {
    res.status(400).json({ error: 'accountId and task are required' }); return;
  }
  try {
    const { Encryption }        = await import('../../../security/encryption.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);
    const persona  = await personas.get(accountId);

    const { AgentTaskRunner } = await import('../../../services/agent-task-runner.ts');
    const runner = new AgentTaskRunner(persona.llmConfig);
    const result = await runner.execute(accountId, task, Math.min(limit, 50));
    res.json(result);
  } catch (err) {
    logger.error('POST /tasks/execute error', { err });
    res.status(500).json({ error: 'Failed to execute task' });
  }
});

// Convenience: parse + execute in one shot
router.post('/tasks/run', async (req, res) => {
  const { accountId, command, limit = 30 } = req.body as { accountId?: string; command?: string; limit?: number };
  if (!accountId || !command?.trim()) {
    res.status(400).json({ error: 'accountId and command are required' }); return;
  }
  try {
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
    const result = await runner.execute(accountId, task, Math.min(limit, 50));
    res.json({ task, result });
  } catch (err) {
    logger.error('POST /tasks/run error', { err });
    res.status(500).json({ error: 'Failed to run task' });
  }
});

export default router;
