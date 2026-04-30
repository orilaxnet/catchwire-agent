/**
 * Unsubscriber — detects and executes unsubscribe actions from marketing/newsletter emails.
 * Checks List-Unsubscribe header first (RFC 2369), then scans body for unsubscribe links.
 */

import { logger } from '../utils/logger.ts';

export interface UnsubscribeResult {
  success: boolean;
  method:  'http' | 'email' | 'none';
  url?:    string;
  error?:  string;
}

// Extract unsubscribe URL from email body
export function extractUnsubscribeUrl(body: string, listUnsubscribeHeader?: string): string | null {
  // 1. List-Unsubscribe header (most reliable)
  if (listUnsubscribeHeader) {
    const httpMatch = listUnsubscribeHeader.match(/<(https?:\/\/[^>]+)>/i);
    if (httpMatch) return httpMatch[1];
  }

  // 2. Body link with "unsubscribe" in URL or anchor text
  const patterns = [
    /https?:\/\/[^\s"'<>]+unsubscri[^\s"'<>]*/gi,
    /https?:\/\/[^\s"'<>]+optout[^\s"'<>]*/gi,
    /https?:\/\/[^\s"'<>]+opt-out[^\s"'<>]*/gi,
    /https?:\/\/[^\s"'<>]+remove[^\s"'<>]*/gi,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      const url = match[0].replace(/[)\].,;]+$/, ''); // strip trailing punct
      if (url.length < 500) return url;
    }
  }

  // 3. Body text: "unsubscribe here" followed by URL
  const textMatch = body.match(/unsubscrib[^\n]*?(https?:\/\/[^\s"'<>]+)/i);
  if (textMatch) return textMatch[1].replace(/[)\].,;]+$/, '');

  return null;
}

export async function executeUnsubscribe(url: string): Promise<UnsubscribeResult> {
  try {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15_000);

    // Try GET first (most common for unsubscribe links)
    const res = await fetch(url, {
      method:  'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EmailAgent/1.0)',
        'Accept':     'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
      signal:   ctrl.signal,
    });
    clearTimeout(timeout);

    if (res.ok || res.status === 302 || res.status === 301) {
      logger.info('Unsubscribe HTTP success', { url, status: res.status });
      return { success: true, method: 'http', url };
    }

    // Try POST if GET failed (some unsubscribe endpoints need POST)
    const res2 = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      body:    'unsubscribe=1&confirm=yes',
      signal:  AbortSignal.timeout(10_000),
    });

    if (res2.ok) {
      logger.info('Unsubscribe POST success', { url });
      return { success: true, method: 'http', url };
    }

    return { success: false, method: 'http', url, error: `HTTP ${res.status}` };
  } catch (err: any) {
    logger.warn('Unsubscribe HTTP failed', { url, err: err.message });
    return { success: false, method: 'http', url, error: err.message };
  }
}
