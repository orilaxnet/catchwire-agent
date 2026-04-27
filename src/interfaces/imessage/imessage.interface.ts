import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.ts';
import type { IUserInterface, InterfaceConfig, InterfaceCapabilities, Message, MessageResult, UserAction } from '../shared/interface-manager.ts';

const execFileAsync = promisify(execFile);

/**
 * iMessage interface via AppleScript (macOS only).
 * Outbound: sends iMessages using osascript.
 * Inbound: requires an external polling mechanism (e.g., Messages.app automation or a webhook bridge).
 */
export class IMessageInterface implements IUserInterface {
  readonly name:    string = 'imessage';
  readonly version: string = '1.0.0';

  private callbacks: Array<(a: UserAction) => void> = [];

  constructor(private phoneNumberMap: Record<string, string> = {}) {}

  async initialize(_config: InterfaceConfig): Promise<void> {}

  async shutdown(): Promise<void> {}

  async healthCheck(): Promise<boolean> {
    return process.platform === 'darwin';
  }

  getCapabilities(): InterfaceCapabilities {
    return {
      supportsRichText:       false,
      supportsButtons:        false,
      supportsInlineEdit:     false,
      supportsFileAttachment: false,
      supportsVoiceMessage:   false,
      maxMessageLength:       160,
      supportsThreads:        false,
    };
  }

  onUserAction(callback: (a: UserAction) => void): void {
    this.callbacks.push(callback);
  }

  async sendMessage(userId: string, message: Message): Promise<MessageResult> {
    const phone = this.phoneNumberMap[userId];
    if (!phone) {
      logger.warn('iMessage: no phone number for user', { userId });
      return { success: false, error: 'No phone number configured for user' };
    }

    const text = this.renderPlain(message);
    // Build safe AppleScript by passing the message as a separate argument via
    // environment variable — avoids any injection through the message content.
    const safeSend = `
      tell application "Messages"
        set targetService to 1st service whose service type = iMessage
        set targetBuddy   to buddy (system attribute "IM_PHONE") of targetService
        send (system attribute "IM_TEXT") to targetBuddy
      end tell
    `;

    try {
      await execFileAsync('osascript', ['-e', safeSend], {
        env: { ...process.env, IM_PHONE: phone, IM_TEXT: text },
      });
      return { success: true };
    } catch (err) {
      logger.error('iMessage send failed', { userId, err });
      return { success: false, error: (err as Error).message };
    }
  }

  private renderPlain(message: Message): string {
    const parts: string[] = [];
    if (message.text) parts.push(message.text);
    if (message.buttons?.length) {
      parts.push('');
      message.buttons.forEach((b, i) => parts.push(`${i + 1}. ${b.label}`));
    }
    return parts.join('\n');
  }
}
