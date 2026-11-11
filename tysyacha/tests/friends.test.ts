import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InlineKeyboardMarkup, Message, UserFromGetMe } from 'grammy/types';
import { createBot } from '../src/bot/index.ts';
import { findMarriages, formatCards, handPoints, MARRIAGE_POINTS, makeDeck } from '../src/game/cards.ts';
import { TysyachaGame } from '../src/game/engine.ts';
import { applyRoundScoring, createScoreState, roundToFive } from '../src/game/scoring.ts';

const botInfo: UserFromGetMe = {
  id: 42, username: 'ThousandExampleBot', first_name: 'Тысяча', is_bot: true,
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
  allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false,
};

function fakeTelegram() {
  const bot = createBot('test-token', { botInfo });
  const boards = new Map<number, Message.TextMessage>();
  const answers: string[] = [];
  let sequence = 0;
  const player = (id: number) => ({ id, is_bot: false as const, first_name: `Игрок ${id}` });
  const chat = (id: number) => ({ id, type: 'private' as const, first_name: player(id).first_name });

  bot.api.config.use(async (_prev, method, input) => {
    if (method === 'sendMessage' || method === 'editMessageText') {
      const payload = input as {
        chat_id: number; message_id?: number; text: string; reply_markup?: InlineKeyboardMarkup;
      };
      const message: Message.TextMessage = {
        message_id: payload.message_id ?? ++sequence, date: 0, chat: chat(payload.chat_id),
        from: botInfo, text: payload.text, reply_markup: payload.reply_markup,
      };
      boards.set(payload.chat_id, message);
      return { ok: true, result: message } as never;
    }
    if (method === 'answerCallbackQuery') {
      const payload = input as { text?: string };
      if (payload.text) answers.push(payload.text);
      return { ok: true, result: true } as never;
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  });

  function board(id: number) {
    const message = boards.get(id);
    assert.ok(message);
    return message;
  }
  function buttons(id: number) {
    return board(id).reply_markup?.inline_keyboard.flat() ?? [];
  }
  function action(id: number, suffix: string) {
    const button = buttons(id).find((item) => 'callback_data' in item && item.callback_data?.endsWith(suffix));
    return button && 'callback_data' in button ? button.callback_data : undefined;
  }
  function command(id: number, text: string) {
    const name = text.split(' ')[0];
    return bot.handleUpdate({
      update_id: ++sequence,
      message: {
        message_id: sequence, date: 0, chat: chat(id), from: player(id), text,
        entities: [{ offset: 0, length: name.length, type: 'bot_command' }],
      },
    });
  }
  function press(id: number, data: string) {
    return bot.handleUpdate({
      update_id: ++sequence,
      callback_query: { id: String(sequence), chat_instance: String(id), from: player(id), data, message: board(id) },
    });
  }
  return { action, answers, board, buttons, command, press };
}

for (const size of [3, 4]) {
  test(`Telegram: стол на ${size}, приглашение и полный розыгрыш`, async () => {
    const telegram = fakeTelegram();
    const ids = Array.from({ length: size }, (_, i) => i + 101);
    const [host] = ids;
    await telegram.command(host, '/start');
    await telegram.press(host, `friends:${size}`);
    const invite = telegram.buttons(host).find((item) => 'url' in item);
    assert.ok(invite && 'url' in invite && invite.url);
    const link = new URL(invite.url).searchParams.get('url');
    assert.ok(link);
    const payload = new URL(link).searchParams.get('start');
    for (const id of ids.slice(1)) await telegram.command(id, `/start ${payload}`);
    await telegram.command(ids[1], `/start ${payload}`); // повторный вход не занимает второе место
    assert.match(telegram.board(host).text, new RegExp(`Занято мест <b>${size} из ${size}</b>`));
    await telegram.command(999, `/start ${payload}`);
    assert.match(telegram.board(999).text, /все места заняты/);

    const start = telegram.action(host, ':start');
    assert.ok(start);
    await telegram.press(ids[1], start);
    assert.match(telegram.answers.at(-1) ?? '', /создатель/);
    await telegram.press(host, start);

    const allHands = ids.map((id) => telegram.board(id).text.split('<b>Ваши карты</b>\n')[1]);
    const dealt = allHands.filter(Boolean).map((cards) => cards.split(' '));
    assert.deepEqual(dealt.map((cards) => cards.length), [7, 7, 7]);
    assert.equal(new Set(dealt.flat()).size, 21);
    assert.equal(allHands.filter((hand) => hand === undefined).length, size - 3);
    assert.ok(ids.every((id) => !telegram.board(id).text.includes('<b>Прикуп</b>')));

    const firstTurn = ids.find((id) => telegram.action(id, ':bid:pass'))!;
    const pass = telegram.action(firstTurn, ':bid:pass')!;
    const wrongPlayer = ids.find((id) => id !== firstTurn)!;
    await telegram.press(wrongPlayer, pass);
    assert.match(telegram.answers.at(-1) ?? '', /не ваш ход/);
    await telegram.press(firstTurn, pass);
    await telegram.press(firstTurn, pass);
    assert.match(telegram.answers.at(-1) ?? '', /Стол обновился/);

    let cardsPlayed = 0;
    for (let step = 0; step < 36 && !telegram.action(host, ':next'); step++) {
      const suffixes = [':bid:pass', ':order:100'];
      const action = ids.flatMap((id) => {
        const preferred = suffixes.map((suffix) => telegram.action(id, suffix)).find(Boolean);
        const card = telegram.buttons(id).find((item) => 'callback_data' in item && /:card:[^:]+$/.test(item.callback_data ?? ''));
        const data = preferred ?? (card && 'callback_data' in card ? card.callback_data : undefined);
        return data ? [{ id, data }] : [];
      });
      assert.equal(action.length, 1, 'активные кнопки есть только у игрока, чей ход');
      const { id, data } = action[0];
      if (telegram.board(id).text.includes('· Розыгрыш')) cardsPlayed++;
      await telegram.press(id, data);
    }
    assert.equal(cardsPlayed, 24);
    const next = telegram.action(host, ':next');
    assert.ok(next);
    if (size === 4) assert.match(telegram.board(host).text, /Прикуп игрока/);
    await telegram.press(host, next);
    assert.match(telegram.board(host).text, /Сдача 2/);
    if (size === 4) {
      const oldDealer = allHands.findIndex((hand) => hand === undefined);
      const newDealer = ids.findIndex((id) => !telegram.board(id).text.includes('<b>Ваши карты</b>'));
      assert.equal(newDealer, (oldDealer + 1) % 4);
    }
  });
}

test('на четверых сдающий получает округлённые очки и марьяж прикупа', () => {
  const game = new TysyachaGame(Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `Игрок ${i}`, isBot: false })));
  game.startGame(0);
  const wanted = makeDeck().filter((card) => ['Kh', 'Qh', 'As'].includes(card.id));
  const remaining = makeDeck().filter((card) => !wanted.some((chosen) => chosen.id === card.id));
  game.talon = wanted;
  game.hands = [[], remaining.slice(0, 7), remaining.slice(7, 14), remaining.slice(14)];
  const dealt = game.getPublicView();
  assert.equal(dealt.sittingOut, 0);
  assert.equal(dealt.talon, undefined);
  game.placeBid(2, 'pass');
  game.placeBid(3, 'pass');
  assert.deepEqual(game.discardQueue, [2, 3]);
  assert.equal(formatCards(game.getPublicView().talon!), formatCards(wanted));
  game.discardCard(1, game.hands[1][0].id);
  game.discardCard(1, game.hands[1][0].id);
  game.setOrder(1, 100);
  for (let turn = 0; turn < 24; turn++) {
    const seat = game.whoseTurn!;
    assert.notEqual(seat, 0);
    game.playCard(seat, game.legalCards(seat)[0].id);
  }
  assert.equal(game.phase, 'roundend');
  const dealerPoints = handPoints(wanted) + findMarriages(wanted).reduce((sum, suit) => sum + MARRIAGE_POINTS[suit], 0);
  assert.equal(game.scores[0].total, roundToFive(dealerPoints));
  assert.equal(game.tricks[0].length, 0);
});

test('сдающий с нулевым прикупом не получает болт', () => {
  const result = applyRoundScoring({
    rawPoints: [0, 120, 0, 0], bidderIndex: 1, order: 100,
    before: Array.from({ length: 4 }, createScoreState), sittingOut: 0,
  });
  assert.deepEqual(result.after.map((score) => score.bolts), [0, 0, 1, 1]);
});
