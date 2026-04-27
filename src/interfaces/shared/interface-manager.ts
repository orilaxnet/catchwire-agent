/**
 * Interface Manager — manages multiple concurrent user interfaces
 */

import { logger } from '../../utils/logger.ts';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface InterfaceCapabilities {
  supportsRichText:       boolean;
  supportsButtons:        boolean;
  supportsInlineEdit:     boolean;
  supportsFileAttachment: boolean;
  supportsVoiceMessage:   boolean;
  maxMessageLength:       number;
  supportsThreads:        boolean;
}

export interface InterfaceConfig {
  userId:      string;
  credentials: Record<string, any>;
  preferences?: Record<string, any>;
}

export interface Button {
  id:     string;
  label:  string;
  style?: 'primary' | 'secondary' | 'danger';
  action: { type: 'callback' | 'url' | 'input'; data: any };
}

export interface Message {
  text:          string;
  format?:       'plain' | 'markdown' | 'html';
  buttons?:      Button[];
  attachments?:  any[];
  priority?:     'low' | 'normal' | 'high' | 'urgent';
  expiresAt?:    Date;
}

export interface MessageResult {
  success:    boolean;
  messageId?: string;
  error?:     string;
}

export interface UserAction {
  userId:        string;
  interfaceName: string;
  type:          'button_click' | 'text_input' | 'file_upload' | 'voice_message';
  data:          any;
  timestamp:     Date;
}

// ─────────────────────────────────────────────────────────────
// IUserInterface Contract
// ─────────────────────────────────────────────────────────────

export interface IUserInterface {
  readonly name:    string;
  readonly version: string;

  initialize(config: InterfaceConfig): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<boolean>;

  sendMessage(userId: string, message: Message): Promise<MessageResult>;
  onUserAction(callback: (action: UserAction) => void): void;

  getCapabilities(): InterfaceCapabilities;
}

// ─────────────────────────────────────────────────────────────
// Interface Manager
// ─────────────────────────────────────────────────────────────

export class InterfaceManager {
  private interfaces:       Map<string, IUserInterface> = new Map();
  private userPreferences:  Map<string, string[]>       = new Map();
  private actionCallbacks:  Array<(action: UserAction) => void> = [];

  registerInterface(iface: IUserInterface): void {
    this.interfaces.set(iface.name, iface);

    iface.onUserAction((action) => {
      this.actionCallbacks.forEach(cb => cb(action));
    });

    logger.info(`Interface registered: ${iface.name} v${iface.version}`);
  }

  onUserAction(callback: (action: UserAction) => void): void {
    this.actionCallbacks.push(callback);
  }

  setUserInterfaces(userId: string, interfaceNames: string[]): void {
    this.userPreferences.set(userId, interfaceNames);
  }

  getUserInterfaces(userId: string): IUserInterface[] {
    const names = this.userPreferences.get(userId) || ['telegram'];
    return names
      .map(name => this.interfaces.get(name))
      .filter((i): i is IUserInterface => i !== undefined);
  }

  async sendToUser(userId: string, message: Message): Promise<void> {
    const interfaces = this.getUserInterfaces(userId);

    await Promise.allSettled(
      interfaces.map(iface => {
        const adapted = this.adaptMessage(message, iface);
        return iface.sendMessage(userId, adapted);
      })
    );
  }

  private adaptMessage(message: Message, iface: IUserInterface): Message {
    const caps    = iface.getCapabilities();
    const adapted = { ...message };

    if (!caps.supportsRichText && message.format !== 'plain') {
      adapted.text   = this.stripFormatting(message.text);
      adapted.format = 'plain';
    }

    if (!caps.supportsButtons && message.buttons?.length) {
      adapted.buttons = undefined;
      adapted.text   += '\n\nOptions:\n' +
        message.buttons.map((btn, i) => `${i + 1}. ${btn.label}`).join('\n');
    }

    if (adapted.text.length > caps.maxMessageLength) {
      adapted.text = adapted.text.substring(0, caps.maxMessageLength - 3) + '...';
    }

    return adapted;
  }

  private stripFormatting(text: string): string {
    return text
      .replace(/<[^>]*>/g, '')
      .replace(/[*_~`]/g, '');
  }

  async shutdownAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.interfaces.values()).map(i => i.shutdown())
    );
  }

  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [name, iface] of this.interfaces) {
      results[name] = await iface.healthCheck().catch(() => false);
    }
    return results;
  }
}
