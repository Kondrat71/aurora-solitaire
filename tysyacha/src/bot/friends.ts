import { Bot, GrammyError, InlineKeyboard, type Context } from 'grammy';
import { formatCard, formatCards, MARRIAGE_POINTS, SUIT_SYMBOL } from '../game/cards.ts';
import type { PrivateView, TrickPlay } from '../game/engine.ts';
import { Rooms, type Member, type Room } from './rooms.ts';
import { cardAction, escapeHtml, scoreText, tableName, talonNotice } from './ui.ts';
import { publishPhotoTable } from './table.ts';

const phases = {
  idle: 'Ожидание', bidding: 'Торги', talonshow: 'Прикуп', discard: 'Передача карт',
  order: 'Заказ', play: 'Розыгрыш', roundend: 'Итоги сдачи', gameover: 'Партия завершена',
};

const menuText = '<b>♠ Тысяча ♥</b>\n\nСоздайте стол, отправьте приглашение друзьям и начните партию, когда все займут места.';

function menu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('👥 Стол на троих', 'friends:3').text('👥 Стол на четверых', 'friends:4').row()
    .text('🤖 Игра с ботами', 'new').text('📖 Правила', 'rules');
}

function callback(room: Room, action: string): string {
  return `r:${room.id}:${room.revision}:${action}`;
}

export function roomScreen(room: Room, member: Member, username: string): {
  text: string; keyboard: InlineKeyboard; view?: PrivateView; seat: number;
} {
  const seat = room.members.indexOf(member);
  const keyboard = new InlineKeyboard();
  const add = (label: string, action: string) => keyboard.text(label, callback(room, action));
  const name = (i: number) => tableName(room.members[i].name);
  const game = room.game;
  if (!game) {
    const invite = `https://t.me/${username}?start=join_${room.id}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(invite)}&text=${encodeURIComponent('Сыграем в Тысячу?')}`;
    const full = room.members.length === room.size;
    const seats = Array.from({ length: room.size }, (_, i) => {
      if (i >= room.members.length) return `${i + 1}. Свободное место`;
      return `${i + 1}. <b>${name(i)}</b>${i === 0 ? ' · создатель' : ''}${seat === i ? ' · вы' : ''}`;
    });
    const lines = [
      '<b>♠ Тысяча · Стол друзей</b>',
      `Занято мест <b>${room.members.length} из ${room.size}</b>`, '', ...seats, '',
      full
        ? seat === 0 ? 'Все на месте. Можно начинать.' : `Ждём, когда ${name(0)} начнёт партию.`
        : 'Отправьте приглашение друзьям. Каждый игрок получит карты в личном чате с ботом.',
    ];
    if (!full) keyboard.url('📨 Пригласить друзей', share).row();
    if (full && seat === 0) add('▶️ Начать партию', 'start').row();
    add('Выйти из комнаты', 'leave');
    return { text: lines.join('\n'), keyboard, seat };
  }

  const view = game.getPrivateView(seat);
  const myTurn = view.whoseTurn === seat;
  const finished = view.phase === 'gameover' || view.phase === 'roundend';
  const lines = [
    `<b>♠ Тысяча · ${phases[view.phase]}</b>`,
    `Сдача ${view.dealNumber} · ${room.size} игрока · до 1000`, '',
  ];
  if (view.winner !== null) {
    lines.push(`🏆 <b>Победитель — ${name(view.winner)}</b>`);
  } else if (view.phase === 'roundend') {
    lines.push('🏁 <b>Сдача закончилась</b>');
  } else if (myTurn) {
    const hints = {
      bidding: view.bid + 5 <= view.maxBid
        ? 'Поднимите ставку на 5 или спасуйте.'
        : 'Ставку уже нельзя поднять с вашими картами. Нажмите «Пас».',
      discard: view.discardTargets?.[0] === undefined ? '' : `Выберите карту для игрока ${name(view.discardTargets[0])}.`,
      order: 'Выберите, сколько очков обязуетесь набрать.',
      play: 'Выберите карту для хода.',
    };
    const phase = view.phase;
    lines.push('🟢 <b>Ваш ход</b>');
    if (phase === 'bidding' || phase === 'discard' || phase === 'order' || phase === 'play') lines.push(hints[phase]);
  } else if (view.whoseTurn !== null) {
    lines.push(`⏳ Ходит <b>${name(view.whoseTurn)}</b>`);
  }
  if (!finished && seat === view.sittingOut) lines.push('Вы на прикупе в этой сдаче.');

  lines.push('', '<b>Общий счёт · очки за сдачу</b>');
  view.scores.forEach((score, i) => {
    const flags = [
      seat === i ? 'вы' : '',
      score.onBarrel ? 'бочка' : '',
      i === view.sittingOut ? 'на прикупе' : '',
      view.phase === 'bidding' && i !== view.sittingOut && view.passed[i] ? 'пас' : '',
    ].filter(Boolean);
    const delta = game.lastDeltas[i];
    const change = finished ? ` (${delta > 0 ? '+' : ''}${scoreText(delta)})` : '';
    const round = !finished && view.sittingOut === i ? '—' : view.roundPoints[i];
    lines.push(`${name(i)} · <b>${scoreText(score.total)}</b>${change} · ${round}${flags.length ? ` · ${flags.join(', ')}` : ''}`);
  });
  if (finished && view.sittingOut !== null) {
    const dealer = view.sittingOut;
    lines.push(`Очки сдающего за прикуп · ${name(dealer)} · ${view.roundPoints[dealer]} до округления`);
  }

  const talon = talonNotice(view);
  if (!finished) {
    const contract = view.order === null ? `Ставка <b>${view.bid}</b>` : `Заказ <b>${view.order}</b>`;
    const trump = view.trump ? SUIT_SYMBOL[view.trump] : '—';
    const declarer = view.bidder === null || talon ? '' : ` · ${name(view.bidder)}`;
    lines.push('', `${contract}${declarer} · Козырь ${trump}`);
  }
  if (talon) lines.push(talon);
  const marriages = view.marriagesDeclared.flatMap((suits, i) =>
    suits.map((suit) => `${name(i)} ${SUIT_SYMBOL[suit]}+${MARRIAGE_POINTS[suit]}`));
  if (marriages.length) lines.push(`<b>Марьяжи</b> ${marriages.join(' · ')}`);
  const trickText = (trick: TrickPlay[]) => trick.map(({ player, card }) => `${name(player)} ${formatCard(card)}`).join(' · ');
  if (view.lastTrickWinner !== null) {
    lines.push(`<b>Последняя взятка</b> · ${name(view.lastTrickWinner)}\n${trickText(view.lastTrick)}`);
  }
  if (view.currentTrick.length) lines.push(`<b>На столе</b> ${trickText(view.currentTrick)}`);
  if (view.hand.length) lines.push('', `<b>Ваши карты</b>\n${formatCards(view.hand)}`);

  if (myTurn && view.phase === 'bidding') {
    const next = view.bid + 5;
    if (next <= view.maxBid) add(`⬆️ Ставка ${next}`, `bid:${next}`);
    add('Пас', 'bid:pass').row();
  }
  if (myTurn && view.phase === 'order') {
    view.orderOptions.forEach((value, i) => {
      add(String(value), `order:${value}`);
      if ((i + 1) % 5 === 0) keyboard.row();
    });
    keyboard.row();
  }
  if (myTurn && (view.phase === 'discard' || view.phase === 'play')) {
    const cards = view.phase === 'discard' ? view.hand : view.hand.filter((card) => view.legalCardIds.includes(card.id));
    cards.forEach((card, i) => {
      add(cardAction(card, view.canDeclareMarriage), `card:${card.id}`);
      if ((i + 1) % 5 === 0) keyboard.row();
    });
    keyboard.row();
    if (view.canDeclareMarriage.length) lines.push('Кнопка с +очками объявит марьяж.');
  }
  if (view.phase === 'roundend') add('➡️ Следующая сдача', 'next').row();
  if (view.phase === 'gameover' && seat === 0) add('🔁 Сыграть ещё', 'restart').row();
  add('Выйти из комнаты', 'leave');
  return { text: lines.join('\n'), keyboard, view, seat };
}

export function registerFriends(bot: Bot): void {
  const rooms = new Rooms();

  const showMenu = (ctx: Context) => ctx.reply(menuText, { parse_mode: 'HTML', reply_markup: menu() });

  async function updateTable(room: Room, member: Member): Promise<void> {
    const { text, keyboard, view, seat } = roomScreen(room, member, bot.botInfo.username);
    if (view) {
      member.messageId = await publishPhotoTable(bot.api, member.id, member.messageId, view, seat, text, keyboard);
      return;
    }
    const options = { parse_mode: 'HTML' as const, reply_markup: keyboard };
    if (member.messageId !== undefined) {
      try {
        await bot.api.editMessageText(member.id, member.messageId, text, options);
        return;
      } catch (error) {
        if (!(error instanceof GrammyError) || error.error_code !== 400) throw error;
        if (error.description.includes('message is not modified')) return;
      }
    }
    const sent = await bot.api.sendMessage(member.id, text, options);
    member.messageId = sent.message_id;
  }

  async function publish(room: Room): Promise<void> {
    await Promise.all(room.members.map(async (member) => {
      try {
        await updateTable(room, member);
      } catch (error) {
        console.error('[tysyacha] не удалось обновить стол:', error instanceof Error ? error.name : 'ошибка');
      }
    }));
  }

  async function askLeave(ctx: Context, room: Room): Promise<void> {
    const keyboard = new InlineKeyboard()
      .text('Да, выйти', callback(room, 'confirm-leave')).text('Остаться', callback(room, 'stay'));
    await ctx.reply(room.game && room.game.phase !== 'gameover'
      ? 'Если вы выйдете, партия завершится для всех. Выйти из комнаты?'
      : 'Выйти из комнаты?', { reply_markup: keyboard });
  }

  bot.command('start', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const invite = /^join_([A-Za-z0-9_-]{12})$/.exec(ctx.match);
    if (invite) {
      try {
        const room = rooms.join(invite[1], { id: ctx.from!.id, name: ctx.from!.first_name });
        await publish(room);
      } catch (error) {
        await ctx.reply(error instanceof Error ? error.message : 'Не удалось открыть приглашение');
      }
      return;
    }
    const room = rooms.forMember(ctx.from!.id);
    if (!room) {
      await showMenu(ctx);
      return;
    }
    await updateTable(room, room.members.find((member) => member.id === ctx.from!.id)!);
  });

  bot.command(['table', 'stop', 'leave'], async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const room = rooms.forMember(ctx.from!.id);
    if (!room) return next();
    if (ctx.message?.text.startsWith('/table')) {
      const member = room.members.find((player) => player.id === ctx.from!.id)!;
      // По команде присылаем стол в конец переписки, чтобы его легко было найти.
      if (member.messageId !== undefined) {
        await bot.api.editMessageReplyMarkup(member.id, member.messageId).catch(() => undefined);
        member.messageId = undefined;
      }
      await updateTable(room, member);
    } else {
      await askLeave(ctx, room);
    }
  });

  bot.callbackQuery(/^friends:([34])$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCallbackQuery({ text: 'Откройте личный чат с ботом' });
      return;
    }
    const id = ctx.from.id;
    const current = rooms.forMember(id);
    if (current) {
      await ctx.answerCallbackQuery({ text: 'У вас уже есть стол. Откройте /table' });
      return;
    }
    const room = rooms.create({ id, name: ctx.from.first_name }, ctx.match[1] === '3' ? 3 : 4);
    await Promise.all([ctx.answerCallbackQuery().catch(() => undefined), publish(room)]);
  });

  bot.callbackQuery(/^r:([A-Za-z0-9_-]{12}):(\d+):(.+)$/, async (ctx) => {
    const id = ctx.from.id;
    const room = rooms.forMember(id);
    if (ctx.chat?.type !== 'private' || !room || room.id !== ctx.match[1]) {
      await ctx.answerCallbackQuery({ text: 'Этот стол больше недоступен' });
      return;
    }
    const action = ctx.match[3];
    if (action === 'leave') {
      await ctx.answerCallbackQuery();
      await askLeave(ctx, room);
      return;
    }
    if (action === 'stay') {
      await ctx.answerCallbackQuery();
      await ctx.deleteMessage().catch(() => undefined);
      return;
    }
    if (action === 'confirm-leave') {
      const actor = room.members.find((member) => member.id === id)!;
      const { departed, closed } = rooms.leave(room, id);
      await ctx.answerCallbackQuery().catch(() => undefined);
      await ctx.deleteMessage().catch(() => undefined);
      await Promise.all(departed.map(async (member) => {
        if (member.messageId !== undefined) {
          await bot.api.deleteMessage(member.id, member.messageId).catch(() => undefined);
        }
        const notice = member.id === id ? 'Вы вышли из комнаты.' : `Комната закрыта. ${escapeHtml(actor.name)} вышел из игры.`;
        await bot.api.sendMessage(member.id, `${notice}\n\n${menuText}`, { parse_mode: 'HTML', reply_markup: menu() }).catch(() => undefined);
      }));
      if (!closed) await publish(room);
      return;
    }
    try {
      rooms.act(room, id, Number(ctx.match[2]), action);
    } catch (error) {
      await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message.slice(0, 180) : 'Действие не выполнено', show_alert: true });
      return;
    }
    await Promise.all([ctx.answerCallbackQuery().catch(() => undefined), publish(room)]);
  });
}
