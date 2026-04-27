import type { IPlugin } from '../plugin-manager.ts';
import type { ParsedEmail, AgentResponse } from '../../types/index.ts';
import { logger } from '../../utils/logger.ts';

export interface SlackNotifyConfig {
  webhookUrl:       string;
  notifyPriorities: string[];  // e.g. ['critical', 'high']
}

export class SlackNotifyPlugin implements IPlugin {
  name    = 'slack-notify';
  version = '1.0.0';
  enabled = true;

  constructor(private config: SlackNotifyConfig) {}

  async afterEmailProcess(email: ParsedEmail, response: AgentResponse): Promise<AgentResponse> {
    if (!this.config.notifyPriorities.includes(response.priority)) return response;

    const payload = {
      text: `*[${response.priority.toUpperCase()}]* ${email.subject}`,
      attachments: [{
        color:  response.priority === 'critical' ? 'danger' : 'warning',
        fields: [
          { title: 'From',    value: email.originalSender,     short: true },
          { title: 'Intent',  value: response.intent, short: true },
          { title: 'Summary', value: response.summary },
        ],
      }],
    };

    try {
      await fetch(this.config.webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    } catch (err) {
      logger.error('Slack notify failed', { err });
    }

    return response;
  }
}
