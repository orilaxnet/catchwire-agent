import { Router } from 'express';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger } from '../../../utils/logger.ts';

const router = Router();

async function assertOwnsAccount(accountId: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'SELECT 1 FROM email_accounts WHERE id = $1 AND user_id = $2',
    [accountId, userId]
  );
  return (rowCount ?? 0) > 0;
}

const VALID_INTENTS = [
  'payment', 'complaint', 'meeting_request', 'follow_up',
  'action_required', 'question', 'deadline', 'order_tracking',
  'partnership', 'hiring', 'newsletter', 'fyi',
];

// ── Get all prompt profiles (global + all intents) ──────────────────────────

router.get('/accounts/:id/prompts', async (req, res) => {
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(req.params.id, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { rows } = await getPool().query(
      `SELECT * FROM prompt_profiles WHERE account_id = $1 ORDER BY scope, intent_type`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error('GET /prompts error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Save / update a prompt ──────────────────────────────────────────────────
// scope='global': saves as global prompt, optionally activates
// scope='intent': upserts per intent_type (always active when present)

router.post('/accounts/:id/prompts', async (req, res) => {
  const userId = (req as any).user?.sub;
  if (!await assertOwnsAccount(req.params.id, userId).catch(() => false)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  const { name, description, system_prompt, scope = 'global', intent_type, activate } = req.body as {
    name?: string; description?: string; system_prompt?: string;
    scope?: 'global' | 'intent'; intent_type?: string; activate?: boolean;
  };

  if (!name?.trim())          { res.status(400).json({ error: 'name is required' }); return; }
  if (!system_prompt?.trim()) { res.status(400).json({ error: 'system_prompt is required' }); return; }
  if (system_prompt.trim().length > 12_000) {
    res.status(400).json({ error: 'system_prompt must be ≤12,000 characters' }); return;
  }
  if (name.trim().length > 120) {
    res.status(400).json({ error: 'name must be ≤120 characters' }); return;
  }
  if (scope === 'intent' && (!intent_type || !VALID_INTENTS.includes(intent_type))) {
    res.status(400).json({ error: `intent_type must be one of: ${VALID_INTENTS.join(', ')}` }); return;
  }

  const pool = getPool();
  try {
    let row;

    if (scope === 'intent') {
      // Upsert: one prompt per intent per account
      const result = await pool.query(
        `INSERT INTO prompt_profiles (account_id, name, description, system_prompt, scope, intent_type, is_active)
         VALUES ($1,$2,$3,$4,'intent',$5,TRUE)
         ON CONFLICT (account_id, intent_type) WHERE scope = 'intent' AND intent_type IS NOT NULL
         DO UPDATE SET name=$2, description=$3, system_prompt=$4, updated_at=NOW()
         RETURNING *`,
        [req.params.id, name.trim(), description?.trim() ?? null, system_prompt.trim(), intent_type]
      );
      row = result.rows[0];
    } else {
      // Global: insert new profile
      if (activate) {
        await pool.query(
          `UPDATE prompt_profiles SET is_active=FALSE WHERE account_id=$1 AND scope='global'`,
          [req.params.id]
        );
      }
      const result = await pool.query(
        `INSERT INTO prompt_profiles (account_id, name, description, system_prompt, scope, is_active)
         VALUES ($1,$2,$3,$4,'global',$5) RETURNING *`,
        [req.params.id, name.trim(), description?.trim() ?? null, system_prompt.trim(), Boolean(activate)]
      );
      row = result.rows[0];

      if (activate) {
        await pool.query(
          `UPDATE personas SET system_prompt=$1 WHERE account_id=$2`,
          [system_prompt.trim(), req.params.id]
        );
      }
    }

    res.status(201).json(row);
  } catch (err) {
    logger.error('POST /prompts error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Activate a global prompt ────────────────────────────────────────────────

router.post('/accounts/:accountId/prompts/:id/activate', async (req, res) => {
  const pool = getPool();
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(req.params.accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { rows } = await pool.query(
      `SELECT * FROM prompt_profiles WHERE id=$1 AND account_id=$2`,
      [req.params.id, req.params.accountId]
    );
    if (!rows.length) { res.status(404).json({ error: 'Prompt not found' }); return; }
    if (rows[0].scope !== 'global') {
      res.status(400).json({ error: 'Only global prompts can be activated — intent prompts are always active' });
      return;
    }

    await pool.query(
      `UPDATE prompt_profiles SET is_active=FALSE WHERE account_id=$1 AND scope='global'`,
      [req.params.accountId]
    );
    await pool.query(`UPDATE prompt_profiles SET is_active=TRUE WHERE id=$1`, [req.params.id]);
    await pool.query(
      `INSERT INTO personas (account_id, system_prompt) VALUES ($1,$2)
       ON CONFLICT (account_id) DO UPDATE SET system_prompt=$2, updated_at=NOW()`,
      [req.params.accountId, rows[0].system_prompt]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('POST /prompts/activate error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Deactivate all global prompts (revert to built-in default) ──────────────

router.post('/accounts/:id/prompts/deactivate', async (req, res) => {
  const pool = getPool();
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(req.params.id, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    await pool.query(
      `UPDATE prompt_profiles SET is_active=FALSE WHERE account_id=$1 AND scope='global'`,
      [req.params.id]
    );
    await pool.query(`UPDATE personas SET system_prompt=NULL WHERE account_id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error('POST /prompts/deactivate error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Update a prompt (name, description, body) ───────────────────────────────

router.patch('/accounts/:accountId/prompts/:id', async (req, res) => {
  const { name, description, system_prompt } = req.body as {
    name?: string; description?: string; system_prompt?: string;
  };
  const pool = getPool();
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(req.params.accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { rows } = await pool.query(
      `UPDATE prompt_profiles
       SET name=COALESCE($1,name), description=COALESCE($2,description),
           system_prompt=COALESCE($3,system_prompt), updated_at=NOW()
       WHERE id=$4 AND account_id=$5 RETURNING *`,
      [name ?? null, description ?? null, system_prompt ?? null, req.params.id, req.params.accountId]
    );
    if (!rows.length) { res.status(404).json({ error: 'Prompt not found' }); return; }

    // If this global prompt is active, sync to personas
    if (rows[0].scope === 'global' && rows[0].is_active && system_prompt) {
      await pool.query(
        `UPDATE personas SET system_prompt=$1 WHERE account_id=$2`,
        [system_prompt, req.params.accountId]
      );
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error('PATCH /prompts/:id error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Delete a prompt ─────────────────────────────────────────────────────────

router.delete('/accounts/:accountId/prompts/:id', async (req, res) => {
  const pool = getPool();
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(req.params.accountId, userId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { rows } = await pool.query(
      `SELECT scope, is_active FROM prompt_profiles WHERE id=$1 AND account_id=$2`,
      [req.params.id, req.params.accountId]
    );
    if (!rows.length) { res.status(404).json({ error: 'Prompt not found' }); return; }

    await pool.query(`DELETE FROM prompt_profiles WHERE id=$1`, [req.params.id]);

    if (rows[0].scope === 'global' && rows[0].is_active) {
      await pool.query(`UPDATE personas SET system_prompt=NULL WHERE account_id=$1`, [req.params.accountId]);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /prompts/:id error', { err });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Regenerate reply with instruction ──────────────────────────────────────

router.post('/emails/:id/regenerate', async (req, res) => {
  const { instruction, accountId } = req.body as { instruction?: string; accountId?: string };
  if (!instruction?.trim()) { res.status(400).json({ error: 'instruction is required' }); return; }

  const pool = getPool();
  try {
    const userId = (req as any).user?.sub;
    const { rows: emailRows } = await pool.query(
      `SELECT el.id, el.account_id, el.from_address, el.sender_name, el.subject,
              el.body, el.agent_response, el.received_at
       FROM email_log el
       JOIN email_accounts ea ON ea.id = el.account_id
       WHERE el.id = $1 AND ea.user_id = $2`,
      [req.params.id, userId]
    );
    if (!emailRows.length) { res.status(404).json({ error: 'Email not found' }); return; }
    const emailRow = emailRows[0];
    const accId    = accountId ?? emailRow.account_id;

    const { rows: pRows } = await pool.query(`SELECT * FROM personas WHERE account_id=$1`, [accId]);
    const p = pRows[0];
    const persona = {
      accountId: accId,
      tone:         p?.tone           ?? 'professional',
      useEmoji:     Boolean(p?.use_emoji),
      language:     p?.language       ?? 'auto',
      autonomyLevel: p?.autonomy_level ?? 'draft',
      systemPrompt: p?.system_prompt  ?? undefined,
      onboardingDone: false, shadowMode: false,
      llmConfig: {
        provider: p?.llm_provider ?? process.env.LLM_PROVIDER ?? 'openrouter',
        model:    p?.llm_model    ?? process.env.LLM_MODEL    ?? 'google/gemini-flash-1.5',
        apiKey:   process.env.LLM_API_KEY,
        baseUrl:  p?.llm_base_url ?? process.env.LLM_BASE_URL ?? undefined,
      },
    };

    // Load intent prompts too
    const { rows: intentRows } = await pool.query(
      `SELECT intent_type, system_prompt FROM prompt_profiles WHERE account_id=$1 AND scope='intent'`,
      [accId]
    );
    const intentPrompts: Record<string, string> = {};
    for (const r of intentRows) intentPrompts[r.intent_type] = r.system_prompt;

    const currentDraft = emailRow.agent_response?.suggestedReplies?.[0]?.body ?? '';
    const parsedEmail  = {
      originalSender:     emailRow.from_address,
      originalSenderName: emailRow.sender_name ?? emailRow.from_address,
      subject:            emailRow.subject,
      bodyText:           emailRow.body ?? '',
      originalDate:       new Date(emailRow.received_at ?? Date.now()),
    };

    const { PromptEngine } = await import('../../../llm/prompt-engine.ts');
    const { LLMRouter }    = await import('../../../llm/router.ts');
    const promptText = new PromptEngine().buildRegeneratePrompt(
      { email: parsedEmail as any, persona }, instruction.trim(), currentDraft, intentPrompts
    );
    const raw = await new LLMRouter(persona.llmConfig).complete(promptText);

    let parsed: any;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m?.[0] ?? raw);
    } catch {
      parsed = { suggestedReplies: [{ label: 'Revised', body: raw, tone: persona.tone }] };
    }

    const newReplies = parsed.suggestedReplies ?? [{ label: 'Revised', body: raw, tone: persona.tone }];
    const updated    = { ...(emailRow.agent_response ?? {}), suggestedReplies: newReplies, lastInstruction: instruction };
    await pool.query(`UPDATE email_log SET agent_response=$1 WHERE id=$2`, [JSON.stringify(updated), req.params.id]);

    res.json({ suggestedReplies: newReplies });
  } catch (err) {
    logger.error('POST /emails/:id/regenerate error', { err });
    res.status(500).json({ error: 'Regeneration failed' });
  }
});

export default router;
