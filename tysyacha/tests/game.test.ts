import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, findMarriages, maxBidForHand, CARD_POINTS, shuffle } from '../src/game/cards.ts';
import { roundToFive, applyRoundScoring, createScoreState } from '../src/game/scoring.ts';
import { TysyachaGame } from '../src/game/engine.ts';
import { botAct, runBotsUntilHuman } from '../src/game/ai.ts';

describe('колода', () => {
  it('24 карты, сумма очков 120', () => {
    const deck = makeDeck();
    assert.equal(deck.length, 24);
    const pts = deck.reduce((s, c) => s + CARD_POINTS[c.rank], 0);
    assert.equal(pts, 120);
  });

  it('марьяж и лимит ставки', () => {
    const hand = [
      { suit: 'hearts' as const, rank: 'K' as const, id: 'Kh' },
      { suit: 'hearts' as const, rank: 'Q' as const, id: 'Qh' },
      { suit: 'spades' as const, rank: 'A' as const, id: 'As' },
    ];
    assert.deepEqual(findMarriages(hand), ['hearts']);
    assert.equal(maxBidForHand(hand), 220);
  });
});

describe('округление', () => {
  it('до ближайших пяти', () => {
    assert.equal(roundToFive(22), 20);
    assert.equal(roundToFive(23), 25);
    assert.equal(roundToFive(27), 25);
    assert.equal(roundToFive(28), 30);
    assert.equal(roundToFive(0), 0);
  });
});

describe('запись сдачи', () => {
  it('заказ выполнен / недобор', () => {
    const before = [createScoreState(), createScoreState(), createScoreState()];
    const ok = applyRoundScoring({
      rawPoints: [130, 22, 0],
      bidderIndex: 0,
      order: 120,
      before,
    });
    assert.equal(ok.after[0].total, 120);
    assert.equal(ok.after[1].total, 20);
    assert.equal(ok.after[2].bolts, 1);

    const fail = applyRoundScoring({
      rawPoints: [119, 30, 40],
      bidderIndex: 0,
      order: 120,
      before,
    });
    assert.equal(fail.after[0].total, -120);
  });

  it('бочка на 880', () => {
    const before = [createScoreState(), createScoreState(), createScoreState()];
    before[0].total = 860;
    const r = applyRoundScoring({
      rawPoints: [40, 40, 40],
      bidderIndex: 1,
      order: 100,
      before,
    });
    // игрок 0 получил округлённые 40 → 900, но садится на бочку 880
    assert.equal(r.after[0].total, 880);
    assert.equal(r.after[0].onBarrel, true);
  });
});

describe('партия', () => {
  it('раздача: 7+7+7+3', () => {
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const g = new TysyachaGame(
      [
        { id: 'a', name: 'A', isBot: false },
        { id: 'b', name: 'B', isBot: true },
        { id: 'c', name: 'C', isBot: true },
      ],
      rng,
    );
    g.startGame(0);
    assert.equal(g.hands[0].length, 7);
    assert.equal(g.hands[1].length, 7);
    assert.equal(g.hands[2].length, 7);
    assert.equal(g.talon.length, 3);
    assert.equal(g.phase, 'bidding');
  });

  it('боты доигрывают сдачу без падений', () => {
    let seed = 42;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const g = new TysyachaGame(
      [
        { id: 'a', name: 'A', isBot: true },
        { id: 'b', name: 'B', isBot: true },
        { id: 'c', name: 'C', isBot: true },
      ],
      rng,
    );
    g.startGame(0);
    let guard = 0;
    while (g.phase !== 'roundend' && g.phase !== 'gameover' && guard++ < 500) {
      const turn = g.whoseTurn;
      if (turn == null) break;
      botAct(g, turn);
    }
    assert.ok(g.phase === 'roundend' || g.phase === 'gameover', `фаза ${g.phase}`);
    const totalRaw = [0, 1, 2].map((i) =>
      g.tricks[i].reduce((s, t) => s + t.reduce((ss, c) => ss + CARD_POINTS[c.rank], 0), 0),
    );
    // все очки карт должны распределиться (марьяжи сверху)
    assert.equal(totalRaw.reduce((a, b) => a + b, 0), 120);
  });

  it('человек+боты: runBotsUntilHuman останавливается на человеке', () => {
    const g = new TysyachaGame([
      { id: 'h', name: 'H', isBot: false },
      { id: 'b1', name: 'B1', isBot: true },
      { id: 'b2', name: 'B2', isBot: true },
    ]);
    g.startGame(2); // первая рука = 0 (человек) на стах, ход торговли у 1
    assert.equal(g.firstHand, 0);
    assert.equal(g.whoseTurn, 1);
    runBotsUntilHuman(g, 0);
    // после ходов ботов игра должна быть в осмысленной фазе
    assert.ok(['bidding', 'discard', 'order', 'play', 'roundend'].includes(g.phase));
    if (g.phase === 'bidding') {
      assert.equal(g.whoseTurn, 0);
    }
  });
});

describe('shuffle', () => {
  it('сохраняет элементы', () => {
    const d = makeDeck();
    const s = shuffle(d, () => 0.3);
    assert.equal(s.length, 24);
    assert.equal(new Set(s.map((c) => c.id)).size, 24);
  });
});
