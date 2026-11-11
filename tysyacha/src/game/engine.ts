/**
 * Движок партии «Тысяча» (3 игрока).
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
  firstHand: number;
  bid: number;
  bidder: number | null;
  passed: boolean[];
  trump: Suit | null;
  currentTrick: TrickPlay[];
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
}

export class TysyachaGame {
  readonly players: PlayerInfo[];
  scores: PlayerScoreState[];
  phase: Phase = 'idle';
  dealer = 0;
  dealNumber = 0;
  hands: Card[][] = [[], [], []];
  talon: Card[] = [];
  bid = 100;
  bidder: number | null = null;
  passed: boolean[] = [false, false, false];
  biddingTurn = 0;
  firstHand = 0;
  trump: Suit | null = null;
  currentTrick: TrickPlay[] = [];
  trickLeader = 0;
  whoseTurn: number | null = null;
  order: number | null = null;
  /** Сколько карт ещё нужно снести и кому */
  discardQueue: number[] = [];
  marriagesDeclared: Suit[][] = [[], [], []];
  tricks: Card[][][] = [[], [], []];
  wonTrickThisDeal: boolean[] = [false, false, false];
  message = '';
  winner: number | null = null;
  lastRoundNotes: string[] = [];
  lastDeltas: number[] = [0, 0, 0];
  private rng: () => number;

  constructor(players: PlayerInfo[], rng: () => number = Math.random) {
    if (players.length !== 3) throw new Error('Нужно ровно 3 игрока');
    this.players = players;
    this.scores = players.map(() => createScoreState());
    this.rng = rng;
  }

  startGame(dealer = 0): void {
    this.dealer = dealer % 3;
    this.winner = null;
    this.scores = this.players.map(() => createScoreState());
    this.startDeal();
  }

  startDeal(): void {
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
    this.lastRoundNotes = [];
    this.lastDeltas = [0, 0, 0];
    this.discardQueue = [];

    const deck = shuffle(makeDeck(), this.rng);
    this.hands = [[], [], []];
    this.talon = [];

    // Раздача: по одной карте, начиная слева от сдающего; прикуп между 1-м и последним кругом
    // Упрощённо: 7 каждому + 3 в прикуп (эквивалентный итог)
    let di = 0;
    for (let r = 0; r < 7; r++) {
      for (let p = 0; p < 3; p++) {
        const seat = (this.dealer + 1 + p) % 3;
        this.hands[seat].push(deck[di++]);
      }
      if (r === 0) {
        // после первого круга — прикуп из 3 карт
        this.talon = [deck[di++], deck[di++], deck[di++]];
      }
    }
    this.hands = this.hands.map(sortHand);

    this.firstHand = (this.dealer + 1) % 3;
    this.bidder = this.firstHand; // пока сидит на 100
    this.biddingTurn = (this.firstHand + 1) % 3;
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
      // Первая рука не может спасовать с обязательных 100, если ещё никто не поднял
      if (player === this.firstHand && this.bid === 100 && this.bidder === this.firstHand) {
        const othersActive = this.passed.filter((p, i) => i !== player && !p).length;
        // Может спасовать только на чужое повышение
        if (this.bidder === player && this.bid === 100) {
          // Если ставка всё ещё 100 и bidder — первая рука, значит никто не поднял —
          // первая рука не может отказаться от ста. Но «пас» при своей очереди после
          // того как кто-то поднял — можно. Здесь bid===100 и bidder===firstHand => нельзя.
          throw new Error('Первая рука обязана играть минимум 100, пока ставку не перебили');
        }
        void othersActive;
      }
      // Если кто-то уже поднял выше 100, первая рука может пасовать
      if (player === this.firstHand && this.bid === 100 && this.bidder === this.firstHand) {
        throw new Error('Нельзя спасовать с обязательных ста, пока ставку не перебили');
      }

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
    const active = [0, 1, 2].filter((i) => !this.passed[i]);
    if (active.length === 1) {
      this.bidder = active[0];
      this.finishBidding();
      return;
    }
    // Следующий не спасовавший
    let next = (this.whoseTurn! + 1) % 3;
    for (let i = 0; i < 3; i++) {
      if (!this.passed[next]) break;
      next = (next + 1) % 3;
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
    const a = (this.bidder + 1) % 3;
    const b = (this.bidder + 2) % 3;
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
    if (amount > this.maxBid(player) && amount > this.bid) {
      // после прикупа марьяжи могли измениться — считаем по новой руке
      if (amount > maxBidForHand(this.hands[player]) && amount > this.bid) {
        // Разрешаем заказ = bid даже если выше теоретического макса после сноса
      }
    }
    // На бочке минимум 120 для выхода, но заказ <120 тоже можно (попытка)
    this.order = amount;
    this.phase = 'play';
    this.trickLeader = this.bidder!;
    this.whoseTurn = this.bidder;
    this.currentTrick = [];
    this.message = `Заказ: ${amount}. Ходит ${this.players[this.bidder!].name}`;
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

    let marriage: Suit | undefined;
    if (this.currentTrick.length === 0 && declareMarriage) {
      const can = this.declarableMarriages(player);
      if (!can.includes(declareMarriage)) {
        throw new Error('Этот марьяж сейчас объявить нельзя');
      }
      if (card.suit !== declareMarriage || (card.rank !== 'K' && card.rank !== 'Q')) {
        throw new Error('Для марьяжа нужно зайти королём или дамой этой масти');
      }
      marriage = declareMarriage;
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
      this.whoseTurn = (player + 1) % 3;
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

  private finishRound(): void {
    const raw = [0, 1, 2].map((i) => {
      const trickPts = this.tricks[i].reduce(
        (s, t) => s + t.reduce((ss, c) => ss + cardPoints(c), 0),
        0,
      );
      const marPts = this.marriagesDeclared[i].reduce((s, suit) => s + MARRIAGE_POINTS[suit], 0);
      return trickPts + marPts;
    });

    const result = applyRoundScoring({
      rawPoints: raw,
      bidderIndex: this.bidder!,
      order: this.order!,
      before: this.scores,
    });

    this.scores = result.after;
    this.lastDeltas = result.deltas;
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
    this.dealer = (this.dealer + 1) % 3;
    this.startDeal();
  }

  getPublicView(): PublicGameView {
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
      trickLeader: this.trickLeader,
      whoseTurn: this.whoseTurn,
      handSizes: this.hands.map((h) => h.length),
      talon: this.phase === 'discard' || this.phase === 'talonshow' ? [...this.talon] : undefined,
      order: this.order,
      roundPoints: [0, 1, 2].map((i) => {
        const trickPts = this.tricks[i].reduce(
          (s, t) => s + t.reduce((ss, c) => ss + cardPoints(c), 0),
          0,
        );
        const marPts = this.marriagesDeclared[i].reduce((s, suit) => s + MARRIAGE_POINTS[suit], 0);
        return trickPts + marPts;
      }),
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
