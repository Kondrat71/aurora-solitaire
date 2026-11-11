/** Изображение личного игрового стола для Telegram. */
import { isRed, RANK_NAME_RU, SUIT_SYMBOL, type Card } from '../game/cards.ts';
import type { PrivateView } from '../game/engine.ts';

const WIDTH = 760;
const CARD_WIDTH = 112;
const CARD_HEIGHT = 144;
const GAP = 12;

function escapeXml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!);
}

function cardFace(card: Card, x: number, y: number, playable: boolean, dimmed: boolean): string {
  const color = isRed(card.suit) ? '#aa2535' : '#132421';
  const rank = RANK_NAME_RU[card.rank];
  const suit = SUIT_SYMBOL[card.suit];
  return `<g transform="translate(${x} ${y})" opacity="${dimmed ? 0.6 : 1}">
    <rect x="2" y="4" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="11" fill="#061d19"/>
    <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="11" fill="#fff8e9" stroke="${playable ? '#efc36b' : '#cfc6ad'}" stroke-width="${playable ? 4 : 1}"/>
    <g fill="${color}" font-family="DejaVu Sans, sans-serif" font-weight="bold">
      <text x="11" y="36" font-size="30">${rank}</text>
      <text x="${CARD_WIDTH / 2}" y="94" font-size="55" text-anchor="middle">${suit}</text>
      <text x="${CARD_WIDTH - 11}" y="${CARD_HEIGHT - 12}" font-size="28" text-anchor="end">${rank}</text>
    </g>
  </g>`;
}

function tableLabel(label: string, x: number, y: number, centered = false): string {
  return `<text x="${x}" y="${y}" text-anchor="${centered ? 'middle' : 'start'}" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="bold" fill="#f2ddae">${escapeXml(label)}</text>`;
}

export function renderTableSvg(view: PrivateView, seat: number): string {
  const trick = view.currentTrick.length ? view.currentTrick : view.lastTrick;
  const lastTrick = !view.currentTrick.length && view.lastTrickWinner !== null;
  const hasCenter = Boolean(trick.length || view.talon?.length);
  const rows = Math.ceil(view.hand.length / 5);
  const handY = hasCenter ? 286 : 113;
  const height = handY + Math.max(rows, 1) * (CARD_HEIGHT + GAP) + 42;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`,
    '<defs><radialGradient id="felt"><stop stop-color="#276555"/><stop offset="1" stop-color="#133830"/></radialGradient></defs>',
    `<rect width="${WIDTH}" height="${height}" rx="26" fill="url(#felt)"/>`,
    `<rect x="13" y="13" width="${WIDTH - 26}" height="${height - 26}" rx="19" fill="none" stroke="#8e8153"/>`,
    tableLabel('♠  ТЫСЯЧА', 34, 55),
    `<text x="${WIDTH - 34}" y="55" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#e4e7d8">Сдача ${view.dealNumber} · Козырь ${view.trump ? SUIT_SYMBOL[view.trump] : '—'}</text>`,
  ];

  if (hasCenter) {
    if (view.talon?.length) {
      parts.push(tableLabel('Прикуп', 30, 97));
      view.talon.forEach((card, i) => parts.push(cardFace(card, 30 + i * (CARD_WIDTH + GAP), 108, false, false)));
    }
    if (trick.length) {
      const x = view.talon?.length ? WIDTH - 30 - trick.length * CARD_WIDTH - (trick.length - 1) * GAP : 30;
      // Разводим группы у края стола даже при трёх картах в каждой.
      const scale = view.talon?.length && trick.length === 3 ? 0.9 : 1;
      const start = scale < 1 ? WIDTH - 30 - (trick.length * CARD_WIDTH + (trick.length - 1) * GAP) * scale : x;
      parts.push(tableLabel(lastTrick ? 'Последняя взятка' : 'На столе', start, 97));
      parts.push(`<g transform="translate(${start} 108) scale(${scale})">`);
      trick.forEach(({ card, marriage }, i) => parts.push(cardFace(card, i * (CARD_WIDTH + GAP), 0, Boolean(marriage), false)));
      parts.push('</g>');
    }
  }

  const handLabel = rows ? 'Ваши карты' : seat === view.sittingOut ? 'Вы на прикупе' : 'Карты разыграны';
  parts.push(tableLabel(handLabel, 34, handY));
  const legal = new Set(view.legalCardIds);
  for (let row = 0; row < rows; row++) {
    const cards = view.hand.slice(row * 5, row * 5 + 5);
    const left = (WIDTH - (cards.length * CARD_WIDTH + (cards.length - 1) * GAP)) / 2;
    cards.forEach((card, i) => {
      const playable = legal.has(card.id) || (view.phase === 'discard' && view.whoseTurn === seat);
      parts.push(cardFace(card, left + i * (CARD_WIDTH + GAP), handY + 14 + row * (CARD_HEIGHT + GAP), playable, legal.size > 0 && !playable));
    });
  }
  parts.push('</svg>');
  return parts.join('\n');
}
