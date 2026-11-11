import {
  TysyachaGame,
  runBotsUntilHuman,
  SUIT_SYMBOL,
  RANK_RU,
  MARRIAGE_POINTS,
} from './game-core.js';

const HUMAN = 0;
let game = null;
let pendingMarriage = null;
let animateHand = true;

const el = {
  scores: document.getElementById('scores'),
  opponents: document.getElementById('opponents'),
  trick: document.getElementById('trick'),
  hand: document.getElementById('hand'),
  status: document.getElementById('status'),
  bidPill: document.getElementById('bidPill'),
  actions: document.getElementById('actions'),
  log: document.getElementById('log'),
  topMeta: document.getElementById('topMeta'),
  btnNew: document.getElementById('btnNew'),
  btnNext: document.getElementById('btnNext'),
  btnRules: document.getElementById('btnRules'),
  btnCloseRules: document.getElementById('btnCloseRules'),
  rulesDialog: document.getElementById('rulesDialog'),
};

try {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#0c2419');
    tg.setBackgroundColor?.('#0c2419');
  }
} catch {
  /* вне Telegram */
}

function log(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  el.log.prepend(d);
}

function isRed(suit) {
  return suit === 'hearts' || suit === 'diamonds';
}

function cardNode(card, opts = {}) {
  const div = document.createElement('button');
  div.type = 'button';
  div.className = `card${isRed(card.suit) ? ' red' : ''}${opts.playable ? ' playable' : ''}${opts.dim ? ' dim' : ''}${opts.trick ? ' trick-card' : ''}${opts.talon ? ' talon' : ''}`;
  if (opts.i != null) div.style.setProperty('--i', String(opts.i));
  div.innerHTML = `
    <span class="r">${RANK_RU[card.rank]}</span>
    <span class="s">${SUIT_SYMBOL[card.suit]}</span>
    <span class="big">${SUIT_SYMBOL[card.suit]}</span>
    <span class="r2">${RANK_RU[card.rank]}${SUIT_SYMBOL[card.suit]}</span>
  `;
  if (opts.onClick) div.addEventListener('click', opts.onClick);
  return div;
}

function render() {
  if (!game) return;
  const view = game.getPrivateView(HUMAN);

  el.topMeta.textContent = `Сдача ${view.dealNumber}` + (view.trump ? ` · козырь ${SUIT_SYMBOL[view.trump]}` : '');
  el.status.textContent = view.message;
  el.bidPill.textContent = view.order
    ? `Заказ ${view.order} (торг ${view.bid})`
    : `Ставка ${view.bid}`;

  el.scores.innerHTML = '';
  view.players.forEach((p, i) => {
    const s = view.scores[i];
    const div = document.createElement('div');
    div.className = `score${view.whoseTurn === i ? ' active' : ''}`;
    const meta = [
      s.onBarrel ? 'бочка' : null,
      s.bolts ? `болты ${s.bolts}` : null,
      view.bidder === i ? `играет` : null,
      `взятки ${view.roundPoints[i]}`,
    ]
      .filter(Boolean)
      .join(' · ');
    div.innerHTML = `<div><div class="name">${p.name}</div><div class="meta">${meta}</div></div><div class="pts">${s.total}</div>`;
    el.scores.appendChild(div);
  });

  // Соперники
  el.opponents.innerHTML = '';
  [1, 2].forEach((i) => {
    const wrap = document.createElement('div');
    wrap.className = 'opp';
    const name = document.createElement('div');
    name.className = 'opp-name';
    name.textContent = view.players[i].name + (view.whoseTurn === i ? ' ●' : '');
    const cards = document.createElement('div');
    cards.className = 'opp-cards';
    for (let n = 0; n < view.handSizes[i]; n++) {
      const b = document.createElement('div');
      b.className = 'mini-back';
      cards.appendChild(b);
    }
    wrap.append(name, cards);
    el.opponents.appendChild(wrap);
  });

  // Центр: взятка или прикуп
  el.trick.innerHTML = '';
  if (view.currentTrick.length) {
    view.currentTrick.forEach((t) => el.trick.appendChild(cardNode(t.card, { trick: true })));
  } else if (view.talon) {
    view.talon.forEach((c, i) => el.trick.appendChild(cardNode(c, { talon: true, i })));
  }

  // Рука
  el.hand.innerHTML = '';
  el.hand.classList.toggle('no-deal-anim', !animateHand);
  const legal = new Set(view.legalCardIds);
  const canClick =
    view.whoseTurn === HUMAN && (view.phase === 'play' || view.phase === 'discard');
  view.hand.forEach((c, i) => {
    const playable = canClick && (view.phase === 'discard' || legal.has(c.id));
    const dim = view.phase === 'play' && legal.size && !legal.has(c.id);
    el.hand.appendChild(
      cardNode(c, {
        playable,
        dim,
        i,
        onClick: playable
          ? () => onCardClick(c, view)
          : undefined,
      }),
    );
  });
  if (animateHand) {
    // анимация раздачи только один раз за сдачу
    requestAnimationFrame(() => {
      animateHand = false;
    });
  }

  // Действия
  el.actions.innerHTML = '';
  if (view.phase === 'bidding' && view.whoseTurn === HUMAN) {
    const raise = document.createElement('button');
    raise.className = 'btn primary';
    raise.textContent = `+5 → ${view.bid + 5}`;
    raise.disabled = view.bid + 5 > view.maxBid;
    raise.onclick = () => act(() => game.placeBid(HUMAN, view.bid + 5));
    const pass = document.createElement('button');
    pass.className = 'btn';
    pass.textContent = 'Пас';
    pass.onclick = () => act(() => game.placeBid(HUMAN, 'pass'));
    const info = document.createElement('div');
    info.style.cssText = 'width:100%;font-size:0.8rem;color:#d7e6dc;opacity:.85';
    info.textContent = `Макс. по картам: ${view.maxBid}`;
    el.actions.append(raise, pass, info);
  }

  if (view.phase === 'order' && view.whoseTurn === HUMAN) {
    const options = view.orderOptions?.length
      ? view.orderOptions
      : (() => {
          const max = Math.max(view.bid, view.maxBid);
          const list = [];
          for (let v = view.bid; v <= max; v += 5) list.push(v);
          return list;
        })();
    // Не засоряем панель: ставка, несколько шагов и максимум
    const shown = new Set();
    const picks = [];
    for (const v of options) {
      if (
        v === view.bid ||
        v === options[options.length - 1] ||
        v === view.bid + 5 ||
        v === view.bid + 10 ||
        v === view.bid + 20 ||
        v === view.bid + 40 ||
        v % 20 === 0
      ) {
        if (!shown.has(v)) {
          shown.add(v);
          picks.push(v);
        }
      }
    }
    picks.forEach((val, idx) => {
      const b = document.createElement('button');
      b.className = idx === 0 ? 'btn primary' : 'btn';
      b.textContent = String(val);
      b.onclick = () => act(() => game.setOrder(HUMAN, val));
      el.actions.appendChild(b);
    });
    const info = document.createElement('div');
    info.style.cssText = 'width:100%;font-size:0.8rem;color:#d7e6dc;opacity:.85';
    info.textContent = `Диапазон заказа: ${view.bid}–${options[options.length - 1]}`;
    el.actions.appendChild(info);
  }

  if (view.phase === 'play' && view.canDeclareMarriage.length) {
    view.canDeclareMarriage.forEach((suit) => {
      const b = document.createElement('button');
      b.className = `btn${pendingMarriage === suit ? ' primary' : ''}`;
      b.textContent = `Хваль ${SUIT_SYMBOL[suit]} ${MARRIAGE_POINTS[suit]}`;
      b.onclick = () => {
        pendingMarriage = pendingMarriage === suit ? null : suit;
        render();
      };
      el.actions.appendChild(b);
    });
    if (pendingMarriage) {
      const hint = document.createElement('div');
      hint.style.cssText = 'width:100%;font-size:0.8rem;color:#e2c36a';
      hint.textContent = 'Выберите короля или даму этой масти';
      el.actions.appendChild(hint);
    }
  }

  if (view.phase === 'discard' && view.whoseTurn === HUMAN) {
    const hint = document.createElement('div');
    hint.style.cssText = 'width:100%;font-size:0.85rem;color:#d7e6dc';
    const t = view.discardTargets?.[0];
    hint.textContent = t != null ? `Снесите карту → ${view.players[t].name}` : 'Снос';
    el.actions.appendChild(hint);
  }

  el.btnNext.hidden = view.phase !== 'roundend';
  if (view.phase === 'roundend' || view.phase === 'gameover') {
    view.lastRoundNotes?.forEach((n) => log(n));
  }
  if (view.phase === 'gameover' && view.winner != null) {
    el.status.textContent = `Победа: ${view.players[view.winner].name}!`;
  }
}

function onCardClick(card, view) {
  if (view.phase === 'discard') {
    act(() => game.discardCard(HUMAN, card.id));
    return;
  }
  if (view.phase === 'play') {
    const declare =
      pendingMarriage &&
      card.suit === pendingMarriage &&
      (card.rank === 'K' || card.rank === 'Q')
        ? pendingMarriage
        : null;
    act(() => {
      game.playCard(HUMAN, card.id, declare);
      pendingMarriage = null;
    });
  }
}

function act(fn) {
  try {
    fn();
    runBotsUntilHuman(game, HUMAN);
    // иногда после сноса/заказа бот ходит сразу несколькими шагами
    runBotsUntilHuman(game, HUMAN);
    render();
  } catch (e) {
    log(String(e.message || e));
    render();
  }
}

function newGame() {
  game = new TysyachaGame([
    { id: 'human', name: 'Вы', isBot: false },
    { id: 'bot1', name: 'Север', isBot: true },
    { id: 'bot2', name: 'Восток', isBot: true },
  ]);
  pendingMarriage = null;
  animateHand = true;
  el.log.innerHTML = '';
  game.startGame(Math.floor(Math.random() * 3));
  log('Новая партия. Удачи за столом!');
  runBotsUntilHuman(game, HUMAN);
  render();
}

el.btnNew.addEventListener('click', newGame);
el.btnNext.addEventListener('click', () => {
  animateHand = true;
  act(() => game.nextDeal());
});
el.btnRules.addEventListener('click', () => el.rulesDialog.showModal());
el.btnCloseRules.addEventListener('click', () => el.rulesDialog.close());

newGame();
