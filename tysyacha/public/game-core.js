/** Ядро «Тысячи» для браузера (те же правила, что и в боте). */

export const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'];
export const RANKS = ['9', 'J', 'Q', 'K', '10', 'A'];
export const RANK_ORDER = { '9': 0, J: 1, Q: 2, K: 3, '10': 4, A: 5 };
export const CARD_POINTS = { '9': 0, J: 2, Q: 3, K: 4, '10': 10, A: 11 };
export const MARRIAGE_POINTS = { spades: 40, clubs: 60, diamonds: 80, hearts: 100 };
export const SUIT_SYMBOL = { spades: '♠', clubs: '♣', diamonds: '♦', hearts: '♥' };
export const RANK_RU = { '9': '9', J: 'В', Q: 'Д', K: 'К', '10': '10', A: 'Т' };

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ suit, rank, id: `${rank}${suit[0]}` });
  }
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardPoints(c) {
  return CARD_POINTS[c.rank];
}

export function sortHand(cards) {
  const so = { hearts: 0, diamonds: 1, clubs: 2, spades: 3 };
  return [...cards].sort((a, b) => (a.suit !== b.suit ? so[a.suit] - so[b.suit] : RANK_ORDER[b.rank] - RANK_ORDER[a.rank]));
}

export function findMarriages(hand) {
  const by = {};
  for (const c of hand) {
    by[c.suit] ||= new Set();
    by[c.suit].add(c.rank);
  }
  return SUITS.filter((s) => by[s]?.has('K') && by[s]?.has('Q'));
}

export function maxBidForHand(hand) {
  return 120 + findMarriages(hand).reduce((s, m) => s + MARRIAGE_POINTS[m], 0);
}

export function roundToFive(n) {
  const rem = ((n % 5) + 5) % 5;
  return rem <= 2 ? n - rem : n + (5 - rem);
}

function createScore() {
  return { total: 0, bolts: 0, onBarrel: false, barrelAttempts: 0 };
}

function applyRoundScoring({ rawPoints, bidderIndex, order, before }) {
  const n = before.length;
  const after = before.map((s) => ({ ...s }));
  const deltas = Array(n).fill(0);
  const notes = [];

  if (after[bidderIndex].onBarrel) after[bidderIndex].barrelAttempts += 1;

  for (let i = 0; i < n; i++) {
    const wasOnBarrel = before[i].onBarrel;
    const isBidder = i === bidderIndex;
    if (wasOnBarrel && !isBidder) {
      notes.push(`Игрок ${i + 1} на бочке — чужие очки не записываются`);
      continue;
    }
    if (isBidder) {
      const made = rawPoints[i] >= order;
      if (wasOnBarrel) {
        if (made && order >= 120) {
          after[i].total = 880 + order;
          after[i].onBarrel = false;
          after[i].barrelAttempts = 0;
          deltas[i] = order;
          notes.push(`Выход с бочки +${order}`);
        } else if (made && order < 120) {
          after[i].total = 880;
          deltas[i] = 0;
          notes.push('Заказ <120 — бочка сохранена');
        } else {
          after[i].total = 880 - order;
          after[i].onBarrel = false;
          after[i].barrelAttempts = 0;
          deltas[i] = -order;
          notes.push(`Слёт с бочки −${order}`);
        }
      } else {
        const delta = made ? order : -order;
        after[i].total += delta;
        deltas[i] = delta;
        notes.push(made ? `Заказ ${order} выполнен` : `Недобор заказа ${order}`);
      }
    } else {
      const rounded = roundToFive(rawPoints[i]);
      after[i].total += rounded;
      deltas[i] = rounded;
      if (rawPoints[i] === 0) {
        after[i].bolts += 1;
        notes.push(`Болт (${after[i].bolts}/3)`);
        if (after[i].bolts >= 3) {
          after[i].total -= 120;
          deltas[i] -= 120;
          after[i].bolts = 0;
          notes.push('3 болта → −120');
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (!before[i].onBarrel && after[i].total >= 880) {
      after[i].total = 880;
      after[i].onBarrel = true;
      after[i].barrelAttempts = 0;
      notes.push(`Игрок ${i + 1} на бочке`);
    }
  }
  for (let i = 0; i < n; i++) {
    if (after[i].onBarrel && after[i].barrelAttempts >= 3) {
      after[i].total = 760;
      after[i].onBarrel = false;
      after[i].barrelAttempts = 0;
      notes.push(`3 попытки бочки → 760`);
    }
  }

  let winnerIndex = null;
  for (let i = 0; i < n; i++) {
    if (!after[i].onBarrel && after[i].total >= 1000) {
      winnerIndex = i;
      break;
    }
  }
  return { after, deltas, notes, winnerIndex };
}

export class TysyachaGame {
  constructor(players, rng = Math.random) {
    this.players = players;
    this.scores = players.map(() => createScore());
    this.phase = 'idle';
    this.dealer = 0;
    this.dealNumber = 0;
    this.hands = [[], [], []];
    this.talon = [];
    this.bid = 100;
    this.bidder = null;
    this.passed = [false, false, false];
    this.firstHand = 0;
    this.trump = null;
    this.currentTrick = [];
    this.trickLeader = 0;
    this.whoseTurn = null;
    this.order = null;
    this.discardQueue = [];
    this.marriagesDeclared = [[], [], []];
    this.tricks = [[], [], []];
    this.wonTrickThisDeal = [false, false, false];
    this.message = '';
    this.winner = null;
    this.lastRoundNotes = [];
    this.rng = rng;
  }

  startGame(dealer = 0) {
    this.dealer = dealer % 3;
    this.winner = null;
    this.scores = this.players.map(() => createScore());
    this.dealNumber = 0;
    this.startDeal();
  }

  startDeal() {
    this.dealNumber += 1;
    this.phase = 'bidding';
    this.trump = null;
    this.currentTrick = [];
    this.order = null;
    this.bidder = null;
    this.bid = 100;
    this.passed = [false, false, false];
    this.marriagesDeclared = [[], [], []];
    this.tricks = [[], [], []];
    this.wonTrickThisDeal = [false, false, false];
    this.discardQueue = [];
    this.lastRoundNotes = [];

    const deck = shuffle(makeDeck(), this.rng);
    this.hands = [[], [], []];
    let di = 0;
    for (let r = 0; r < 7; r++) {
      for (let p = 0; p < 3; p++) {
        const seat = (this.dealer + 1 + p) % 3;
        this.hands[seat].push(deck[di++]);
      }
      if (r === 0) this.talon = [deck[di++], deck[di++], deck[di++]];
    }
    this.hands = this.hands.map(sortHand);
    this.firstHand = (this.dealer + 1) % 3;
    this.bidder = this.firstHand;
    this.whoseTurn = (this.firstHand + 1) % 3;
    this.message = `${this.players[this.firstHand].name} на стах (100). Ход: ${this.players[this.whoseTurn].name}`;
  }

  maxBid(player) {
    return maxBidForHand(this.hands[player]);
  }

  placeBid(player, amount) {
    if (this.phase !== 'bidding') throw new Error('Не фаза торговли');
    if (this.whoseTurn !== player) throw new Error('Не ваш ход');
    if (amount === 'pass') {
      if (player === this.firstHand && this.bid === 100 && this.bidder === this.firstHand) {
        throw new Error('Нельзя спасовать с обязательных ста');
      }
      this.passed[player] = true;
      this.message = `${this.players[player].name}: пас`;
      this.#advanceBidding();
      return;
    }
    if (amount % 5 !== 0 || amount <= this.bid) throw new Error('Неверная ставка');
    if (amount > this.maxBid(player)) throw new Error(`Максимум ${this.maxBid(player)}`);
    this.bid = amount;
    this.bidder = player;
    this.message = `${this.players[player].name}: ${amount}`;
    this.#advanceBidding();
  }

  #advanceBidding() {
    const active = [0, 1, 2].filter((i) => !this.passed[i]);
    if (active.length === 1) {
      this.bidder = active[0];
      this.#finishBidding();
      return;
    }
    let next = (this.whoseTurn + 1) % 3;
    for (let i = 0; i < 3; i++) {
      if (!this.passed[next]) break;
      next = (next + 1) % 3;
    }
    this.whoseTurn = next;
    this.message += `. Ход: ${this.players[next].name}`;
  }

  #finishBidding() {
    this.hands[this.bidder].push(...this.talon);
    this.hands[this.bidder] = sortHand(this.hands[this.bidder]);
    this.phase = 'discard';
    this.whoseTurn = this.bidder;
    this.discardQueue = [(this.bidder + 1) % 3, (this.bidder + 2) % 3];
    this.message = `${this.players[this.bidder].name} берёт прикуп на ${this.bid}. Снесите по карте.`;
  }

  discardCard(player, cardId) {
    if (this.phase !== 'discard' || player !== this.bidder) throw new Error('Снос недоступен');
    const target = this.discardQueue[0];
    const idx = this.hands[player].findIndex((c) => c.id === cardId);
    if (idx < 0) throw new Error('Нет карты');
    const [card] = this.hands[player].splice(idx, 1);
    this.hands[target].push(card);
    this.hands[target] = sortHand(this.hands[target]);
    this.discardQueue.shift();
    this.message = `Снос → ${this.players[target].name}`;
    if (!this.discardQueue.length) {
      this.phase = 'order';
      this.whoseTurn = this.bidder;
      this.message = `Объявите заказ (≥ ${this.bid})`;
    }
  }

  setOrder(player, amount) {
    if (this.phase !== 'order' || player !== this.bidder) throw new Error('Заказ недоступен');
    if (amount % 5 !== 0 || amount < this.bid) throw new Error('Неверный заказ');
    this.order = amount;
    this.phase = 'play';
    this.trickLeader = this.bidder;
    this.whoseTurn = this.bidder;
    this.currentTrick = [];
    this.message = `Заказ ${amount}. Ходит ${this.players[this.bidder].name}`;
  }

  declarableMarriages(player) {
    if (this.phase !== 'play' || player !== this.whoseTurn || this.currentTrick.length) return [];
    if (!this.wonTrickThisDeal[player]) return [];
    return findMarriages(this.hands[player]).filter((s) => !this.marriagesDeclared[player].includes(s));
  }

  legalCards(player) {
    if (this.phase !== 'play' || player !== this.whoseTurn) return [];
    const hand = this.hands[player];
    if (!this.currentTrick.length) return [...hand];
    const lead = this.currentTrick[0].card.suit;
    const same = hand.filter((c) => c.suit === lead);
    if (same.length) return same;
    if (this.trump) {
      const tr = hand.filter((c) => c.suit === this.trump);
      if (tr.length) return tr;
    }
    return [...hand];
  }

  playCard(player, cardId, declareMarriage = null) {
    if (this.phase !== 'play' || this.whoseTurn !== player) throw new Error('Не ход');
    const legal = this.legalCards(player);
    const card = legal.find((c) => c.id === cardId);
    if (!card) throw new Error('Нельзя');
    let marriage;
    if (!this.currentTrick.length && declareMarriage) {
      if (!this.declarableMarriages(player).includes(declareMarriage)) throw new Error('Марьяж нельзя');
      if (card.suit !== declareMarriage || (card.rank !== 'K' && card.rank !== 'Q')) throw new Error('Нужны К/Д');
      marriage = declareMarriage;
      this.marriagesDeclared[player].push(marriage);
      this.trump = marriage;
      this.message = `${this.players[player].name} захвалил ${MARRIAGE_POINTS[marriage]}!`;
    }
    const idx = this.hands[player].findIndex((c) => c.id === cardId);
    this.hands[player].splice(idx, 1);
    this.currentTrick.push({ player, card, marriage });
    if (!marriage) this.message = `${this.players[player].name} ходит`;
    if (this.currentTrick.length < 3) {
      this.whoseTurn = (player + 1) % 3;
      return;
    }
    const winner = this.#resolveTrick();
    const cards = this.currentTrick.map((t) => t.card);
    this.tricks[winner].push(cards);
    this.wonTrickThisDeal[winner] = true;
    const pts = cards.reduce((s, c) => s + cardPoints(c), 0);
    {
      const who = this.players[winner].name;
      const verb = who === 'Вы' ? 'берёте' : 'берёт';
      this.message = `${who} ${verb} взятку (${pts})`;
    }
    this.currentTrick = [];
    this.trickLeader = winner;
    this.whoseTurn = winner;
    if (this.hands.every((h) => !h.length)) this.#finishRound();
  }

  #resolveTrick() {
    const leadSuit = this.currentTrick[0].card.suit;
    let best = this.currentTrick[0];
    for (let i = 1; i < this.currentTrick.length; i++) {
      const t = this.currentTrick[i];
      if (this.trump) {
        const bt = best.card.suit === this.trump;
        const ct = t.card.suit === this.trump;
        if (ct && !bt) best = t;
        else if (ct && bt && RANK_ORDER[t.card.rank] > RANK_ORDER[best.card.rank]) best = t;
        else if (!ct && !bt) {
          if (t.card.suit === leadSuit && best.card.suit === leadSuit && RANK_ORDER[t.card.rank] > RANK_ORDER[best.card.rank]) best = t;
          else if (t.card.suit === leadSuit && best.card.suit !== leadSuit) best = t;
        }
      } else if (t.card.suit === leadSuit) {
        if (best.card.suit !== leadSuit || RANK_ORDER[t.card.rank] > RANK_ORDER[best.card.rank]) best = t;
      }
    }
    return best.player;
  }

  #finishRound() {
    const raw = [0, 1, 2].map((i) => {
      const trickPts = this.tricks[i].reduce((s, t) => s + t.reduce((ss, c) => ss + cardPoints(c), 0), 0);
      const marPts = this.marriagesDeclared[i].reduce((s, suit) => s + MARRIAGE_POINTS[suit], 0);
      return trickPts + marPts;
    });
    const result = applyRoundScoring({
      rawPoints: raw,
      bidderIndex: this.bidder,
      order: this.order,
      before: this.scores,
    });
    this.scores = result.after;
    this.lastRoundNotes = result.notes;
    this.winner = result.winnerIndex;
    this.phase = this.winner != null ? 'gameover' : 'roundend';
    this.whoseTurn = null;
    this.message = `Итог: ${raw.map((p, i) => `${this.players[i].name} ${p}`).join(', ')}`;
  }

  nextDeal() {
    if (this.phase !== 'roundend') throw new Error('Рано');
    this.dealer = (this.dealer + 1) % 3;
    this.startDeal();
  }

  getPrivateView(player) {
    const roundPoints = [0, 1, 2].map((i) => {
      const trickPts = this.tricks[i].reduce((s, t) => s + t.reduce((ss, c) => ss + cardPoints(c), 0), 0);
      const marPts = this.marriagesDeclared[i].reduce((s, suit) => s + MARRIAGE_POINTS[suit], 0);
      return trickPts + marPts;
    });
    return {
      phase: this.phase,
      players: this.players,
      scores: this.scores.map((s) => ({ ...s })),
      dealer: this.dealer,
      firstHand: this.firstHand,
      bid: this.bid,
      bidder: this.bidder,
      passed: [...this.passed],
      trump: this.trump,
      currentTrick: this.currentTrick.map((t) => ({ ...t })),
      whoseTurn: this.whoseTurn,
      handSizes: this.hands.map((h) => h.length),
      talon: this.phase === 'discard' ? [...this.talon] : undefined,
      order: this.order,
      roundPoints,
      marriagesDeclared: this.marriagesDeclared.map((m) => [...m]),
      message: this.message,
      winner: this.winner,
      dealNumber: this.dealNumber,
      hand: sortHand(this.hands[player]),
      legalCardIds: this.legalCards(player).map((c) => c.id),
      canDeclareMarriage: this.declarableMarriages(player),
      maxBid: this.maxBid(player),
      discardTargets: this.phase === 'discard' && player === this.bidder ? [...this.discardQueue] : undefined,
      lastRoundNotes: this.lastRoundNotes,
    };
  }
}

function handStrength(hand) {
  let s = hand.reduce((a, c) => a + cardPoints(c), 0);
  for (const m of findMarriages(hand)) s += MARRIAGE_POINTS[m] * 0.5;
  s += hand.filter((c) => c.rank === 'A' || c.rank === '10').length * 4;
  return s;
}

export function botAct(game, player) {
  const view = game.getPrivateView(player);
  if (game.phase === 'bidding') {
    const strength = handStrength(game.hands[player]);
    const target = Math.min(view.maxBid, Math.floor((80 + strength) / 5) * 5);
    if (game.bid >= target || game.bid >= view.maxBid) {
      try {
        game.placeBid(player, 'pass');
      } catch {
        try {
          game.placeBid(player, Math.min(view.maxBid, game.bid + 5));
        } catch {
          /* noop */
        }
      }
    } else {
      try {
        game.placeBid(player, game.bid + 5);
      } catch {
        try {
          game.placeBid(player, 'pass');
        } catch {
          /* noop */
        }
      }
    }
    return;
  }
  if (game.phase === 'discard') {
    const marriages = new Set(findMarriages(view.hand));
    const scored = view.hand.map((c) => {
      let score = cardPoints(c);
      if ((c.rank === 'K' || c.rank === 'Q') && marriages.has(c.suit)) score += 50;
      if (c.rank === 'A' || c.rank === '10') score += 20;
      return { c, score };
    });
    scored.sort((a, b) => a.score - b.score);
    game.discardCard(player, scored[0].c.id);
    return;
  }
  if (game.phase === 'order') {
    const strength = handStrength(view.hand);
    let order = game.bid;
    const max = Math.min(Math.floor((90 + strength) / 5) * 5, maxBidForHand(view.hand));
    if (max > order) order = Math.min(max, order + Math.floor((max - order) / 10) * 5);
    if (game.scores[player].onBarrel && order < 120 && maxBidForHand(view.hand) >= 120 && strength > 70) order = 120;
    game.setOrder(player, order);
    return;
  }
  if (game.phase === 'play') {
    const legal = view.hand.filter((c) => view.legalCardIds.includes(c.id));
    if (!legal.length) return;
    if (!game.currentTrick.length && view.canDeclareMarriage.length) {
      const best = [...view.canDeclareMarriage].sort((a, b) => MARRIAGE_POINTS[b] - MARRIAGE_POINTS[a])[0];
      const lead = legal.find((c) => c.suit === best && (c.rank === 'K' || c.rank === 'Q'));
      if (lead) {
        game.playCard(player, lead.id, best);
        return;
      }
    }
    if (!game.currentTrick.length) {
      const sorted = [...legal].sort((a, b) => cardPoints(a) - cardPoints(b));
      game.playCard(player, sorted[Math.floor(sorted.length / 2)].id);
      return;
    }
    legal.sort((a, b) => cardPoints(a) - cardPoints(b));
    const marriages = new Set(findMarriages(view.hand));
    const safe = legal.filter((c) => !((c.rank === 'K' || c.rank === 'Q') && marriages.has(c.suit)));
    game.playCard(player, (safe[0] ?? legal[0]).id);
  }
}

export function runBotsUntilHuman(game, humanIndex, maxSteps = 50) {
  let steps = 0;
  while (steps++ < maxSteps) {
    if (['roundend', 'gameover', 'idle'].includes(game.phase)) break;
    const turn = game.whoseTurn;
    if (turn == null || turn === humanIndex) break;
    if (!game.players[turn].isBot) break;
    botAct(game, turn);
  }
}
