import { randomUUID } from 'crypto';
import type { ParsedEmail, AgentResponse, AutonomyLevel } from '../types/index.ts';
import { AgentResponseSchema } from '../llm/schemas.ts';
import { PromptEngine } from '../llm/prompt-engine.ts';
import { getPool }  from '../storage/pg-pool.ts';
import { EmailLogRepo, AccountRepo, FeedbackRepo } from '../storage/sqlite.adapter.ts';
import { webhookDispatcher } from '../services/webhook-dispatcher.ts';
import { logger } from '../utils/logger.ts';

interface ControllerDeps {
  llmRouter:        any;
  interfaceManager: any;
  pluginManager:    any;
  encryption:       any;
}

export class ActionController {
  private promptEngine = new PromptEngine();

  constructor(private deps: ControllerDeps) {}

  async processEmail(email: ParsedEmail): Promise<void> {
    const startTime = Date.now();
    const emailId   = randomUUID();

    try {
      logger.info('Processing email', { emailId, sender: email.originalSender, subject: email.subject });

      const processedEmail = await this.deps.pluginManager.runBeforeEmailProcess(email);
      const persona        = await this.getPersona(processedEmail.accountId);
      const intentPrompts  = await this.getIntentPrompts(processedEmail.accountId);
      const thread         = processedEmail.threadId ? await this.getThread(processedEmail.threadId) : undefined;
      const prompt         = this.promptEngine.buildAnalysisPrompt({ email: processedEmail, persona, thread }, intentPrompts);

      const analysisResult = await this.deps.llmRouter.completeWithRetry(
        prompt,
        (raw: any) => AgentResponseSchema.parse(raw),
      );

      const processingMs = Date.now() - startTime;

      await EmailLogRepo.insert({
        id:           emailId,
        accountId:    processedEmail.accountId,
        threadId:     processedEmail.threadId,
        sender:       processedEmail.originalSender,
        senderName:   processedEmail.originalSenderName,
        subject:      processedEmail.subject,
        body:         processedEmail.body,
        summary:      analysisResult.summary,
        priority:     analysisResult.priority,
        intent:       analysisResult.intent,
        receivedAt:   processedEmail.originalDate,
        agentResponse: JSON.stringify(analysisResult),
        processingMs,
        llmProvider:  persona.llmConfig?.provider,
      });
      await AccountRepo.logEmail(processedEmail.accountId);

      await this.deps.pluginManager.runAfterEmailProcess(processedEmail, analysisResult);

      webhookDispatcher.dispatch('email.received', {
        emailId, accountId: processedEmail.accountId, from: processedEmail.originalSender,
        subject: processedEmail.subject, priority: analysisResult.priority,
        summary: analysisResult.summary, agentDraft: analysisResult.suggestedReplies[0]?.body,
      });

      if (analysisResult.priority === 'critical') {
        webhookDispatcher.dispatch('priority.critical', {
          emailId, accountId: processedEmail.accountId,
          from: processedEmail.originalSender, subject: processedEmail.subject,
          summary: analysisResult.summary,
        });
      }

      await this.decide(emailId, processedEmail, analysisResult, persona.autonomyLevel);
    } catch (error) {
      logger.error('Failed to process email', error as Error);
    }
  }

  private async decide(emailId: string, email: ParsedEmail, analysis: AgentResponse, autonomy: AutonomyLevel): Promise<void> {
    const userId = await this.getUserId(email.accountId);
    if (analysis.priority === 'critical') return this.notifyUser(userId, emailId, email, analysis, 'approval_required');

    switch (autonomy) {
      case 'full':
        if (analysis.confidence >= 0.9) await this.autoSendReply(emailId, email, analysis);
        else await this.notifyUser(userId, emailId, email, analysis, 'approval_required');
        break;
      case 'draft':
        await this.notifyUser(userId, emailId, email, analysis, 'draft_ready');
        break;
      case 'consultative':
        await this.notifyUser(userId, emailId, email, analysis, 'summary_only');
        break;
    }
  }

  // Decode RFC 2047 MIME-encoded words like =?UTF-8?Q?hello?=
  private decodeMimeSubject(subject: string): string {
    return subject.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_match, _charset, encoding, text) => {
      try {
        if (encoding.toUpperCase() === 'Q') {
          return decodeURIComponent(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, '%$1'));
        }
        return Buffer.from(text, 'base64').toString('utf8');
      } catch { return text; }
    });
  }

  private async notifyUser(userId: string, emailId: string, email: ParsedEmail, analysis: AgentResponse, mode: 'approval_required' | 'draft_ready' | 'summary_only'): Promise<void> {
    const priorityEmoji: Record<string, string> = { critical: '🚨', high: '⚠️', medium: '📌', low: 'ℹ️' };
    const subject = this.decodeMimeSubject(email.subject);

    let text = [
      `📧 New Email`, ``,
      `👤 From: ${email.originalSenderName || email.originalSender}`,
      `📌 Subject: ${subject}`,
      `🕐 Received: ${email.originalDate.toLocaleString()}`,
      ``, `━━━━━━━━━━━━━━━━━━━`, `📋 Summary:`, analysis.summary, ``,
      `🎯 Intent: ${analysis.intent} | ${priorityEmoji[analysis.priority]} Priority: ${analysis.priority}`,
      `━━━━━━━━━━━━━━━━━━━`,
    ].join('\n');

    if (mode !== 'summary_only') {
      text += '\n\n💬 Suggested replies:\n';
      analysis.suggestedReplies.forEach((reply, i) => {
        text += `\n${i + 1}️⃣ ${reply.label}\n"${reply.body.substring(0, 100)}..."\n`;
      });
      text += `\n━━━━━━━━━━━━━━━━━━━`;
      text += `\n🤖 AI confidence: ${(analysis.confidence * 100).toFixed(0)}%`;
    }

    const buttons: any[] = mode !== 'summary_only'
      ? analysis.suggestedReplies.map((reply, i) => ({
          id: `send_reply_${i}`, label: `✅ Send ${i + 1}: ${reply.label}`, style: 'primary' as const,
          action: { type: 'callback' as const, data: { action: 'send_reply', emailId, replyIndex: i } },
        }))
      : [];

    buttons.push(
      { id: 'edit_reply', label: '✏️ Edit',      style: 'secondary' as const, action: { type: 'callback' as const, data: { action: 'edit',      emailId } } },
      { id: 'ignore',     label: '❌ Ignore',     style: 'danger'    as const, action: { type: 'callback' as const, data: { action: 'ignore',     emailId } } },
      { id: 'full_text',  label: '📋 Full Text', style: 'secondary' as const, action: { type: 'callback' as const, data: { action: 'full_text', emailId } } },
    );

    await this.deps.interfaceManager.sendToUser(userId, {
      text, format: 'plain', buttons,
      priority: analysis.priority === 'critical' ? 'urgent' : 'normal',
    });
  }

  private async autoSendReply(emailId: string, email: ParsedEmail, result: AgentResponse): Promise<void> {
    const reply = result.suggestedReplies[0];
    logger.info('Auto-sending reply', { emailId, label: reply.label });

    const { rows } = await getPool().query('SELECT * FROM email_accounts WHERE id = $1', [email.accountId]);
    const account  = rows[0];

    if (account) {
      const { EmailSender } = await import('../services/email-sender.ts');
      await new EmailSender().send(email.accountId, {
        from: account.email_address, to: email.originalSender,
        subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
        body: reply.body, inReplyTo: emailId,
      });
    }

    webhookDispatcher.dispatch('email.replied', { emailId, accountId: email.accountId, to: email.originalSender, auto: true });
    await EmailLogRepo.recordAction(emailId, 'sent_as_is');
    await FeedbackRepo.insert({ emailLogId: emailId, accountId: email.accountId, prediction: result, userAction: 'sent_as_is', wasCorrect: true, createdAt: new Date() });
  }

  private async getPersona(accountId: string): Promise<any> {
    const { rows } = await getPool().query('SELECT * FROM personas WHERE account_id = $1', [accountId]);
    const row = rows[0];
    if (!row) return {
      tone: 'professional', useEmoji: false, language: 'auto', autonomyLevel: 'draft',
      llmConfig: { provider: process.env.LLM_PROVIDER || 'openrouter', apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL || 'google/gemini-flash-1.5' },
    };
    return {
      tone: row.tone, useEmoji: row.use_emoji, language: row.language, autonomyLevel: row.autonomy_level,
      shadowMode: row.shadow_mode, onboardingDone: row.onboarding_done,
      systemPrompt: row.system_prompt ?? undefined,
      llmConfig: { provider: row.llm_provider ?? process.env.LLM_PROVIDER, model: row.llm_model ?? process.env.LLM_MODEL, apiKey: process.env.LLM_API_KEY },
    };
  }

  private async getIntentPrompts(accountId: string): Promise<Record<string, string>> {
    try {
      const { rows } = await getPool().query(
        `SELECT intent_type, system_prompt FROM prompt_profiles
         WHERE account_id = $1 AND scope = 'intent' AND intent_type IS NOT NULL`,
        [accountId]
      );
      const map: Record<string, string> = {};
      for (const row of rows) map[row.intent_type] = row.system_prompt;
      return map;
    } catch { return {}; }
  }

  private async getThread(threadId: string): Promise<any> {
    const { rows } = await getPool().query('SELECT * FROM threads WHERE id = $1', [threadId]);
    return rows[0];
  }

  private async getUserId(accountId: string): Promise<string> {
    // Return telegram_id so the Telegram interface can use it as chat_id directly.
    // Falls back to the db user_id if no telegram_id is set.
    const { rows } = await getPool().query(
      `SELECT u.telegram_id, u.id
       FROM email_accounts ea JOIN users u ON u.id = ea.user_id
       WHERE ea.id = $1 LIMIT 1`,
      [accountId]
    );
    const row = rows[0];
    return row?.telegram_id ?? row?.id ?? '';
  }
}
