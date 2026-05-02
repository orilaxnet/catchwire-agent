/**
 * Agent Chat — conversational interface for inbox management.
 * POST /api/chat  { accountId, message, history? }
 */

import { Router } from 'express';
import { getPool } from '../../../storage/pg-pool.ts';
import { logger } from '../../../utils/logger.ts';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware.ts';

const router = Router();

async function assertOwnsAccount(accountId: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'SELECT 1 FROM email_accounts WHERE id = $1 AND user_id = $2',
    [accountId, userId]
  );
  return (rowCount ?? 0) > 0;
}

router.post('/chat', rateLimitMiddleware('llm_requests'), async (req, res) => {
  const { accountId, message, history = [] } = req.body as {
    accountId?: string;
    message?:   string;
    history?:   Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!accountId || !message?.trim()) {
    res.status(400).json({ error: 'accountId and message are required' });
    return;
  }

  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    const { Encryption }        = await import('../../../security/encryption.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);
    const persona  = await personas.get(accountId);
    const llmConfig = persona.llmConfig;

    const { AgentTaskRunner } = await import('../../../services/agent-task-runner.ts');
    const runner = new AgentTaskRunner(llmConfig);

    // Step 1: Try to parse as a task command
    const task = await runner.parseCommand(accountId, message).catch(() => null);

    if (task?.isTask) {
      // Search: execute immediately
      if (task.action === 'search') {
        const result = await runner.execute(accountId, task, 10);
        const reply  = result.processed === 0
          ? "I didn't find any emails matching your query. Try different keywords."
          : `Found **${result.processed} email(s)**:\n\n${result.details.slice(0, 8).join('\n')}`;
        res.json({ reply, action: 'search', result });
        return;
      }

      // Destructive actions: show preview and ask for confirmation
      if (['unsubscribe_all', 'forward_all', 'ignore_all', 'reply_to_all'].includes(task.action)) {
        const { NLSearch } = await import('../../../services/nl-search.ts');
        const searcher = new NLSearch(llmConfig);
        const preview  = await searcher.search(accountId, task.query, 5);
        const count    = preview.length;
        const previewLines = preview.slice(0, 4).map(e =>
          `• ${e.sender_name || e.from_address} — ${e.subject?.slice(0, 50) ?? ''}`
        );
        const reply = `${task.explanation}\n\nI found **${count}** email(s) matching:\n${previewLines.join('\n')}${count > 4 ? `\n…and more` : ''}\n\nShall I proceed?`;
        res.json({ reply, action: 'confirm', task, previewCount: count });
        return;
      }

      // Summarize: execute directly
      if (task.action === 'summarize') {
        const result = await runner.execute(accountId, task, 20);
        res.json({ reply: result.summary || 'No emails found to summarize.', action: 'summarize', result });
        return;
      }
    }

    // Fallback: general LLM conversation with email context
    const { LLMRouter } = await import('../../../llm/router.ts');
    const { getPool }   = await import('../../../storage/pg-pool.ts');
    const llm = new LLMRouter(llmConfig);

    // Get recent email context (last 5 emails)
    const { rows: recentEmails } = await getPool().query(
      `SELECT from_address, sender_name, subject, summary, intent, priority
       FROM email_log WHERE account_id = $1
       ORDER BY processed_at DESC LIMIT 5`,
      [accountId]
    );

    const contextBlock = recentEmails.length
      ? `Recent emails:\n${recentEmails.map(e =>
          `- From ${e.sender_name || e.from_address}: "${e.subject}" (${e.intent}, ${e.priority}): ${e.summary ?? ''}`
        ).join('\n')}`
      : '';

    const conversationHistory = history.slice(-6).map(m =>
      `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`
    ).join('\n');

    const prompt = `You are an intelligent email agent assistant. Help the user manage their inbox.
${contextBlock}
${conversationHistory ? `\nConversation so far:\n${conversationHistory}` : ''}

User: ${message}

Respond conversationally and helpfully. If asked about emails, reference the context above.
If the user wants to take action (send, forward, unsubscribe, search), explain that they can type natural language commands like "unsubscribe all newsletters" or "find emails from Alex".
Keep replies concise (2-4 sentences).`;

    let reply = (await llm.complete(prompt, { maxTokens: 300, temperature: 0.7 })).trim();
    // Strip JSON wrapper if LLM returns {"response":"..."} or {"reply":"..."}
    try {
      const parsed = JSON.parse(reply);
      if (typeof parsed === 'object' && parsed !== null) {
        reply = parsed.reply ?? parsed.response ?? parsed.message ?? parsed.text ?? reply;
      }
    } catch { /* not JSON, use as-is */ }
    res.json({ reply, action: 'chat' });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('POST /chat error', { msg, stack: err instanceof Error ? err.stack : undefined });
    res.status(500).json({ error: 'Chat failed' });
  }
});

// Execute a confirmed task
router.post('/chat/execute', rateLimitMiddleware('llm_requests'), async (req, res) => {
  const { accountId, task } = req.body as { accountId?: string; task?: any };
  if (!accountId || !task) {
    res.status(400).json({ error: 'accountId and task are required' }); return;
  }
  try {
    const userId = (req as any).user?.sub;
    if (!await assertOwnsAccount(accountId, userId)) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    const { Encryption }        = await import('../../../security/encryption.ts');
    const { CredentialManager } = await import('../../../security/credential-manager.ts');
    const { PersonaManager }    = await import('../../../persona/persona-manager.ts');
    const enc      = new Encryption(process.env.ENCRYPTION_KEY!);
    const creds    = new CredentialManager(enc);
    const personas = new PersonaManager(creds);
    const persona  = await personas.get(accountId);

    const { AgentTaskRunner } = await import('../../../services/agent-task-runner.ts');
    const runner = new AgentTaskRunner(persona.llmConfig);
    const result = await runner.execute(accountId, task, 50);

    const reply = [
      result.summary,
      result.details.length ? `\n${result.details.slice(0, 10).join('\n')}` : '',
    ].join('');

    res.json({ reply, result });
  } catch (err) {
    logger.error('POST /chat/execute error', { err });
    res.status(500).json({ error: 'Execution failed' });
  }
});

export default router;
