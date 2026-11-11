/** Простой ИИ для «Тысячи». */

import { TysyachaGame } from './engine.ts';
import {
  type Card,
  type Suit,
  cardPoints,
  findMarriages,
  MARRIAGE_POINTS,
  RANK_ORDER,
} from './cards.ts';

function handStrength(hand: Card[]): number {
  let s = hand.reduce((a, c) => a + cardPoints(c), 0);
  for (const m of findMarriages(hand)) s += MARRIAGE_POINTS[m] * 0.5;
  // бонус за тузы и десятки
  s += hand.filter((c) => c.rank === 'A' || c.rank === '10').length * 4;
  return s;
}

export function botAct(game: TysyachaGame, player: number): void {
  const view = game.getPrivateView(player);

  switch (game.phase) {
    case 'bidding':
      botBid(game, player, view.maxBid);
      break;
    case 'discard':
      botDiscard(game, player, view.hand);
      break;
    case 'order':
      botOrder(game, player, view.hand);
      break;
    case 'play':
      botPlay(game, player, view.hand, view.legalCardIds, view.canDeclareMarriage);
      break;
    default:
      break;
  }
}

function botBid(game: TysyachaGame, player: number, maxBid: number): void {
  const strength = handStrength(game.hands[player]);
  const target = Math.min(maxBid, Math.floor((80 + strength) / 5) * 5);

  // Первая рука на 100 — уже «сидит», ей ход только если кто-то поднял
  if (game.bid >= target || game.bid >= maxBid) {
    try {
      game.placeBid(player, 'pass');
    } catch {
      // обязательные 100 — не наш случай на ходе первой руки без повышения
      if (game.bid + 5 <= maxBid && strength > 55) {
        game.placeBid(player, game.bid + 5);
      } else {
        // если нельзя пасовать — поднимаем минимально или ждём
        try {
          game.placeBid(player, Math.min(maxBid, game.bid + 5));
        } catch {
          /* игнор */
        }
      }
    }
    return;
  }

  const next = game.bid + 5;
  if (next <= maxBid && next <= target) {
    game.placeBid(player, next);
  } else {
    try {
      game.placeBid(player, 'pass');
    } catch {
      game.placeBid(player, Math.min(maxBid, game.bid + 5));
    }
  }
}

function botDiscard(game: TysyachaGame, player: number, hand: Card[]): void {
  // Сносим самые бесполезные: девятки, потом младшие без марьяжа
  const marriages = new Set(findMarriages(hand));
  const scored = hand.map((c) => {
    let score = cardPoints(c);
    if ((c.rank === 'K' || c.rank === 'Q') && marriages.has(c.suit)) score += 50;
    if (c.rank === 'A' || c.rank === '10') score += 20;
    return { c, score };
  });
  scored.sort((a, b) => a.score - b.score);
  game.discardCard(player, scored[0].c.id);
}

function botOrder(game: TysyachaGame, player: number, hand: Card[]): void {
  const strength = handStrength(hand);
  let order = game.bid;
  const max = Math.min(
    Math.floor((90 + strength) / 5) * 5,
    120 + findMarriages(hand).reduce((s, m) => s + MARRIAGE_POINTS[m], 0),
  );
  if (max > order) order = Math.min(max, order + Math.floor((max - order) / 10) * 5);
  // На бочке стараемся заказать ≥120
  if (game.scores[player].onBarrel && order < 120) {
    const cap = 120 + findMarriages(hand).reduce((s, m) => s + MARRIAGE_POINTS[m], 0);
    if (cap >= 120 && strength > 70) order = 120;
  }
  game.setOrder(player, order);
}

function botPlay(
  game: TysyachaGame,
  player: number,
  hand: Card[],
  legalIds: string[],
  marriages: Suit[],
): void {
  const legal = hand.filter((c) => legalIds.includes(c.id));
  if (!legal.length) return;

  // Заход: если можно марьяж — объявляем самый дорогой
  if (game.currentTrick.length === 0 && marriages.length) {
    const best = [...marriages].sort((a, b) => MARRIAGE_POINTS[b] - MARRIAGE_POINTS[a])[0];
    const lead = legal.find((c) => c.suit === best && (c.rank === 'K' || c.rank === 'Q'));
    if (lead) {
      game.playCard(player, lead.id, best);
      return;
    }
  }

  if (game.currentTrick.length === 0) {
    // Заходим средней картой / тузом масти без слабости
    const sorted = [...legal].sort((a, b) => cardPoints(a) - cardPoints(b));
    const mid = sorted[Math.floor(sorted.length / 2)];
    game.playCard(player, mid.id);
    return;
  }

  // Ответ: стараемся взять дешёвую взятку младшей достаточной картой
  const leadSuit = game.currentTrick[0].card.suit;
  const trump = game.trump;

  const winning = (card: Card): boolean => {
    const trial = [...game.currentTrick, { player, card }];
    return resolveWinner(trial, trump) === player;
  };

  const winners = legal.filter(winning);
  if (winners.length) {
    winners.sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    game.playCard(player, winners[0].id);
    return;
  }

  // Сбрасываем самое дешёвое
  legal.sort((a, b) => cardPoints(a) - cardPoints(b));
  // Не ломаем марьяж без нужды
  const marriagesSet = new Set(findMarriages(hand));
  const safe = legal.filter(
    (c) => !((c.rank === 'K' || c.rank === 'Q') && marriagesSet.has(c.suit)),
  );
  game.playCard(player, (safe[0] ?? legal[0]).id);
  void leadSuit;
}

function resolveWinner(
  trick: { player: number; card: Card }[],
  trump: Suit | null,
): number {
  const leadSuit = trick[0].card.suit;
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    const t = trick[i];
    if (trump) {
      const bestIsTrump = best.card.suit === trump;
      const curIsTrump = t.card.suit === trump;
      if (curIsTrump && !bestIsTrump) best = t;
      else if (curIsTrump && bestIsTrump) {
        if (RANK_ORDER[t.card.rank] > RANK_ORDER[best.card.rank]) best = t;
      } else if (!curIsTrump && !bestIsTrump) {
        if (t.card.suit === leadSuit && RANK_ORDER[t.card.rank] > RANK_ORDER[best.card.rank] && best.card.suit === leadSuit)
          best = t;
        else if (t.card.suit === leadSuit && best.card.suit !== leadSuit) best = t;
      }
    } else if (t.card.suit === leadSuit) {
      if (best.card.suit !== leadSuit || RANK_ORDER[t.card.rank] > RANK_ORDER[best.card.rank])
        best = t;
    }
  }
  return best.player;
}

/** Прокрутить ходы ботов, пока ход не у человека или фаза не ждёт игрока */
export function runBotsUntilHuman(game: TysyachaGame, humanIndex: number, maxSteps = 40): void {
  let steps = 0;
  while (steps++ < maxSteps) {
    if (game.phase === 'roundend' || game.phase === 'gameover' || game.phase === 'idle') break;
    const turn = game.whoseTurn;
    if (turn === null || turn === humanIndex) break;
    if (!game.players[turn].isBot) break;
    botAct(game, turn);
  }
}
