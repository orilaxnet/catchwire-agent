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
}

export interface TaskResult {
  action:    TaskAction;
  processed: number;
  succeeded: number;
  failed:    number;
  details:   string[];            // per-email result lines
  summary:   string;
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

    const prompt = `You are an email agent assistant. Parse the following user command into a structured task.

User command: "${command}"

Return JSON:
{
  "action": one of ["search", "unsubscribe_all", "forward_all", "ignore_all", "summarize", "reply_to_all"],
  "query": "NL description of which emails to match, e.g. 'newsletters from the past month'",
  "params": {
    "forwardTo": "email address if forwarding, else null",
    "replyText": "reply text if replying, else null"
  },
  "explanation": "one sentence plain-English plan, e.g. 'I'll find all newsletters and unsubscribe from each one.'"
}

Action meanings:
- search: just find and show matching emails
- unsubscribe_all: find emails and HTTP-unsubscribe from each
- forward_all: find emails and forward to an address
- ignore_all: mark matching emails as ignored
- summarize: find emails and produce a combined summary
- reply_to_all: find emails and send a reply to each

Only return the JSON object.`;

    const raw = await llm.complete(prompt, { maxTokens: 300, temperature: 0.1 });
    const m   = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse command');

    const parsed = JSON.parse(m[0]) as ParsedTask;
    return parsed;
  }

  /** Execute a parsed task and return a result summary. */
  async execute(accountId: string, task: ParsedTask, limit = 30): Promise<TaskResult> {
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
        await this.runSummarize(emails, result);
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
    if (!forwardTo || !forwardTo.includes('@')) {
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

  private async runSummarize(emails: any[], result: TaskResult): Promise<void> {
    const { LLMRouter } = await import('../llm/router.ts');
    const llm = new LLMRouter(this.llmConfig);

    const emailList = emails.map((e, i) =>
      `${i + 1}. From: ${e.sender_name || e.from_address} | Subject: ${e.subject} | Summary: ${e.summary ?? 'N/A'}`
    ).join('\n');

    const prompt = `Summarize these ${emails.length} emails in a concise digest (3-8 sentences). Highlight key themes, important senders, and action items.\n\n${emailList}`;

    try {
      const summary = await llm.complete(prompt, { maxTokens: 400, temperature: 0.3 });
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
