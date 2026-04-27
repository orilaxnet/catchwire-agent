import type { IPlugin } from '../plugin-manager.ts';
import type { ParsedEmail, AgentResponse } from '../../types/index.ts';
import { logger } from '../../utils/logger.ts';

export interface NotionPluginConfig {
  apiKey:      string;
  databaseId:  string;
  priorities:  string[];
}

export class NotionPlugin implements IPlugin {
  name    = 'notion';
  version = '1.0.0';
  enabled = true;

  constructor(private config: NotionPluginConfig) {}

  async afterEmailProcess(email: ParsedEmail, response: AgentResponse): Promise<AgentResponse> {
    if (!this.config.priorities.includes(response.priority)) return response;

    const body = {
      parent: { database_id: this.config.databaseId },
      properties: {
        Name:     { title:  [{ text: { content: email.subject } }] },
        From:     { rich_text: [{ text: { content: email.originalSender } }] },
        Priority: { select: { name: response.priority } },
        Intent:   { select: { name: response.intent } },
        Summary:  { rich_text: [{ text: { content: response.summary } }] },
        Date:     { date: { start: new Date().toISOString() } },
      },
    };

    try {
      const resp = await fetch('https://api.notion.com/v1/pages', {
        method:  'POST',
        headers: {
          'Authorization':  `Bearer ${this.config.apiKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type':   'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        logger.warn('Notion API error', { status: resp.status });
      }
    } catch (err) {
      logger.error('Notion plugin failed', { err });
    }

    return response;
  }
}
