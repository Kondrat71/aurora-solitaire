/** Карты и константы колоды для «Тысячи» (24 карты). */

export type Suit = 'spades' | 'clubs' | 'diamonds' | 'hearts';
export type Rank = '9' | 'J' | 'Q' | 'K' | '10' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  id: string;
}

export const SUITS: Suit[] = ['spades', 'clubs', 'diamonds', 'hearts'];
export const RANKS: Rank[] = ['9', 'J', 'Q', 'K', '10', 'A'];

/** Старшинство внутри масти: туз > десятка > король > дама > валет > девятка */
export const RANK_ORDER: Record<Rank, number> = {
  '9': 0,
  J: 1,
  Q: 2,
  K: 3,
  '10': 4,
  A: 5,
};

export const CARD_POINTS: Record<Rank, number> = {
  '9': 0,
  J: 2,
  Q: 3,
  K: 4,
  '10': 10,
  A: 11,
};

/** Очки за объявленный марьяж */
export const MARRIAGE_POINTS: Record<Suit, number> = {
  spades: 40,
  clubs: 60,
  diamonds: 80,
  hearts: 100,
};

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: '♠',
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
};

export const SUIT_NAME_RU: Record<Suit, string> = {
  spades: 'пики',
  clubs: 'трефы',
  diamonds: 'бубны',
  hearts: 'червы',
};

export const RANK_NAME_RU: Record<Rank, string> = {
  '9': '9',
  J: 'В',
  Q: 'Д',
  K: 'К',
  '10': '10',
  A: 'Т',
};

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: `${rank}${suit[0]}` });
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardPoints(card: Card): number {
  return CARD_POINTS[card.rank];
}

export function handPoints(cards: Card[]): number {
  return cards.reduce((s, c) => s + cardPoints(c), 0);
}

export function compareInSuit(a: Card, b: Card): number {
  return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
}

export function formatCard(card: Card): string {
  return `${RANK_NAME_RU[card.rank]}${SUIT_SYMBOL[card.suit]}`;
}

export function formatCards(cards: Card[]): string {
  return cards.map(formatCard).join(' ');
}

export function sortHand(cards: Card[]): Card[] {
  const suitOrder: Record<Suit, number> = {
    hearts: 0,
    diamonds: 1,
    clubs: 2,
    spades: 3,
  };
  return [...cards].sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
  });
}

/** Найти марьяжи на руке (король+дама одной масти) */
export function findMarriages(hand: Card[]): Suit[] {
  const bySuit = new Map<Suit, Set<Rank>>();
  for (const c of hand) {
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, new Set());
    bySuit.get(c.suit)!.add(c.rank);
  }
  const result: Suit[] = [];
  for (const suit of SUITS) {
    const ranks = bySuit.get(suit);
    if (ranks?.has('K') && ranks.has('Q')) result.push(suit);
  }
  return result;
}

export function marriageValueOnHand(hand: Card[]): number {
  return findMarriages(hand).reduce((s, suit) => s + MARRIAGE_POINTS[suit], 0);
}

export function maxBidForHand(hand: Card[]): number {
  return 120 + marriageValueOnHand(hand);
}

export function isRed(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}
