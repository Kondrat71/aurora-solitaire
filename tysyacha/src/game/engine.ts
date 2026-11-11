/**
 * Движок партии «Тысяча» на 3 или 4 места.
 * Правила сверены с kubikoved.ru / IgraFan / cards-1000.ru.
 */

import {
  type Card,
  type Suit,
  makeDeck,
  shuffle,
  sortHand,
  findMarriages,
  maxBidForHand,
  MARRIAGE_POINTS,
  handPoints,
  compareInSuit,
  cardPoints,
} from './cards.ts';
import {
  type PlayerScoreState,
  createScoreState,
  applyRoundScoring,
  roundToFive,
} from './scoring.ts';

export type Phase =
  | 'idle'
  | 'bidding'
  | 'talonshow'
  | 'discard'
  | 'order'
  | 'play'
  | 'roundend'
  | 'gameover';

export interface PlayerInfo {
  id: string;
  name: string;
  isBot: boolean;
}

export interface TrickPlay {
  player: number;
  card: Card;
  marriage?: Suit;
}

export interface PublicGameView {
  phase: Phase;
  players: PlayerInfo[];
  scores: PlayerScoreState[];
  dealer: number;
  sittingOut: number | null;
  firstHand: number;
  bid: number;
  bidder: number | null;
  passed: boolean[];
  trump: Suit | null;
  currentTrick: TrickPlay[];
  lastTrick: TrickPlay[];
  lastTrickWinner: number | null;
  trickLeader: number;
  whoseTurn: number | null;
  handSizes: number[];
  talon?: Card[];
  order: number | null;
  roundPoints: number[];
  marriagesDeclared: Suit[][];
  tricksWon: number[];
  message: string;
  winner: number | null;
  dealNumber: number;
}

export interface PrivateView extends PublicGameView {
  hand: Card[];
  legalCardIds: string[];
  canDeclareMarriage: Suit[];
  maxBid: number;
  discardTargets?: number[];
  orderOptions: number[];
}

export class TysyachaGame {
  readonly players: PlayerInfo[];
  scores: PlayerScoreState[];
  phase: Phase = 'idle';
  dealer = 0;
  dealNumber = 0;
  hands: Card[][];
  talon: Card[] = [];
  bid = 100;
  bidder: number | null = null;
  passed: boolean[];
  biddingTurn = 0;
  firstHand = 0;
  trump: Suit | null = null;
  currentTrick: TrickPlay[] = [];
  lastTrick: TrickPlay[] = [];
  lastTrickWinner: number | null = null;
  trickLeader = 0;
  whoseTurn: number | null = null;
  order: number | null = null;
  /** Сколько карт ещё нужно снести и кому */
  discardQueue: number[] = [];
  marriagesDeclared: Suit[][];
  tricks: Card[][][];
  wonTrickThisDeal: boolean[];
  message = '';
  winner: number | null = null;
  lastRoundNotes: string[] = [];
  lastDeltas: number[];
  private rng: () => number;

  constructor(players: PlayerInfo[], rng: () => number = Math.random) {
    if (players.length !== 3 && players.length !== 4) throw new Error('Нужно 3 или 4 игрока');
    this.players = players;
    this.scores = players.map(() => createScoreState());
    this.hands = players.map(() => []);
    this.passed = players.map(() => false);
    this.marriagesDeclared = players.map(() => []);
    this.tricks = players.map(() => []);
    this.wonTrickThisDeal = players.map(() => false);
    this.lastDeltas = players.map(() => 0);
    this.rng = rng;
  }

  get sittingOut(): number | null {
    return this.players.length === 4 ? this.dealer : null;
  }

  private nextActiveSeat(from: number): number {
    const next = (from + 1) % this.players.length;
    return next === this.sittingOut ? (next + 1) % this.players.length : next;
  }

  startGame(dealer = 0): void {
    this.dealer = dealer % this.players.length;
    this.dealNumber = 0;
    this.winner = null;
    this.scores = this.players.map(() => createScoreState());
    this.startDeal();
  }

  startDeal(): void {
    this.dealNumber += 1;
    this.phase = 'bidding';
    this.trump = null;
    this.currentTrick = [];
    this.lastTrick = [];
    this.lastTrickWinner = null;
    this.order = null;
    this.bidder = null;
    this.bid = 100;
    this.passed = this.players.map((_, seat) => seat === this.sittingOut);
    this.marriagesDeclared = this.players.map(() => []);
    this.tricks = this.players.map(() => []);
    this.wonTrickThisDeal = this.players.map(() => false);
    this.lastRoundNotes = [];
    this.lastDeltas = this.players.map(() => 0);
    this.discardQueue = [];

    const deck = shuffle(makeDeck(), this.rng);
    this.hands = this.players.map(() => []);
    this.talon = [];

    // Четверо: последняя карта идёт в прикуп сдающего.
    const lastTalonCard = this.sittingOut === null ? undefined : deck.pop();
    let di = 0;
    for (let r = 0; r < 7; r++) {
      let seat = this.dealer;
      for (let p = 0; p < 3; p++) {
        seat = this.nextActiveSeat(seat);
        this.hands[seat].push(deck[di++]);
      }
      if (r === 0) {
        this.talon = [deck[di++], deck[di++], lastTalonCard ?? deck[di++]];
      }
    }
    this.hands = this.hands.map(sortHand);

    this.firstHand = this.nextActiveSeat(this.dealer);
    this.bidder = this.firstHand; // пока сидит на 100
    this.biddingTurn = this.nextActiveSeat(this.firstHand);
    this.whoseTurn = this.biddingTurn;
    this.message = `${this.players[this.firstHand].name} на стах (100). Ход торговли: ${this.players[this.biddingTurn].name}`;
  }

  /** Максимальная ставка по текущей руке */
  maxBid(player: number): number {
    return maxBidForHand(this.hands[player]);
  }

  placeBid(player: number, amount: number | 'pass'): void {
    this.assertPhase('bidding');
    this.assertTurn(player);
    if (this.passed[player]) throw new Error('Вы уже спасовали');

    if (amount === 'pass') {
      if (player === this.bidder) throw new Error('Вашу ставку пока не перебили');

      this.passed[player] = true;
      this.message = `${this.players[player].name}: пас`;
      this.advanceBidding();
      return;
    }

    if (amount % 5 !== 0) throw new Error('Ставка должна быть кратна 5');
    if (amount <= this.bid) throw new Error(`Нужно больше текущей ставки (${this.bid})`);
    if (amount > this.maxBid(player)) {
      throw new Error(`Максимум по картам: ${this.maxBid(player)}`);
    }

    this.bid = amount;
    this.bidder = player;
    this.message = `${this.players[player].name} говорит ${amount}`;
    this.advanceBidding();
  }

  private advanceBidding(): void {
    let next = this.nextActiveSeat(this.whoseTurn!);
    while (this.passed[next]) next = this.nextActiveSeat(next);
    if (next === this.bidder) {
      this.finishBidding();
      return;
    }
    this.whoseTurn = next;
    this.biddingTurn = next;
    this.message += `. Ход: ${this.players[next].name}`;
  }

  private finishBidding(): void {
    if (this.bidder === null) this.bidder = this.firstHand;
    this.phase = 'talonshow';
    this.whoseTurn = this.bidder;
    // Прикуп к победителю
    this.hands[this.bidder].push(...this.talon);
    this.hands[this.bidder] = sortHand(this.hands[this.bidder]);
    this.message = `${this.players[this.bidder].name} выиграл торги на ${this.bid}. Прикуп: открыт. Нужно снести по карте соперникам.`;
    this.phase = 'discard';
    // Очередь сноса: двум соперникам по часовой
    const a = this.nextActiveSeat(this.bidder);
    const b = this.nextActiveSeat(a);
    this.discardQueue = [a, b];
  }

  /** Снос одной карты сопернику */
  discardCard(player: number, cardId: string): void {
    this.assertPhase('discard');
    if (player !== this.bidder) throw new Error('Сносит только победитель торгов');
    if (this.discardQueue.length === 0) throw new Error('Снос уже выполнен');

    const target = this.discardQueue[0];
    const idx = this.hands[player].findIndex((c) => c.id === cardId);
    if (idx < 0) throw new Error('Нет такой карты');
    const [card] = this.hands[player].splice(idx, 1);
    this.hands[target].push(card);
    this.hands[target] = sortHand(this.hands[target]);
    this.discardQueue.shift();
    this.message = `${this.players[player].name} снёс карту игроку ${this.players[target].name}`;

    if (this.discardQueue.length === 0) {
      this.phase = 'order';
      this.whoseTurn = this.bidder;
      this.message += `. Объявите окончательный заказ (не меньше ${this.bid})`;
    }
  }

  setOrder(player: number, amount: number): void {
    this.assertPhase('order');
    this.assertTurn(player);
    if (player !== this.bidder) throw new Error('Заказывает победитель торгов');
    if (amount % 5 !== 0) throw new Error('Заказ кратен 5');
    if (amount < this.bid) throw new Error(`Нельзя меньше ставки торгов (${this.bid})`);
    // Ставку торгов всегда можно оставить, даже если после сноса марьяж пропал.
    // Повышать заказ — только в пределах 120 + марьяжи на текущей руке.
    const handMax = maxBidForHand(this.hands[player]);
    if (amount > this.bid && amount > handMax) {
      throw new Error(`Максимум по картам после сноса: ${handMax}`);
    }
    this.order = amount;
    this.phase = 'play';
    this.trickLeader = this.bidder!;
    this.whoseTurn = this.bidder;
    this.currentTrick = [];
    this.message = `Заказ: ${amount}. Ходит ${this.players[this.bidder!].name}`;
  }

  /** Доступные значения окончательного заказа */
  orderOptions(player: number): number[] {
    const handMax = Math.max(this.bid, maxBidForHand(this.hands[player]));
    const opts: number[] = [];
    for (let v = this.bid; v <= handMax; v += 5) opts.push(v);
    return opts;
  }

  /** Какие марьяжи можно объявить сейчас */
  declarableMarriages(player: number): Suit[] {
    if (this.phase !== 'play') return [];
    if (player !== this.whoseTurn) return [];
    if (this.currentTrick.length !== 0) return []; // только при заходе
    if (!this.wonTrickThisDeal[player]) return []; // нужна своя взятка
    const have = findMarriages(this.hands[player]);
    return have.filter((s) => !this.marriagesDeclared[player].includes(s));
  }

  legalCards(player: number): Card[] {
    if (this.phase !== 'play' || player !== this.whoseTurn) return [];
    const hand = this.hands[player];
    if (this.currentTrick.length === 0) return [...hand];

    const lead = this.currentTrick[0].card.suit;
    const same = hand.filter((c) => c.suit === lead);
    if (same.length) return same;
    if (this.trump) {
      const trumps = hand.filter((c) => c.suit === this.trump);
      if (trumps.length) return trumps;
    }
    return [...hand];
  }

  playCard(player: number, cardId: string, declareMarriage?: Suit | null): void {
    this.assertPhase('play');
    this.assertTurn(player);

    const legal = this.legalCards(player);
    const card = legal.find((c) => c.id === cardId);
    if (!card) throw new Error('Нельзя сыграть эту карту');

    const availableMarriage = (card.rank === 'K' || card.rank === 'Q') &&
      this.declarableMarriages(player).includes(card.suit) ? card.suit : undefined;
    const marriage = declareMarriage === undefined ? availableMarriage : declareMarriage ?? undefined;
    if (marriage) {
      if (marriage !== availableMarriage) {
        throw new Error('Этот марьяж сейчас объявить нельзя');
      }
      this.marriagesDeclared[player].push(marriage);
      this.trump = marriage;
      this.message = `${this.players[player].name} захвалил ${MARRIAGE_POINTS[marriage]} (${marriage})! Козырь установлен.`;
    }

    // Убрать с руки
    const idx = this.hands[player].findIndex((c) => c.id === cardId);
    this.hands[player].splice(idx, 1);

    this.currentTrick.push({ player, card, marriage });
    if (!marriage) {
      this.message = `${this.players[player].name}: ${card.rank}${card.suit}`;
    }

    if (this.currentTrick.length < 3) {
      this.whoseTurn = this.nextActiveSeat(player);
      return;
    }

    // Определить победителя взятки
    const winner = this.resolveTrick();
    const cards = this.currentTrick.map((t) => t.card);
    this.tricks[winner].push(cards);
    this.wonTrickThisDeal[winner] = true;
    {
      const who = this.players[winner].name;
      const verb = who === 'Вы' ? 'берёте' : 'берёт';
      this.message = `${who} ${verb} взятку (${handPoints(cards)} очк.)`;
    }
    this.lastTrick = this.currentTrick;
    this.lastTrickWinner = winner;
    this.currentTrick = [];
    this.trickLeader = winner;
    this.whoseTurn = winner;

    // Конец розыгрыша?
    if (this.hands.every((h) => h.length === 0)) {
      this.finishRound();
    }
  }

  private resolveTrick(): number {
    const leadSuit = this.currentTrick[0].card.suit;
    let best = this.currentTrick[0];
    for (let i = 1; i < this.currentTrick.length; i++) {
      const t = this.currentTrick[i];
      if (this.trump) {
        const bestIsTrump = best.card.suit === this.trump;
        const curIsTrump = t.card.suit === this.trump;
        if (curIsTrump && !bestIsTrump) {
          best = t;
        } else if (curIsTrump && bestIsTrump) {
          if (compareInSuit(t.card, best.card) > 0) best = t;
        } else if (!curIsTrump && !bestIsTrump) {
          if (t.card.suit === leadSuit && best.card.suit === leadSuit) {
            if (compareInSuit(t.card, best.card) > 0) best = t;
          } else if (t.card.suit === leadSuit && best.card.suit !== leadSuit) {
            best = t;
          }
        }
      } else {
        if (t.card.suit === leadSuit && best.card.suit === leadSuit) {
          if (compareInSuit(t.card, best.card) > 0) best = t;
        } else if (t.card.suit === leadSuit && best.card.suit !== leadSuit) {
          best = t;
        }
      }
    }
    return best.player;
  }

  private roundPoints(): number[] {
    const points = this.players.map((_, i) => {
      const trickPts = this.tricks[i].reduce(
        (s, t) => s + t.reduce((ss, c) => ss + cardPoints(c), 0),
        0,
      );
      const marPts = this.marriagesDeclared[i].reduce((s, suit) => s + MARRIAGE_POINTS[suit], 0);
      return trickPts + marPts;
    });
    const sittingOut = this.sittingOut;
    if (sittingOut !== null && (this.phase === 'roundend' || this.phase === 'gameover')) {
      points[sittingOut] = this.dealerPoints();
    }
    return points;
  }

  private dealerPoints(): number {
    return handPoints(this.talon) +
        findMarriages(this.talon).reduce((sum, suit) => sum + MARRIAGE_POINTS[suit], 0);
  }

  private finishRound(): void {
    const raw = this.roundPoints();
    const sittingOut = this.sittingOut;
    if (sittingOut !== null) {
      raw[sittingOut] = this.dealerPoints();
    }

    const result = applyRoundScoring({
      rawPoints: raw,
      bidderIndex: this.bidder!,
      order: this.order!,
      before: this.scores,
      sittingOut,
    });

    this.lastDeltas = result.after.map((score, i) => score.total - this.scores[i].total);
    this.scores = result.after;
    this.lastRoundNotes = result.notes;
    this.winner = result.winnerIndex;
    this.phase = this.winner !== null ? 'gameover' : 'roundend';
    this.whoseTurn = null;
    this.message =
      `Итог сдачи: ${raw.map((p, i) => `${this.players[i].name} ${p}`).join(', ')}. ` +
      result.notes.join(' ');
  }

  nextDeal(): void {
    if (this.phase !== 'roundend') throw new Error('Рано начинать новую сдачу');
    this.dealer = (this.dealer + 1) % this.players.length;
    this.startDeal();
  }

  getPublicView(): PublicGameView {
    return {
      phase: this.phase,
      players: this.players,
      scores: this.scores.map((s) => ({ ...s })),
      dealer: this.dealer,
      sittingOut: this.sittingOut,
      firstHand: this.firstHand,
      bid: this.bid,
      bidder: this.bidder,
      passed: [...this.passed],
      trump: this.trump,
      currentTrick: this.currentTrick.map((t) => ({ ...t })),
      lastTrick: this.lastTrick.map((t) => ({ ...t })),
      lastTrickWinner: this.lastTrickWinner,
      trickLeader: this.trickLeader,
      whoseTurn: this.whoseTurn,
      handSizes: this.hands.map((h) => h.length),
      talon: this.phase === 'idle' || this.phase === 'bidding' ? undefined : [...this.talon],
      order: this.order,
      roundPoints: this.roundPoints(),
      marriagesDeclared: this.marriagesDeclared.map((m) => [...m]),
      tricksWon: this.tricks.map((t) => t.length),
      message: this.message,
      winner: this.winner,
      dealNumber: this.dealNumber,
    };
  }

  getPrivateView(player: number): PrivateView {
    const pub = this.getPublicView();
    return {
      ...pub,
      hand: sortHand(this.hands[player]),
      legalCardIds: this.legalCards(player).map((c) => c.id),
      canDeclareMarriage: this.declarableMarriages(player),
      maxBid: this.maxBid(player),
      discardTargets: this.phase === 'discard' && player === this.bidder ? [...this.discardQueue] : undefined,
      orderOptions: this.phase === 'order' ? this.orderOptions(player) : [],
    };
  }

  private assertPhase(p: Phase): void {
    if (this.phase !== p) throw new Error(`Сейчас фаза ${this.phase}, ожидалась ${p}`);
  }

  private assertTurn(player: number): void {
    if (this.whoseTurn !== player) throw new Error('Сейчас не ваш ход');
  }
}

export { roundToFive };
