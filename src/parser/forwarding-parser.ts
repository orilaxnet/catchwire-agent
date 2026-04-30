/**
 * Forwarding Parser — converts a forwarded email into a ParsedEmail
 * Uses Regex for standard formats, LLM as fallback for non-standard formats
 */

import type { RawEmail, ParsedEmail, Attachment } from '../types/index.ts';
import { logger } from '../utils/logger.ts';

function decodeMime(s: string): string {
  return s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, _cs, enc, text) => {
    try {
      if (enc.toUpperCase() === 'Q')
        return decodeURIComponent(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, '%$1'));
      return Buffer.from(text, 'base64').toString('utf8');
    } catch { return text; }
  });
}

// ─────────────────────────────────────────────────────────────
// Regex patterns for identifying forward headers
// ─────────────────────────────────────────────────────────────

const PATTERNS = {
  gmail: {
    header: /---------- Forwarded message ----------\s*From:\s*(.+?)\s*<([^>]+)>\s*Date:\s*(.+?)\s*Subject:\s*(.+?)\s*To:/is,
    sender:  /From:\s*(.+?)\s*<([^>]+)>/i,
    date:    /Date:\s*(.+)/i,
    subject: /Subject:\s*(.+)/i
  },

  outlook: {
    header: /From:\s*(.+)\s*Sent:\s*(.+)\s*To:\s*(.+)\s*Subject:\s*(.+)/i,
    sender:  /From:\s*([^\n]+)/i,
    date:    /Sent:\s*([^\n]+)/i,
    subject: /Subject:\s*([^\n]+)/i
  },

  appleMail: {
    header: /Begin forwarded message:\s*From:\s*"?(.+?)"?\s*<([^>]+)>\s*Date:\s*(.+?)\s*Subject:\s*(.+)/is,
    sender:  /From:\s*"?([^"<\n]+)"?\s*<?([^>\n]*)>?/i,
    date:    /Date:\s*(.+)/i,
    subject: /Subject:\s*(.+)/i
  },

  yahoo: {
    header: /--- Forwarded Message ---\s*From:\s*(.+?)\s*To:/is,
    sender:  /From:\s*(.+)/i,
    date:    /On (.+) wrote:/i,
    subject: /Subject:\s*(.+)/i
  },

  generic: {
    replyMarker: /On .+?(?:wrote|wrote:)/i,
    separator: /^[-─━═]{3,}$/m
  }
};

// ─────────────────────────────────────────────────────────────

export class ForwardingParser {
  constructor(private llm?: { complete(prompt: string): Promise<string> }) {}

  async parse(raw: RawEmail): Promise<ParsedEmail> {
    const rawText = raw.raw;

    // Method 1: Regex (fast, free)
    const regexResult = this.tryRegexParse(rawText);
    if (regexResult) {
      logger.debug('Email parsed with regex', { method: 'regex', confidence: regexResult.parseConfidence });
      return this.buildParsedEmail(raw, regexResult);
    }

    // Method 2: LLM fallback
    if (this.llm) {
      logger.debug('Regex failed, falling back to LLM parsing');
      const llmResult = await this.tryLLMParse(rawText);
      if (llmResult) {
        return this.buildParsedEmail(raw, llmResult);
      }
    }

    // Method 3: Best-effort from headers
    return this.parseFromHeaders(raw);
  }

  // ─── Regex Parser ───────────────────────────────────────────

  private tryRegexParse(text: string): Partial<ParsedEmail> | null {
    for (const [client, patterns] of Object.entries(PATTERNS)) {
      if (client === 'generic') continue;

      const p = patterns as typeof PATTERNS.gmail;

      const senderMatch  = text.match(p.sender);
      const subjectMatch = text.match(p.subject);
      const dateMatch    = text.match(p.date);

      if (!senderMatch || !subjectMatch) continue;

      const senderName  = senderMatch[1]?.trim().replace(/"/g, '') ?? '';
      const senderEmail = senderMatch[2]?.trim() ?? senderMatch[1]?.trim() ?? '';
      const subject     = decodeMime(subjectMatch[1]?.trim() ?? '');

      let date: Date;
      try {
        date = dateMatch ? new Date(dateMatch[1].trim()) : new Date();
        if (isNaN(date.getTime())) date = new Date();
      } catch {
        date = new Date();
      }

      const body = this.extractBody(text);

      return {
        originalSender:     senderEmail,
        originalSenderName: senderName,
        originalDate:       date,
        subject,
        bodyText:           body,
        isForwarded:        true,
        parseMethod:        'regex',
        parseConfidence:    0.85
      };
    }

    return null;
  }

  // ─── LLM Parser ─────────────────────────────────────────────

  private async tryLLMParse(text: string): Promise<Partial<ParsedEmail> | null> {
    if (!this.llm) return null;

    const prompt = `
The text below is a forwarded email. Extract the following information:

Email text:
${text.substring(0, 3000)}

Return JSON with these fields:
{
  "originalSender": "original sender email address",
  "originalSenderName": "original sender name",
  "originalDate": "send date in ISO format",
  "subject": "email subject",
  "bodyText": "email body text (without forward headers)"
}

If a field cannot be found, set it to null.
`;

    try {
      const raw = await this.llm.complete(prompt);
      const data = JSON.parse(raw);

      if (!data || !data.originalSender) return null;

      return {
        originalSender:     data.originalSender,
        originalSenderName: data.originalSenderName || '',
        originalDate:       new Date(data.originalDate || Date.now()),
        subject:            data.subject || '(no subject)',
        bodyText:           data.bodyText || '',
        isForwarded:        true,
        parseMethod:        'llm',
        parseConfidence:    0.75
      };
    } catch {
      return null;
    }
  }

  // ─── Header Parser (final fallback) ─────────────────────────

  private parseFromHeaders(raw: RawEmail): ParsedEmail {
    const from    = raw.headers['from']    || raw.headers['From']    || '';
    const subject = raw.headers['subject'] || raw.headers['Subject'] || '(no subject)';
    const date    = raw.headers['date']    || raw.headers['Date']    || '';

    const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
    const nameMatch  = from.match(/^"?([^"<]+)"?\s*</);

    return {
      id:                 raw.id,
      accountId:          raw.accountId,
      originalSender:     emailMatch?.[1]?.trim() ?? from,
      originalSenderName: nameMatch?.[1]?.trim() ?? '',
      recipientEmail:     '',
      originalDate:       date ? new Date(date) : new Date(raw.receivedAt),
      subject:            decodeMime(subject.trim()),
      bodyText:           this.extractBody(raw.raw),
      bodyHtml:           undefined,
      quotedHistory:      [],
      attachments:        [] as Attachment[],
      isForwarded:        false,
      parseMethod:        'regex',
      parseConfidence:    0.3
    };
  }

  // ─── Helpers ────────────────────────────────────────────────

  private extractBody(text: string): string {
    const lines = text.split('\n');
    const bodyLines: string[] = [];
    let inHeader = true;
    let headerEndFound = false;

    for (const line of lines) {
      // Detect end of forwarding header
      if (inHeader && line.trim() === '' && headerEndFound) {
        inHeader = false;
        continue;
      }

      if (inHeader) {
        if (/^(From|Date|Subject|To|Cc|Bcc):/i.test(line)) {
          headerEndFound = true;
        }
        continue;
      }

      // Skip quoted lines (starting with >)
      if (line.startsWith('>')) continue;

      // Skip common separator lines
      if (/^[-─━═]{5,}$/.test(line.trim())) continue;

      bodyLines.push(line);
    }

    return bodyLines.join('\n').trim();
  }

  private buildParsedEmail(raw: RawEmail, partial: Partial<ParsedEmail>): ParsedEmail {
    return {
      id:                 raw.id,
      accountId:          raw.accountId,
      originalSender:     partial.originalSender ?? '',
      originalSenderName: partial.originalSenderName ?? '',
      recipientEmail:     raw.headers['to'] || raw.headers['To'] || '',
      originalDate:       partial.originalDate ?? new Date(raw.receivedAt),
      subject:            decodeMime(partial.subject ?? '(no subject)'),
      bodyText:           partial.bodyText ?? '',
      bodyHtml:           partial.bodyHtml,
      quotedHistory:      partial.quotedHistory ?? [],
      attachments:        partial.attachments ?? [],
      isForwarded:        partial.isForwarded ?? true,
      parseMethod:        partial.parseMethod ?? 'regex',
      parseConfidence:    partial.parseConfidence ?? 0.5
    };
  }
}
