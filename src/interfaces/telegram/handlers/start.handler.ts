import type { Context } from 'telegraf';
import { UserRepo } from '../../../storage/sqlite.adapter.ts';

export class StartHandler {
  async handleStart(ctx: Context): Promise<void> {
    const telegramId = ctx.from!.id.toString();
    const name       = ctx.from?.first_name ?? 'there';

    let user = await UserRepo.findByTelegramId(telegramId);
    if (!user) {
      user = await UserRepo.create(telegramId, name);
    }

    await ctx.reply(
      `Hi ${name}! 👋\n\nWelcome to Email Agent.\n\nTo get started, connect an email account:`,
      {
        parse_mode:   'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Email Account', callback_data: JSON.stringify({ action: 'start_add_account' }) }],
            [{ text: '⚙️ Settings',          callback_data: JSON.stringify({ action: 'settings'          }) }],
            [{ text: '❓ Help',               callback_data: JSON.stringify({ action: 'help'              }) }],
          ],
        },
      },
    );
  }

  async handleHelp(ctx: Context): Promise<void> {
    await ctx.reply(
      `📖 *Email Agent Help*\n\n` +
      `/addaccount — connect an email account\n` +
      `/setllm — choose your AI model\n` +
      `/setstyle — teach the agent your writing style\n` +
      `/plugin — build or manage plugins\n` +
      `/settings — full settings\n` +
      `/analytics — weekly stats\n` +
      `/deleteall — delete all your data\n\n` +
      `To process emails, forward them to your agent address.`,
      { parse_mode: 'Markdown' },
    );
  }
}
