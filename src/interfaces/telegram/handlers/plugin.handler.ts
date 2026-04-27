import type { Context } from 'telegraf';
import type { PluginBuilderService } from '../../../plugins/builder/plugin-builder.service.ts';

const STARTER_GALLERY = [
  { label: '🎟 Jira Ticket',     value: 'jira',     desc: 'critical email → Jira ticket' },
  { label: '💬 Slack Summary',   value: 'slack',    desc: 'daily digest to Slack' },
  { label: '📅 Calendar Event',  value: 'calendar', desc: 'email date → Google Calendar' },
  { label: '📱 SMS Alert',       value: 'sms',      desc: 'urgent email → SMS' },
  { label: '✍️ Custom...',       value: 'custom',   desc: 'describe it, AI builds it' },
];

export class PluginHandler {
  private pendingDescriptions = new Map<string, boolean>();

  constructor(private builderService: PluginBuilderService) {}

  async handlePluginCommand(ctx: Context): Promise<void> {
    const keyboard = STARTER_GALLERY.map((item) => ([{
      text:          `${item.label} — ${item.desc}`,
      callback_data: `plugin_gallery_${item.value}`,
    }]));

    await ctx.reply(
      '🔧 *AI Plugin Builder*\n\nWhat plugin would you like to build?\n' +
      'Pick a starter from the gallery, or choose Custom and describe what you need.',
      {
        parse_mode:   'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      },
    );
  }

  async handleGalleryCallback(ctx: Context, item: string): Promise<void> {
    const DESCRIPTIONS: Record<string, string> = {
      jira:     'When a critical or high-priority email arrives, create a Jira ticket in project SUPPORT using JIRA_URL and JIRA_TOKEN.',
      slack:    'After every high or critical email, send a summary to the Slack webhook at SLACK_WEBHOOK_URL.',
      calendar: 'When an email contains a meeting date, create a Google Calendar event using GOOGLE_CALENDAR_TOKEN.',
      sms:      'When an email from boss@mycompany.com has "urgent" in the subject, send an SMS via Twilio.',
    };

    if (item === 'custom') {
      this.pendingDescriptions.set(ctx.from!.id.toString(), true);
      await ctx.reply(
        '✍️ Describe what the plugin should do:\n\n' +
        '_Example: When an email from hr@company.com arrives with "vacation" in the subject, create a Google Calendar event._',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const description = DESCRIPTIONS[item];
    if (!description) return;

    await this.buildWithDescription(ctx, description);
  }

  async handleTextIfPending(ctx: Context): Promise<boolean> {
    const userId = ctx.from!.id.toString();
    if (!this.pendingDescriptions.has(userId)) return false;

    this.pendingDescriptions.delete(userId);
    const text = (ctx.message as any)?.text ?? '';
    if (!text) return false;

    await this.buildWithDescription(ctx, text);
    return true;
  }

  async handleEnablePlugin(ctx: Context, name: string): Promise<void> {
    await ctx.answerCbQuery();
    try {
      await this.builderService.enablePlugin(name);
      await ctx.reply(`✅ Plugin *${name}* enabled!`, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  }

  async handleListPlugins(ctx: Context): Promise<void> {
    const list = this.builderService.listPlugins();
    if (!list.length) {
      await ctx.reply('No plugins yet. Type /plugin to build one.');
      return;
    }

    const lines = list.map((p) =>
      `${p.enabled ? '✅' : '⏸'} *${p.name}*\n   ${p.description}`
    );

    await ctx.reply(
      `🔌 *Your plugins:*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' },
    );
  }

  private async buildWithDescription(ctx: Context, description: string): Promise<void> {
    await ctx.reply('🔄 Analyzing and building plugin...\n_This takes 15–30 seconds_', {
      parse_mode: 'Markdown',
    });

    try {
      const result = await this.builderService.buildPlugin({
        userDescription: description,
        accountId:       ctx.from!.id.toString(),
        authorEmail:     undefined,
      });

      await ctx.reply(
        `📋 *Plugin ready:*\n\n` +
        `*Name:* \`${result.spec.name}\`\n` +
        `*Description:* ${result.spec.description}\n` +
        `*Hooks:* ${result.spec.hooks.join(', ')}\n` +
        `*Permissions:* network: [${result.spec.permissions.network.join(', ')}]\n\n` +
        `*Security analysis:*\n\`\`\`\n${result.analysisReport}\n\`\`\`\n\n` +
        `*Sandbox test:*\n` +
        `${result.sandboxResult.success ? '✅ passed' : '❌ failed'} — ${result.sandboxResult.durationMs}ms\n` +
        (result.sandboxResult.error ? `Error: ${result.sandboxResult.error}\n` : '') +
        `\`\`\`\n${result.sandboxResult.output.slice(0, 500)}\n\`\`\``,
        {
          parse_mode:   'Markdown',
          reply_markup: result.ready ? {
            inline_keyboard: [[
              { text: '✅ Enable',      callback_data: `plugin_enable_${result.spec.name}` },
              { text: '👀 View Code',   callback_data: `plugin_code_${result.spec.name}`   },
              { text: '❌ Delete',      callback_data: `plugin_delete_${result.spec.name}`  },
            ]],
          } : {
            inline_keyboard: [[
              { text: '🔁 Retry',  callback_data: 'plugin_retry'  },
              { text: '❌ Cancel', callback_data: 'plugin_cancel' },
            ]],
          },
        },
      );
    } catch (err: any) {
      await ctx.reply(`❌ Plugin build failed: ${err.message}`);
    }
  }
}
