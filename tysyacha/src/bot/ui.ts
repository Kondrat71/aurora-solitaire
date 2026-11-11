/** Текстовая и клавиатурная визуализация для Telegram. */

import { InlineKeyboard } from 'grammy';
import type { PrivateView } from '../game/engine.ts';
import {
  formatCard,
  formatCards,
  SUIT_SYMBOL,
  MARRIAGE_POINTS,
  SUIT_NAME_RU,
  type Suit,
} from '../game/cards.ts';
import { renderTableSvg } from '../render/svg.ts';

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
      return `• <b>${escapeHtml(p.name)}</b>: <b>${s.total}</b>${flags ? ` (${flags})` : ''} · взятки ${view.roundPoints[i]}`;
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
    escapeHtml(view.message),
  ];

  if (view.talon?.length) {
    lines.push('', `<b>Прикуп:</b> ${formatCards(view.talon)}`);
  }
  if (view.currentTrick.length) {
    lines.push(
      '',
      '<b>На столе:</b> ' +
        view.currentTrick.map((t) => `${escapeHtml(view.players[t.player].name)} ${formatCard(t.card)}`).join(' · '),
    );
  }
  lines.push('', `<b>Ваши карты:</b>\n${formatCards(view.hand) || '—'}`);

  if (view.canDeclareMarriage.length) {
    lines.push(
      '',
      'Можно захвалить: ' +
        view.canDeclareMarriage.map((s) => `${SUIT_SYMBOL[s]} ${MARRIAGE_POINTS[s]}`).join(', '),
    );
  }

  if (webUrl) {
    lines.push('', `🖼 <a href="${webUrl}">Открыть красивый стол</a>`);
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
    if (view.canDeclareMarriage.length) {
      for (const s of view.canDeclareMarriage as Suit[]) {
        kb.text(`❤️‍🔥 ${SUIT_SYMBOL[s]}${MARRIAGE_POINTS[s]}`, `marry:${s}`).row();
      }
    }
    const legal = new Set(view.legalCardIds);
    view.hand
      .filter((c) => legal.has(c.id))
      .forEach((c, i) => {
        kb.text(formatCard(c), `card:${c.id}`);
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
    '<b>Прикуп:</b> победитель берёт 3 карты, сносит по одной соперникам, заказывает ≥ ставки.',
    '',
    '<b>Вчетвером:</b> сдающий пропускает торги и розыгрыш. Ему записываются очки карт прикупа с округлением до 5 и стоимость марьяжа, если он есть в прикупе. После каждой сдачи роль переходит следующему игроку.',
    '',
    '<b>Розыгрыш:</b> ходите в масть; нет масти — козырь; иначе любая. Перебивать старшей не обязательно.',
    '',
    '<b>Марьяж:</b> после своей взятки зайдите К/Д масти и объявите. ♠40 ♣60 ♦80 ♥100 → новый козырь.',
    '',
    '<b>Запись:</b> играющий получает заказ или −заказ. Остальные — округление до 5. Бочка 880, выход заказом ≥120. Цель — 1000.',
  ].join('\n');
}

export function tableSvgFor(view: PrivateView, playerIndex: number): string {
  return renderTableSvg(view, playerIndex);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
