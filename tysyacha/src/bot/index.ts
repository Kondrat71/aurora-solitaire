/**
 * Telegram-бот «Тысяча».
 * Токен: TELEGRAM_BOT_TOKEN. Без токена поднимается только веб-демо.
 */

import { Bot, InputFile, type BotConfig, type Context } from 'grammy';
import { createSoloSession, deleteSession, getSession } from './sessions.ts';
import { buildKeyboard, escapeHtml, formatStatus, rulesText, tableSvgFor } from './ui.ts';
import { runBotsUntilHuman } from '../game/ai.ts';
import type { Suit } from '../game/cards.ts';
import { startWebServer } from '../web/server.ts';
import { pathToFileURL } from 'node:url';
import { registerFriends } from './friends.ts';

async function refresh(ctx: {
  chat?: { id: number } | undefined;
  reply: (text: string, other?: object) => Promise<unknown>;
  editMessageText?: (text: string, other?: object) => Promise<unknown>;
  replyWithDocument?: (doc: InputFile, other?: object) => Promise<unknown>;
}, opts: { edit?: boolean; sendSvg?: boolean } = {}): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId == null) return;
  const session = getSession(chatId);
  if (!session) {
    await ctx.reply('Партии нет. Нажмите /start');
    return;
  }

  runBotsUntilHuman(session.game, session.humanIndex);
  const view = session.game.getPrivateView(session.humanIndex);
  const webUrl = process.env.WEB_URL;
  const text = formatStatus(view, webUrl);
  const keyboard = buildKeyboard(view, session.humanIndex);

  if (opts.edit && ctx.editMessageText) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } });
      return;
    } catch {
      /* сообщение могло устареть — отправим новое */
    }
  }

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });

  if (opts.sendSvg) {
    const svg = tableSvgFor(view, session.humanIndex);
    const file = new InputFile(Buffer.from(svg, 'utf8'), 'tysyacha.svg');
    try {
      await ctx.replyWithDocument?.(file, { caption: 'Стол (SVG)' });
    } catch {
      /* документ опционален */
    }
  }
}

export function createBot(token: string, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);
  const pendingMarriage = new Map<number, Suit>();
  registerFriends(bot);

  bot.command('start', async (ctx) => {
    const name = ctx.from?.first_name || 'Игрок';
    createSoloSession(ctx.chat.id, name);
    pendingMarriage.delete(ctx.chat.id);
    await ctx.reply(
      `Добро пожаловать в <b>Тысячу</b>, ${escapeHtml(name)}!\nВы играете против двух ботов. Удачи за сукном.`,
      { parse_mode: 'HTML' },
    );
    await refresh(ctx, { sendSvg: true });
  });

  bot.command('new', async (ctx) => {
    createSoloSession(ctx.chat.id, ctx.from?.first_name || 'Игрок');
    pendingMarriage.delete(ctx.chat.id);
    await refresh(ctx, { sendSvg: true });
  });

  bot.command('table', async (ctx) => {
    await refresh(ctx, { sendSvg: true });
  });

  bot.command('rules', async (ctx) => {
    await ctx.reply(rulesText(), { parse_mode: 'HTML' });
  });

  bot.command('stop', async (ctx) => {
    deleteSession(ctx.chat.id);
    pendingMarriage.delete(ctx.chat.id);
    await ctx.reply('Партия сброшена. /start — начать снова.');
  });

  bot.command('leave', async (ctx) => {
    await ctx.reply('Вы сейчас вне комнаты. /start — открыть меню.');
  });

  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId == null) return;
    const data = ctx.callbackQuery.data;
    let session = getSession(chatId);

    try {
      if (data === 'new') {
        createSoloSession(chatId, ctx.from.first_name || 'Игрок');
        pendingMarriage.delete(chatId);
        await ctx.answerCallbackQuery({ text: 'Новая партия' });
        await refresh(ctx, { edit: true });
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
        runBotsUntilHuman(g, hi);
        await refresh(ctx, { edit: true });
        return;
      }

      if (data.startsWith('bid:')) {
        const v = data.slice(4);
        g.placeBid(hi, v === 'pass' ? 'pass' : Number(v));
        await ctx.answerCallbackQuery();
        runBotsUntilHuman(g, hi);
        await refresh(ctx, { edit: true });
        return;
      }

      if (data.startsWith('order:')) {
        g.setOrder(hi, Number(data.slice(6)));
        await ctx.answerCallbackQuery();
        runBotsUntilHuman(g, hi);
        await refresh(ctx, { edit: true });
        return;
      }

      if (data.startsWith('marry:')) {
        const suit = data.slice(6) as Suit;
        pendingMarriage.set(chatId, suit);
        await ctx.answerCallbackQuery({ text: `Хваль ${suit}: выберите К или Д` });
        await refresh(ctx, { edit: true });
        return;
      }

      if (data.startsWith('card:')) {
        const id = data.slice(5);
        if (g.phase === 'discard') {
          g.discardCard(hi, id);
        } else if (g.phase === 'play') {
          const marry = pendingMarriage.get(chatId);
          const view = g.getPrivateView(hi);
          const card = view.hand.find((c) => c.id === id);
          const declare =
            marry && card && card.suit === marry && (card.rank === 'K' || card.rank === 'Q')
              ? marry
              : null;
          g.playCard(hi, id, declare);
          pendingMarriage.delete(chatId);
        }
        await ctx.answerCallbackQuery();
        runBotsUntilHuman(g, hi);
        await refresh(ctx, { edit: true });
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
