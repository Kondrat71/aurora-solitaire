import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputFile } from 'grammy';
import type { InlineKeyboardMarkup, Message, UserFromGetMe } from 'grammy/types';
import { createBot } from '../src/bot/index.ts';
import { formatStatus } from '../src/bot/ui.ts';
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
  const boards = new Map<number, Message.TextMessage | Message.PhotoMessage>();
  const answers: string[] = [];
  let sequence = 0;
  const player = (id: number) => ({ id, is_bot: false as const, first_name: `Игрок ${id}` });
  const chat = (id: number) => ({ id, type: 'private' as const, first_name: player(id).first_name });

  bot.api.config.use(async (_prev, method, input) => {
    if (method === 'sendMessage' || method === 'editMessageText' || method === 'sendPhoto' || method === 'editMessageMedia') {
      const payload = input as {
        chat_id: number; message_id?: number; text?: string; reply_markup?: InlineKeyboardMarkup;
        photo?: InputFile; caption?: string; media?: { media: InputFile; caption: string };
      };
      const base = {
        message_id: payload.message_id ?? ++sequence, date: 0, chat: chat(payload.chat_id),
        from: botInfo, reply_markup: payload.reply_markup,
      };
      const picture = method === 'sendPhoto' || method === 'editMessageMedia';
      if (picture) assert.ok((payload.photo ?? payload.media?.media) instanceof InputFile);
      const message = picture ? {
        ...base, caption: payload.caption ?? payload.media?.caption,
        photo: [{ file_id: 'board', file_unique_id: 'board', width: 760, height: 590 }],
      } : { ...base, text: payload.text! };
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
    return { ...message, text: 'text' in message ? message.text : message.caption ?? '' };
  }
  function buttons(id: number) {
    return board(id).reply_markup?.inline_keyboard.flat() ?? [];
  }
  function action(id: number, suffix: string) {
    const button = buttons(id).find((item) => 'callback_data' in item && item.callback_data?.endsWith(suffix));
    return button && 'callback_data' in button ? button.callback_data : undefined;
  }
  function actionWithPrefix(id: number, prefix: string) {
    const button = buttons(id).find((item) => 'callback_data' in item && item.callback_data?.startsWith(prefix));
    assert.ok(button && 'callback_data' in button && button.callback_data);
    return button.callback_data;
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
  return { action, actionWithPrefix, answers, board, buttons, command, press };
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
    assert.ok(ids.every((id) => 'photo' in telegram.board(id)));

    const allHands = ids.map((id) => telegram.board(id).text.split('<b>Ваши карты</b>\n')[1]);
    const dealt = allHands.filter(Boolean).map((cards) => cards.split(' '));
    assert.deepEqual(dealt.map((cards) => cards.length), [7, 7, 7]);
    assert.equal(new Set(dealt.flat()).size, 21);
    assert.equal(allHands.filter((hand) => hand === undefined).length, size - 3);
    const seesTalon = (id: number) => telegram.board(id).text.includes('Прикуп у <b>');
    assert.ok(ids.every((id) => !seesTalon(id)));

    const fourth = 104;
    if (size === 3) {
      await telegram.command(fourth, '/tables');
      assert.match(telegram.board(fourth).text, /Стол №1.*В игре · 3/);
      assert.match(telegram.board(fourth).text, /Игрок 101, Игрок 102, Игрок 103/);
      assert.doesNotMatch(telegram.board(fourth).text, /Ваши карты/);
      await telegram.press(fourth, telegram.actionWithPrefix(fourth, 'tables:join:'));
      assert.match(telegram.board(host).text, /Игрок 104.*просится четвёртым/);
      const approve = telegram.actionWithPrefix(host, 'tables:yes:');
      await telegram.press(102, approve);
      assert.match(telegram.answers.at(-1) ?? '', /устарели/);
      await telegram.press(host, approve);
      assert.match(telegram.board(fourth).text, /приняты четвёртым со следующей сдачи/);
      assert.ok(!('photo' in telegram.board(fourth)));
    }

    const firstTurn = ids.find((id) => telegram.action(id, ':bid:pass'))!;
    const pass = telegram.action(firstTurn, ':bid:pass')!;
    const wrongPlayer = ids.find((id) => id !== firstTurn)!;
    await telegram.press(wrongPlayer, pass);
    assert.match(telegram.answers.at(-1) ?? '', /не ваш ход/);
    await telegram.press(firstTurn, pass);
    await telegram.press(firstTurn, pass);
    assert.match(telegram.answers.at(-1) ?? '', /Стол обновился/);

    let cardsPlayed = 0;
    let sawAuctionWinner = false;
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
      if (data.endsWith(':order:100')) {
        const winner = `Прикуп у <b>Игрок ${id}</b>`;
        assert.ok(ids.every((recipient) => telegram.board(recipient).text.includes(winner)));
        sawAuctionWinner = true;
      }
      if (telegram.board(id).text.includes('· Розыгрыш')) {
        assert.ok(ids.every((recipient) => seesTalon(recipient) === (cardsPlayed === 0)));
        cardsPlayed++;
      }
      await telegram.press(id, data);
      if (cardsPlayed > 0) assert.ok(ids.every((recipient) => !seesTalon(recipient)));
    }
    assert.ok(sawAuctionWinner);
    assert.equal(cardsPlayed, 24);
    const next = telegram.action(host, ':next');
    assert.ok(next);
    assert.ok(ids.every((id) => !seesTalon(id)));
    assert.match(telegram.board(host).text, /Общий счёт · очки за сдачу/);
    if (size === 4) assert.match(telegram.board(host).text, /Очки сдающего за прикуп/);
    const scoreLines = (text: string) => [...text.matchAll(/Игрок 10[1-3] · <b>[−\d]+<\/b>/g)].map(([score]) => score);
    const before = scoreLines(telegram.board(host).text);
    await telegram.press(host, next);
    assert.match(telegram.board(host).text, /Сдача 2/);
    assert.ok(ids.every((id) => !seesTalon(id)));
    if (size === 3) {
      assert.match(telegram.board(fourth).text, /Сдача 2 · 4 игрока/);
      assert.match(telegram.board(fourth).text, /Игрок 104 · <b>0<\/b>/);
      assert.ok('photo' in telegram.board(fourth));
      assert.equal(before.length, 3);
      assert.deepEqual(scoreLines(telegram.board(host).text), before);
    }
    if (size === 4) {
      const oldDealer = allHands.findIndex((hand) => hand === undefined);
      const newDealer = ids.findIndex((id) => !telegram.board(id).text.includes('<b>Ваши карты</b>'));
      assert.equal(newDealer, (oldDealer + 1) % 4);
    }
  });
}

test('Telegram: одиночный стол тоже отправляется как фото', async () => {
  const telegram = fakeTelegram();
  await telegram.command(101, '/new');
  assert.ok('photo' in telegram.board(101));
  assert.match(telegram.board(101).text, /всего · \d+ за сдачу/);
  await telegram.command(101, '/stop');
});

test('Telegram: игрока с ботами можно пригласить за новый стол', async () => {
  const telegram = fakeTelegram();
  await telegram.command(201, '/start');
  await telegram.command(202, '/new');
  await telegram.press(201, telegram.actionWithPrefix(201, 'tables:open'));
  assert.match(telegram.board(201).text, /Игрок 202.*Играет с ботами/);
  await telegram.press(201, telegram.actionWithPrefix(201, 'tables:invite:'));
  assert.match(telegram.board(202).text, /Игрок 201.*приглашает вас за новый стол на троих/);
  await telegram.press(202, telegram.actionWithPrefix(202, 'tables:yes:'));
  assert.match(telegram.board(201).text, /Занято мест <b>2 из 3<\/b>/);
  assert.match(telegram.board(202).text, /Занято мест <b>2 из 3<\/b>/);
  await telegram.command(203, '/tables');
  assert.match(telegram.board(203).text, /Игрок 201, Игрок 202/);
  assert.doesNotMatch(telegram.board(203).text, /Игрок 202.*Играет с ботами/);
});

test('бубновый марьяж объявляется ходом королём после взятки', () => {
  const game = new TysyachaGame(Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: `Игрок ${i}`, isBot: false })));
  const deck = makeDeck();
  const card = (id: string) => deck.find((candidate) => candidate.id === id)!;
  game.phase = 'play';
  game.whoseTurn = 0;
  game.hands = [[card('As'), card('Kd'), card('Qd')], [card('9s'), card('9d')], [card('Js'), card('Jd')]];
  assert.deepEqual(game.declarableMarriages(0), []);
  game.playCard(0, 'As');
  game.playCard(1, '9s');
  game.playCard(2, 'Js');
  assert.equal(game.getPublicView().roundPoints[0], 13);
  game.playCard(0, 'Kd');
  const view = game.getPublicView();
  assert.equal(view.trump, 'diamonds');
  assert.equal(view.currentTrick[0].marriage, 'diamonds');
  assert.equal(view.roundPoints[0], 93);
  assert.deepEqual(view.marriagesDeclared[0], ['diamonds']);
});

test('общий счёт остаётся отрицательным после недобора и виден в Telegram', () => {
  const game = new TysyachaGame(Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: `Игрок ${i}`, isBot: false })));
  game.scores = applyRoundScoring({
    rawPoints: [70, 30, 20], bidderIndex: 0, order: 100, before: game.scores,
  }).after;
  assert.equal(game.scores[0].total, -100);
  assert.match(formatStatus(game.getPrivateView(0)), /<b>−100<\/b> всего/);
});

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
