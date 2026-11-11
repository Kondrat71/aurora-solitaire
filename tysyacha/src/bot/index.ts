/**
 * Telegram-бот «Тысяча».
 * Токен: TELEGRAM_BOT_TOKEN. Без токена поднимается только веб-демо.
 */

import { Bot, type BotConfig, type Context } from 'grammy';
import { createSoloSession, deleteSession, getSession } from './sessions.ts';
import { buildKeyboard, escapeHtml, formatStatus, rulesText } from './ui.ts';
import { runBotsUntilHuman } from '../game/ai.ts';
import { startWebServer } from '../web/server.ts';
import { pathToFileURL } from 'node:url';
import { registerFriends } from './friends.ts';
import { publishPhotoTable } from './table.ts';

async function refresh(ctx: Context, edit = false): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId == null) return;
  const session = getSession(chatId);
  if (!session) {
    await ctx.reply('Партии нет. Нажмите /start');
    return;
  }

  runBotsUntilHuman(session.game, session.humanIndex);
  const view = session.game.getPrivateView(session.humanIndex);
  const text = formatStatus(view, process.env.WEB_URL);
  const keyboard = buildKeyboard(view, session.humanIndex);

  if (!edit && session.messageId !== undefined) {
    await ctx.api.editMessageReplyMarkup(chatId, session.messageId).catch(() => undefined);
  }
  const messageId = edit ? session.messageId ?? ctx.callbackQuery?.message?.message_id : undefined;
  session.messageId = await publishPhotoTable(ctx.api, chatId, messageId, view, session.humanIndex, text, keyboard);
}

export function createBot(token: string, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);
  registerFriends(bot);

  bot.command('start', async (ctx) => {
    const name = ctx.from?.first_name || 'Игрок';
    createSoloSession(ctx.chat.id, name);
    await ctx.reply(
      `Добро пожаловать в <b>Тысячу</b>, ${escapeHtml(name)}!\nВы играете против двух ботов. Удачи за сукном.`,
      { parse_mode: 'HTML' },
    );
    await refresh(ctx);
  });

  bot.command('new', async (ctx) => {
    createSoloSession(ctx.chat.id, ctx.from?.first_name || 'Игрок');
    await refresh(ctx);
  });

  bot.command('table', async (ctx) => {
    await refresh(ctx);
  });

  bot.command('rules', async (ctx) => {
    await ctx.reply(rulesText(), { parse_mode: 'HTML' });
  });

  bot.command('stop', async (ctx) => {
    deleteSession(ctx.chat.id);
    await ctx.reply('Партия сброшена. /start — начать снова.');
  });

  bot.command('leave', async (ctx) => {
    await ctx.reply('Вы сейчас вне комнаты. /start — открыть меню.');
  });

  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId == null) return;
    const data = ctx.callbackQuery.data;
    const session = getSession(chatId);

    try {
      if (data === 'new') {
        createSoloSession(chatId, ctx.from.first_name || 'Игрок');
        await ctx.answerCallbackQuery({ text: 'Новая партия' });
        await refresh(ctx, true);
        return;
      }
      if (data === 'rules') {
        await ctx.answerCallbackQuery();
        await ctx.reply(rulesText(), { parse_mode: 'HTML' });
        return;
      }
      if (!session) {
        await ctx.answerCallbackQuery({ text: 'Сначала /start' });
        return;
      }

      const g = session.game;
      const hi = session.humanIndex;

      if (data === 'next') {
        g.nextDeal();
        await ctx.answerCallbackQuery({ text: 'Новая сдача' });
        await refresh(ctx, true);
        return;
      }

      if (data.startsWith('bid:')) {
        const v = data.slice(4);
        g.placeBid(hi, v === 'pass' ? 'pass' : Number(v));
        await ctx.answerCallbackQuery();
        await refresh(ctx, true);
        return;
      }

      if (data.startsWith('order:')) {
        g.setOrder(hi, Number(data.slice(6)));
        await ctx.answerCallbackQuery();
        await refresh(ctx, true);
        return;
      }

      if (data.startsWith('card:')) {
        const id = data.slice(5);
        if (g.phase === 'discard') {
          g.discardCard(hi, id);
        } else if (g.phase === 'play') {
          g.playCard(hi, id);
        }
        await ctx.answerCallbackQuery();
        await refresh(ctx, true);
        return;
      }

      await ctx.answerCallbackQuery();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.answerCallbackQuery({ text: msg.slice(0, 180), show_alert: true });
    }
  });

  bot.catch((err) => {
    console.error('[tysyacha] ошибка обработки сообщения:', err.error instanceof Error ? err.error.name : 'ошибка');
  });
  return bot;
}

export async function startBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const port = Number(process.env.PORT || 8787);
  const web = await startWebServer(port);
  console.log(`[tysyacha] веб-стол: ${web.url}`);

  if (!token) {
    console.log('[tysyacha] TELEGRAM_BOT_TOKEN не задан — работает только веб-демо.');
    return;
  }
  const bot = createBot(token);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      web.server.close();
      void bot.stop().catch(() => undefined);
    });
  }
  try {
    await bot.start({
      onStart: (info) => console.log(`[tysyacha] @${info.username} запущен (long polling)`),
    });
  } finally {
    web.server.close();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startBot().catch((e) => {
    console.error('[tysyacha] не удалось запустить бот:', e instanceof Error ? e.name : 'ошибка');
    process.exit(1);
  });
}
