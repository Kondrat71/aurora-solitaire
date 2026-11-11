/** Текстовая и клавиатурная визуализация для Telegram. */

import { InlineKeyboard } from 'grammy';
import type { PrivateView } from '../game/engine.ts';
import {
  formatCard,
  formatCards,
  SUIT_SYMBOL,
  MARRIAGE_POINTS,
  SUIT_NAME_RU,
  type Card,
  type Suit,
} from '../game/cards.ts';

const PHASE_RU: Record<string, string> = {
  idle: 'ожидание',
  bidding: 'торговля',
  talonshow: 'прикуп',
  discard: 'снос',
  order: 'заказ',
  play: 'розыгрыш',
  roundend: 'итог сдачи',
  gameover: 'партия окончена',
};

export function scoreBlock(view: PrivateView): string {
  return view.players
    .map((p, i) => {
      const s = view.scores[i];
      const flags = [
        s.onBarrel ? '🏔 бочка' : '',
        s.bolts ? `болты ${s.bolts}` : '',
        view.bidder === i ? 'играет' : '',
        view.whoseTurn === i ? '← ход' : '',
      ]
        .filter(Boolean)
        .join(', ');
      return `• <b>${tableName(p.name)}</b> · <b>${scoreText(s.total)}</b> всего · ${view.roundPoints[i]} за сдачу${flags ? ` (${flags})` : ''}`;
    })
    .join('\n');
}

export function formatStatus(view: PrivateView, webUrl?: string): string {
  const trump = view.trump ? `\nКозырь: <b>${SUIT_SYMBOL[view.trump]} ${SUIT_NAME_RU[view.trump]}</b>` : '';
  const order = view.order != null ? ` · заказ <b>${view.order}</b>` : '';
  const lines = [
    `<b>Тысяча</b> · сдача ${view.dealNumber} · ${PHASE_RU[view.phase] ?? view.phase}`,
    `Ставка <b>${view.bid}</b>${order}${trump}`,
    '',
    scoreBlock(view),
    '',
  ];
  if (view.winner !== null) lines.push(`🏆 ${tableName(view.players[view.winner].name)}`);
  if (view.whoseTurn === 0) {
    lines.push('🟢 <b>Ваш ход</b>');
    const target = view.discardTargets?.[0];
    if (target !== undefined) lines.push(`Выберите карту для игрока ${tableName(view.players[target].name)}.`);
  } else if (view.whoseTurn !== null) {
    lines.push(`Ходит <b>${tableName(view.players[view.whoseTurn].name)}</b>`);
  }

  if (view.talon?.length) {
    lines.push('', `<b>Прикуп:</b> ${formatCards(view.talon)}`);
  }
  const marriages = view.marriagesDeclared.flatMap((suits, i) =>
    suits.map((suit) => `${tableName(view.players[i].name)} ${SUIT_SYMBOL[suit]}+${MARRIAGE_POINTS[suit]}`));
  if (marriages.length) lines.push(`<b>Марьяжи</b> ${marriages.join(' · ')}`);
  if (view.currentTrick.length) {
    lines.push(
      '',
      '<b>На столе:</b> ' +
        view.currentTrick.map((t) => `${escapeHtml(view.players[t.player].name)} ${formatCard(t.card)}`).join(' · '),
    );
  }
  lines.push('', `<b>Ваши карты:</b>\n${formatCards(view.hand) || '—'}`);

  if (view.canDeclareMarriage.length) {
    lines.push('Кнопка с +очками объявит марьяж.');
  }

  if (webUrl) {
    lines.push('', `<a href="${escapeHtml(webUrl).replace(/"/g, '&quot;')}">Веб-демо</a>`);
  }

  return lines.join('\n');
}

export function buildKeyboard(view: PrivateView, humanIndex: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const myTurn = view.whoseTurn === humanIndex;

  if (view.phase === 'bidding' && myTurn) {
    const next = view.bid + 5;
    if (next <= view.maxBid) kb.text(`⬆️ ${next}`, `bid:${next}`);
    kb.text('Пас', 'bid:pass').row();
  }

  if (view.phase === 'order' && myTurn) {
    const options = view.orderOptions.length
      ? view.orderOptions
      : [view.bid];
    const picks = new Set<number>();
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
        picks.add(v);
      }
    }
    [...picks].sort((a, b) => a - b).forEach((val, i) => {
      kb.text(String(val), `order:${val}`);
      if ((i + 1) % 4 === 0) kb.row();
    });
    kb.row();
  }

  if (view.phase === 'discard' && myTurn) {
    view.hand.forEach((c, i) => {
      kb.text(formatCard(c), `card:${c.id}`);
      if ((i + 1) % 4 === 0) kb.row();
    });
    kb.row();
  }

  if (view.phase === 'play' && myTurn) {
    const legal = new Set(view.legalCardIds);
    view.hand
      .filter((c) => legal.has(c.id))
      .forEach((c, i) => {
        kb.text(cardAction(c, view.canDeclareMarriage), `card:${c.id}`);
        if ((i + 1) % 4 === 0) kb.row();
      });
    kb.row();
  }

  if (view.phase === 'roundend') {
    kb.text('➡️ Следующая сдача', 'next').row();
  }

  kb.text('🔄 Новая партия', 'new').text('📖 Правила', 'rules');
  return kb;
}

export function rulesText(): string {
  return [
    '<b>Правила «Тысячи»</b> (3–4 игрока, до 1000)',
    '',
    'Колода 24 карты: 9, В, Д, К, 10, Т. Очки: 0/2/3/4/10/11. Старшинство: Т&gt;10&gt;К&gt;Д&gt;В&gt;9.',
    '',
    '<b>Торговля:</b> слева от сдающего — 100. Шаг 5. Без марьяжа не выше 120. Пас окончательный.',
    '',
    '<b>Прикуп:</b> после торгов 3 карты видны всем до конца сдачи. Победитель берёт их, передаёт по одной карте соперникам и объявляет заказ.',
    '',
    '<b>Вчетвером:</b> сдающий пропускает торги и розыгрыш. Ему записываются очки карт прикупа с округлением до 5 и стоимость марьяжа, если он есть в прикупе. После каждой сдачи роль переходит следующему игроку.',
    '',
    '<b>Розыгрыш:</b> ходите в масть; нет масти — козырь; иначе любая. Перебивать старшей не обязательно.',
    '',
    '<b>Марьяж:</b> после своей взятки начните новую взятку королём или дамой, если обе карты одной масти у вас на руках. Бот объявит марьяж автоматически. ♠40 ♣60 ♦80 ♥100 → новый козырь.',
    '',
    '<b>Запись:</b> играющий получает заказ или −заказ. Общий счёт может уйти в минус. Остальные — округление до 5. Бочка 880, выход заказом ≥120. Цель — 1000.',
  ].join('\n');
}

export function cardAction(card: Card, marriages: Suit[]): string {
  const bonus = (card.rank === 'K' || card.rank === 'Q') && marriages.includes(card.suit);
  return bonus ? `${formatCard(card)} +${MARRIAGE_POINTS[card.suit]}` : formatCard(card);
}

export function scoreText(value: number): string {
  return value < 0 ? `−${-value}` : String(value);
}

export function tableName(name: string): string {
  const chars = Array.from(name);
  return escapeHtml(chars.length > 22 ? chars.slice(0, 21).join('') + '…' : name);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
