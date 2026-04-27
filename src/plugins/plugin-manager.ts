import { logger } from '../utils/logger.ts';
import type { ParsedEmail, AgentResponse } from '../types/index.ts';

export interface IPlugin {
  name:    string;
  version: string;
  enabled: boolean;

  beforeEmailProcess?(email: ParsedEmail): Promise<ParsedEmail>;
  afterEmailProcess?(email: ParsedEmail, response: AgentResponse): Promise<AgentResponse>;
  beforeSendReply?(email: ParsedEmail, draft: string): Promise<string>;
  afterSendReply?(email: ParsedEmail, sent: string): Promise<void>;
  onFeedback?(emailId: string, action: string): Promise<void>;
}

export class PluginManager {
  private plugins: IPlugin[] = [];

  register(plugin: IPlugin): void {
    if (this.plugins.find((p) => p.name === plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    this.plugins.push(plugin);
    logger.info('Plugin registered', { name: plugin.name, version: plugin.version });
  }

  unregister(name: string): void {
    this.plugins = this.plugins.filter((p) => p.name !== name);
  }

  list(): IPlugin[] {
    return [...this.plugins];
  }

  async runBeforeEmailProcess(email: ParsedEmail): Promise<ParsedEmail> {
    let current = email;
    for (const plugin of this.active()) {
      if (plugin.beforeEmailProcess) {
        try {
          current = await plugin.beforeEmailProcess(current);
        } catch (err) {
          logger.error('Plugin hook error', { plugin: plugin.name, hook: 'beforeEmailProcess', err });
        }
      }
    }
    return current;
  }

  async runAfterEmailProcess(email: ParsedEmail, response: AgentResponse): Promise<AgentResponse> {
    let current = response;
    for (const plugin of this.active()) {
      if (plugin.afterEmailProcess) {
        try {
          current = await plugin.afterEmailProcess(email, current);
        } catch (err) {
          logger.error('Plugin hook error', { plugin: plugin.name, hook: 'afterEmailProcess', err });
        }
      }
    }
    return current;
  }

  async runBeforeSendReply(email: ParsedEmail, draft: string): Promise<string> {
    let current = draft;
    for (const plugin of this.active()) {
      if (plugin.beforeSendReply) {
        try {
          current = await plugin.beforeSendReply(email, current);
        } catch (err) {
          logger.error('Plugin hook error', { plugin: plugin.name, hook: 'beforeSendReply', err });
        }
      }
    }
    return current;
  }

  async runAfterSendReply(email: ParsedEmail, sent: string): Promise<void> {
    await Promise.allSettled(
      this.active()
        .filter((p) => p.afterSendReply)
        .map((p) => p.afterSendReply!(email, sent)),
    );
  }

  async runOnFeedback(emailId: string, action: string): Promise<void> {
    await Promise.allSettled(
      this.active()
        .filter((p) => p.onFeedback)
        .map((p) => p.onFeedback!(emailId, action)),
    );
  }

  private active(): IPlugin[] {
    return this.plugins.filter((p) => p.enabled);
  }
}
