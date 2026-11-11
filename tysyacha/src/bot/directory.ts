import { randomBytes } from 'node:crypto';
import { Bot, GrammyError, InlineKeyboard, type Context } from 'grammy';
import { type Member, type Room, type Rooms } from './rooms.ts';
import { activeSoloSessions } from './sessions.ts';
import { tableName } from './ui.ts';

const PAGE_SIZE = 6;
const OFFER_TTL = 10 * 60_000;

interface Offer {
  kind: 'join' | 'invite';
  room?: Room;
  from: Member;
  to: Member;
  expiresAt: number;
}

interface Listing {
  text: string;
  button?: { label: string; action: string };
}

function playerFrom(ctx: Context): Member {
  return { id: ctx.from!.id, name: ctx.from!.first_name };
}

export function registerDirectory(bot: Bot, rooms: Rooms, publish: (room: Room) => Promise<void>): void {
  const offers = new Map<string, Offer>();
  const visibleSolo = () => activeSoloSessions().filter((session) => !rooms.forMember(session.chatId));
  const canInvite = (room: Room, id: number) => rooms.acceptsMember(room) &&
    (room.game ? room.members[0].id === id : room.members.some((member) => member.id === id));

  function directory(id: number, page: number): { text: string; keyboard: InlineKeyboard } {
    const own = rooms.forMember(id);
    const entries: Listing[] = rooms.list().map((room) => {
      const { number, size, members, waitingFourth, game } = room;
      const state = game?.phase === 'gameover' ? 'Партия окончена' : game ? 'В игре' : 'Набор игроков';
      const seats = game ? waitingFourth ? '3 + 1 со следующей сдачи' : String(size) : `${members.length}/${size}`;
      const roster = [...members, ...(waitingFourth ? [waitingFourth] : [])].map(({ name }) => tableName(name)).join(', ');
      const listing: Listing = { text: `<b>Стол №${number}</b> · ${state} · ${seats}\n${roster}${own === room ? ' · ваш стол' : ''}` };
      if (!own && rooms.acceptsMember(room)) {
        listing.button = { label: game ? `№${number} · Попроситься четвёртым` : `№${number} · Попроситься`, action: `tables:join:${number}` };
      }
      return listing;
    });
    for (const session of visibleSolo()) {
      const name = session.game.players[session.humanIndex].name;
      const listing: Listing = { text: `<b>${tableName(name)}</b> · Играет с ботами${session.chatId === id ? ' · вы' : ''}` };
      if (session.chatId !== id && (!own || canInvite(own, id))) {
        listing.button = { label: `Позвать ${Array.from(name).slice(0, 24).join('')}`, action: `tables:invite:${session.directoryId}` };
      }
      entries.push(listing);
    }
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const current = Math.min(page, pages - 1);
    const pageEntries = entries.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
    const keyboard = new InlineKeyboard();
    for (const item of pageEntries) {
      if (item.button) keyboard.text(item.button.label, item.button.action).row();
    }
    if (current > 0) keyboard.text('◀', `tables:page:${current - 1}`);
    keyboard.text('↻ Обновить', `tables:page:${current}`);
    if (current + 1 < pages) keyboard.text('▶', `tables:page:${current + 1}`);
    keyboard.row().text('Закрыть список', 'tables:close');
    const heading = `<b>Столы${pages > 1 ? ` · ${current + 1}/${pages}` : ''}</b>`;
    const text = [heading, ...pageEntries.map((item) => item.text)].join('\n\n');
    return { text: pageEntries.length ? text : `${heading}\n\nСейчас за столами никого. Создайте свой через /start.`, keyboard };
  }

  function offerText(offer: Offer): string {
    const name = tableName(offer.from.name);
    if (offer.kind === 'invite') {
      const destination = offer.room ? `за стол №${offer.room.number}` : 'за новый стол на троих';
      const wait = offer.room?.game ? '\nМесто откроется со следующей сдачи.' : '';
      return `✉️ <b>${name}</b> приглашает вас ${destination}.${wait}`;
    }
    const seat = offer.room?.game ? ' просится четвёртым со следующей сдачи' : ' просится за стол';
    return `✉️ <b>${name}</b>${seat} №${offer.room!.number}.`;
  }

  async function sendOffer(offer: Offer): Promise<void> {
    const now = Date.now();
    for (const [key, item] of offers) if (item.expiresAt <= now) offers.delete(key);
    const duplicate = [...offers.values()].some((item) => item.from.id === offer.from.id && item.to.id === offer.to.id && item.kind === offer.kind);
    if (duplicate) throw new Error('Уже отправлено. Дождитесь ответа');
    const id = randomBytes(8).toString('base64url');
    const keyboard = new InlineKeyboard().text('Принять', `tables:yes:${id}`).text('Отклонить', `tables:no:${id}`);
    offers.set(id, offer);
    try {
      await bot.api.sendMessage(offer.to.id, offerText(offer), { parse_mode: 'HTML', reply_markup: keyboard });
    } catch {
      offers.delete(id);
      throw new Error('Не удалось отправить запрос игроку');
    }
  }

  bot.command('tables', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const { text, keyboard } = directory(ctx.from!.id, 0);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery(/^tables:(open|close|page:\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') return void await ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];
    if (action === 'close') {
      await ctx.deleteMessage().catch(() => undefined);
      return;
    }
    const page = action === 'open' ? 0 : Number(action.slice(5));
    const { text, keyboard } = directory(ctx.from.id, page);
    const options = { parse_mode: 'HTML' as const, reply_markup: keyboard };
    if (action === 'open') {
      await ctx.reply(text, options);
      return;
    }
    try {
      await ctx.editMessageText(text, options);
    } catch (error) {
      if (!(error instanceof GrammyError) || !error.description.includes('message is not modified')) throw error;
    }
  });

  bot.callbackQuery(/^tables:(join|invite):([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') return void await ctx.answerCallbackQuery();
    const from = playerFrom(ctx);
    const own = rooms.forMember(from.id);
    const expiresAt = Date.now() + OFFER_TTL;
    try {
      if (ctx.match[1] === 'join') {
        const room = rooms.byNumber(Number(ctx.match[2]));
        if (own) throw new Error('Сначала выйдите из своего стола');
        if (!room || !rooms.acceptsMember(room)) throw new Error('Свободных мест уже нет');
        await sendOffer({ kind: 'join', room, from, to: room.members[0], expiresAt });
      } else {
        const solo = visibleSolo().find((session) => session.directoryId === ctx.match[2]);
        if (!solo || solo.chatId === from.id) throw new Error('Игрок уже вне одиночного стола');
        if (own && !canInvite(own, from.id)) throw new Error('За вашим столом сейчас нельзя занять место');
        const to = { id: solo.chatId, name: solo.game.players[solo.humanIndex].name };
        await sendOffer({ kind: 'invite', room: own, from, to, expiresAt });
      }
    } catch (error) {
      await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message : 'Запрос не отправлен', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: 'Отправлено. Дождитесь ответа' });
  });

  bot.callbackQuery(/^tables:(yes|no):([A-Za-z0-9_-]{11})$/, async (ctx) => {
    const offer = offers.get(ctx.match[2]);
    if (ctx.chat?.type !== 'private' || offer?.to.id !== ctx.from.id || offer.expiresAt <= Date.now()) {
      await ctx.answerCallbackQuery({ text: 'Приглашение или заявка устарели' });
      return;
    }
    offers.delete(ctx.match[2]);
    const closeNotice = (text: string) => ctx.editMessageText(text).catch(() => undefined);
    if (ctx.match[1] === 'no') {
      await ctx.answerCallbackQuery();
      await closeNotice('Запрос отклонён.');
      await bot.api.sendMessage(offer.from.id, 'Игрок отклонил запрос.').catch(() => undefined);
      return;
    }
    try {
      let room = offer.room;
      if (offer.kind === 'join') {
        if (room?.members[0].id !== ctx.from.id) throw new Error('Создатель стола сменился. Отправьте новую заявку');
        rooms.admit(room, offer.from);
      } else {
        if (rooms.forMember(offer.to.id)) throw new Error('Вы уже за другим столом');
        if (rooms.forMember(offer.from.id) !== room || (room && !canInvite(room, offer.from.id))) {
          throw new Error('Приглашение больше недействительно');
        }
        room ??= rooms.create(offer.from, 3);
        rooms.admit(room, offer.to);
      }
      await ctx.answerCallbackQuery({ text: 'Принято' }).catch(() => undefined);
      await closeNotice('Запрос принят.');
      await publish(room);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Не удалось занять место';
      await ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => undefined);
      await closeNotice(text);
    }
  });
}
