/**
 * Agent Task Runner — executes natural-language commands on the email inbox.
 *
 * Supports commands like:
 *   "unsubscribe all newsletters"
 *   "forward all emails from Alex to bob@example.com"
 *   "summarize everything about invoices"
 *   "ignore all cold pitches"
 *   "find emails about the project from last week"
 */

import { getPool }       from '../storage/pg-pool.ts';
import { NLSearch }      from './nl-search.ts';
import { EmailSender }   from './email-sender.ts';
import { EmailLogRepo }  from '../storage/sqlite.adapter.ts';
import { executeUnsubscribe } from './unsubscriber.ts';
import { logger }        from '../utils/logger.ts';
import type { LLMConfig } from '../types/index.ts';

export type TaskAction =
  | 'search'
  | 'unsubscribe_all'
  | 'forward_all'
  | 'ignore_all'
  | 'summarize'
  | 'reply_to_all';

export interface ParsedTask {
  action:    TaskAction;
  query:     string;              // NL description of which emails
  params?: {
    forwardTo?:  string;          // for forward_all
    replyText?:  string;          // for reply_to_all
  };
  explanation: string;            // human-readable plan shown to user before execution
  isTask:    boolean;             // false for pure conversational messages
}

export interface TaskResult {
  action:    TaskAction;
  processed: number;
  succeeded: number;
  failed:    number;
  details:   string[];            // per-email result lines
  summary:   string;
}

/** Convert a nested JSON object returned by the LLM into readable prose lines. */
function jsonToProse(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const title = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (Array.isArray(value)) {
      lines.push(`**${title}:** ${value.join('; ')}`);
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`**${title}:** ${jsonToProse(value as Record<string, unknown>)}`);
    } else {
      lines.push(`**${title}:** ${value}`);
    }
  }
  return lines.join('\n');
}

export class AgentTaskRunner {
  private search:  NLSearch;
  private sender:  EmailSender;

  constructor(private llmConfig: LLMConfig) {
    this.search = new NLSearch(llmConfig);
    this.sender = new EmailSender();
  }

  /** Parse a free-form command into a structured task plan. */
  async parseCommand(accountId: string, command: string): Promise<ParsedTask> {
    const { LLMRouter } = await import('../llm/router.ts');
    const llm = new LLMRouter(this.llmConfig);

    const prompt = `You are an email agent assistant. Parse the user message into a structured task.

User message: "${command}"

Return ONLY this JSON:
{
  "isTask": true or false,
  "action": one of ["search", "unsubscribe_all", "forward_all", "ignore_all", "summarize", "reply_to_all"],
  "query": "English description of which emails to match (translate if needed)",
  "params": {
    "forwardTo": "email address if forwarding, else null",
    "replyText": "reply text if replying, else null"
  },
  "explanation": "one sentence plan in the same language as the user message"
}

Action meanings:
- search: find and list matching emails (use for "show me", "find", "list", "what are", "which emails")
- summarize: summarize email content (use for "summarize", "digest", "overview", "خلاصه", "چه هستند")
- unsubscribe_all: unsubscribe from newsletters
- forward_all: forward emails to an address
- ignore_all: mark emails as ignored
- reply_to_all: send a reply to matching emails

Query translation guide (always write query in English):
- "پاسخ نداده / بی‌پاسخ / بدون پاسخ" → "unanswered emails"
- "فوری / مهم" → "high priority emails"
- "فاکتور / پرداخت" → "invoice payment emails"
- "خبرنامه / تبلیغ" → "newsletter marketing emails"
- "جلسه / قرار ملاقات" → "meeting request emails"
- "همه / آخرین" → "all recent emails"

Set isTask=false ONLY for: greetings, "what can you do", pure chat with no email intent.
Set isTask=true for ANY question or command about emails.
Only return the JSON object, no extra text.`;

    const raw = await llm.complete(prompt, { maxTokens: 300, temperature: 0.1 });
    const m   = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse command');

    const parsed = JSON.parse(m[0]) as ParsedTask;
    return parsed;
  }

  /** Execute a parsed task and return a result summary. */
  async execute(accountId: string, task: ParsedTask, limit = 30, userLanguage = 'en'): Promise<TaskResult> {
    const emails = await this.search.search(accountId, task.query, limit);

    const result: TaskResult = {
      action:    task.action,
      processed: emails.length,
      succeeded: 0,
      failed:    0,
      details:   [],
      summary:   '',
    };

    if (emails.length === 0) {
      result.summary = 'No matching emails found.';
      return result;
    }

    switch (task.action) {
      case 'search':
        result.succeeded = emails.length;
        result.details   = emails.map(e => `• ${e.sender_name || e.from_address} — ${e.subject}`);
        result.summary   = `Found ${emails.length} email(s) matching your query.`;
        break;

      case 'unsubscribe_all':
        await this.runUnsubscribeAll(accountId, emails, result);
        break;

      case 'forward_all':
        await this.runForwardAll(accountId, emails, task.params?.forwardTo ?? '', result);
        break;

      case 'ignore_all':
        await this.runIgnoreAll(emails, result);
        break;

      case 'summarize':
        await this.runSummarize(emails, result, userLanguage);
        break;

      case 'reply_to_all':
        await this.runReplyToAll(accountId, emails, task.params?.replyText ?? '', result);
        break;
    }

    return result;
  }

  private async runUnsubscribeAll(accountId: string, emails: any[], result: TaskResult): Promise<void> {
    for (const email of emails) {
      try {
        // Fetch the full row to get unsubscribe_url
        const { rows } = await getPool().query(
          `SELECT unsubscribe_url, unsubscribed_at FROM email_log WHERE id = $1`, [email.id]
        );
        const row = rows[0];

        if (!row) { result.failed++; result.details.push(`• ${email.subject} — not found`); continue; }
        if (row.unsubscribed_at) {
          result.succeeded++;
          result.details.push(`• ${email.subject} — already unsubscribed`);
          continue;
        }
        if (!row.unsubscribe_url) {
          result.failed++;
          result.details.push(`• ${email.subject} — no unsubscribe link found`);
          continue;
        }

        const r = await executeUnsubscribe(row.unsubscribe_url);
        if (r.success) {
          await getPool().query(`UPDATE email_log SET unsubscribed_at = NOW() WHERE id = $1`, [email.id]);
          await EmailLogRepo.recordAction(email.id, 'ignored');
          result.succeeded++;
          result.details.push(`• ${email.subject} ✅ unsubscribed`);
        } else {
          result.failed++;
          result.details.push(`• ${email.subject} ⚠️ ${r.error ?? 'failed'}`);
        }
      } catch (err) {
        result.failed++;
        result.details.push(`• ${email.subject} ❌ error`);
        logger.error('Unsubscribe task error', { emailId: email.id, err });
      }
    }
    result.summary = `Unsubscribed from ${result.succeeded}/${result.processed} senders. ${result.failed > 0 ? `${result.failed} failed.` : ''}`;
  }

  private async runForwardAll(accountId: string, emails: any[], forwardTo: string, result: TaskResult): Promise<void> {
    if (!forwardTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwardTo) || forwardTo.length > 320) {
      result.failed = emails.length;
      result.summary = 'Invalid forward-to address.';
      return;
    }

    const { rows: acctRows } = await getPool().query(
      `SELECT email_address FROM email_accounts WHERE id = $1`, [accountId]
    );
    const fromAddr = acctRows[0]?.email_address ?? '';

    for (const email of emails) {
      try {
        const { rows } = await getPool().query(
          `SELECT from_address, subject, body FROM email_log WHERE id = $1`, [email.id]
        );
        const row = rows[0];
        if (!row) { result.failed++; continue; }

        const fwdBody = `---------- Forwarded message ----------\nFrom: ${row.from_address}\nSubject: ${row.subject}\n\n${row.body ?? ''}`;
        const res = await this.sender.send(accountId, {
          from:    fromAddr,
          to:      forwardTo,
          subject: `Fwd: ${row.subject ?? ''}`,
          body:    fwdBody,
        });

        if (res.success) {
          result.succeeded++;
          result.details.push(`• ${email.subject} ✅ forwarded`);
        } else {
          result.failed++;
          result.details.push(`• ${email.subject} ❌ ${res.error}`);
        }
      } catch (err) {
        result.failed++;
        logger.error('Forward task error', { emailId: email.id, err });
      }
    }
    result.summary = `Forwarded ${result.succeeded}/${result.processed} emails to ${forwardTo}.`;
  }

  private async runIgnoreAll(emails: any[], result: TaskResult): Promise<void> {
    for (const email of emails) {
      try {
        await EmailLogRepo.recordAction(email.id, 'ignored');
        result.succeeded++;
        result.details.push(`• ${email.subject} ✅ ignored`);
      } catch {
        result.failed++;
        result.details.push(`• ${email.subject} ❌ failed`);
      }
    }
    result.summary = `Marked ${result.succeeded} emails as ignored.`;
  }

  private async runSummarize(emails: any[], result: TaskResult, userLanguage = 'en'): Promise<void> {
    const { LLMRouter } = await import('../llm/router.ts');
    const llm = new LLMRouter(this.llmConfig);

    const emailList = emails.map((e, i) =>
      `${i + 1}. From: ${e.sender_name || e.from_address} | Subject: ${e.subject} | Summary: ${e.summary ?? 'N/A'}`
    ).join('\n');

    const langNote = userLanguage !== 'en'
      ? `IMPORTANT: Write your response in ${userLanguage}. `
      : '';

    const prompt = `${langNote}Summarize these ${emails.length} emails as a short readable digest. Use plain prose paragraphs — NO JSON, NO code blocks, NO bullet lists of keys. Just write sentences.\n\n${emailList}`;

    try {
      let summary = await llm.complete(prompt, { maxTokens: 500, temperature: 0.3 });

      // Strip markdown code fences
      summary = summary.replace(/^```[a-z]*\n?/gim, '').replace(/\n?```$/gim, '').trim();

      // If LLM still returned JSON, convert it to readable prose
      try {
        const parsed = JSON.parse(summary);
        if (typeof parsed === 'object' && parsed !== null) {
          summary = jsonToProse(parsed);
        }
      } catch { /* not JSON — fine */ }

      result.succeeded = emails.length;
      result.details   = [summary];
      result.summary   = summary;
    } catch {
      result.failed  = emails.length;
      result.summary = 'Could not generate summary.';
    }
  }

  private async runReplyToAll(accountId: string, emails: any[], replyText: string, result: TaskResult): Promise<void> {
    if (!replyText.trim()) {
      result.failed  = emails.length;
      result.summary = 'No reply text provided.';
      return;
    }

    const { rows: acctRows } = await getPool().query(
      `SELECT email_address FROM email_accounts WHERE id = $1`, [accountId]
    );
    const fromAddr = acctRows[0]?.email_address ?? '';

    for (const email of emails) {
      try {
        const { rows } = await getPool().query(
          `SELECT from_address, subject FROM email_log WHERE id = $1`, [email.id]
        );
        const row = rows[0];
        if (!row) { result.failed++; continue; }

        const subject = row.subject?.startsWith('Re:') ? row.subject : `Re: ${row.subject ?? ''}`;
        const res = await this.sender.send(accountId, {
          from: fromAddr, to: row.from_address, subject, body: replyText, inReplyTo: email.id,
        });

        if (res.success) {
          await EmailLogRepo.recordAction(email.id, 'sent_as_is');
          result.succeeded++;
          result.details.push(`• ${email.subject} ✅ replied`);
        } else {
          result.failed++;
          result.details.push(`• ${email.subject} ❌ ${res.error}`);
        }
      } catch (err) {
        result.failed++;
        logger.error('Reply task error', { emailId: email.id, err });
      }
    }
    result.summary = `Replied to ${result.succeeded}/${result.processed} emails.`;
  }
}
