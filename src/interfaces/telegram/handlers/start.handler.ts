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
      `👋 Hi ${name}! Welcome to *Catchwire Agent*.\n\n` +
      `I process your emails and draft smart replies using AI.\n\n` +
      `*Quick start:*\n` +
      `/webapp — open the web inbox instantly (no password)\n` +
      `/addaccount — connect your first email account\n` +
      `/settings — configure AI, tone & autonomy\n\n` +
      `Type / to see all commands.`,
      { parse_mode: 'Markdown' },
    );
  }

  async handleHelp(ctx: Context): Promise<void> {
    await ctx.reply(
      `📖 *Catchwire Agent — Help*\n\n` +
      `/webapp — open web inbox with one tap (magic link)\n` +
      `/addaccount — connect an email account\n` +
      `/setllm — choose your AI model\n` +
      `/setmodel <name> — set model name\n` +
      `/setstyle — teach the agent your writing style\n` +
      `/settings — autonomy, tone, LLM config\n` +
      `/analytics — 7-day stats\n` +
      `/deleteall — delete all your data\n\n` +
      `💡 Tip: use /webapp to open the full dashboard without a password.`,
      { parse_mode: 'Markdown' },
    );
  }
}
