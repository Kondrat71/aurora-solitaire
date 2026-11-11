/** SVG-визуализация карточного стола «Тысяча». */

import type { Card, Suit } from '../game/cards.ts';
import {
  SUIT_SYMBOL,
  RANK_NAME_RU,
  isRed,
  SUIT_NAME_RU,
  MARRIAGE_POINTS,
} from '../game/cards.ts';
import type { PrivateView, TrickPlay } from '../game/engine.ts';

const W = 900;
const H = 640;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function cardSvg(
  card: Card,
  x: number,
  y: number,
  w = 72,
  h = 104,
  opts: { highlight?: boolean; dim?: boolean; small?: boolean } = {},
): string {
  const red = isRed(card.suit);
  const color = red ? '#c0392b' : '#1a1a1a';
  const glow = opts.highlight
    ? `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="10" fill="none" stroke="#f0c75e" stroke-width="3" opacity="0.95"/>`
    : '';
  const opacity = opts.dim ? '0.45' : '1';
  const rank = RANK_NAME_RU[card.rank];
  const sym = SUIT_SYMBOL[card.suit];
  const fs = opts.small ? 14 : 18;
  const fs2 = opts.small ? 22 : 28;

  return `${glow}
  <g opacity="${opacity}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#f7f1e5" stroke="#2c1810" stroke-width="1.5"/>
    <rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="5" fill="none" stroke="#d4c4a8" stroke-width="1"/>
    <text x="${x + 8}" y="${y + 22}" font-family="Georgia, 'Times New Roman', serif" font-size="${fs}" font-weight="700" fill="${color}">${esc(rank)}</text>
    <text x="${x + 8}" y="${y + 42}" font-family="Georgia, serif" font-size="${fs}" fill="${color}">${sym}</text>
    <text x="${x + w / 2}" y="${y + h / 2 + 10}" text-anchor="middle" font-family="Georgia, serif" font-size="${fs2}" fill="${color}">${sym}</text>
    <text x="${x + w - 8}" y="${y + h - 28}" text-anchor="end" font-family="Georgia, serif" font-size="${fs}" fill="${color}">${sym}</text>
    <text x="${x + w - 8}" y="${y + h - 10}" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-size="${fs}" font-weight="700" fill="${color}">${esc(rank)}</text>
  </g>`;
}

function backSvg(x: number, y: number, w = 56, h = 80): string {
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="#1e3d2f" stroke="#0d2218" stroke-width="1.5"/>
  <rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="4" fill="none" stroke="#c9a227" stroke-width="1.2"/>
  <pattern id="diam${Math.round(x)}${Math.round(y)}" width="8" height="8" patternUnits="userSpaceOnUse">
    <path d="M0,4 L4,0 L8,4 L4,8 Z" fill="#2a5644" opacity="0.5"/>
  </pattern>
  <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="3" fill="url(#diam${Math.round(x)}${Math.round(y)})"/>
  <text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="#c9a227">Т</text>`;
}

function scoreBadge(x: number, y: number, name: string, score: number, extra: string, active: boolean): string {
  const bg = active ? '#1a4d3a' : '#143328';
  const ring = active ? '#f0c75e' : '#2d5a45';
  return `
  <rect x="${x}" y="${y}" width="200" height="56" rx="12" fill="${bg}" stroke="${ring}" stroke-width="${active ? 2.5 : 1}"/>
  <text x="${x + 14}" y="${y + 24}" font-family="'Segoe UI', system-ui, sans-serif" font-size="15" font-weight="600" fill="#f5efe3">${esc(name)}</text>
  <text x="${x + 14}" y="${y + 44}" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#b8d4c4">${esc(extra)}</text>
  <text x="${x + 186}" y="${y + 36}" text-anchor="end" font-family="Georgia, serif" font-size="22" font-weight="700" fill="#f0c75e">${score}</text>`;
}

export function renderTableSvg(view: PrivateView, playerIndex: number): string {
  const parts: string[] = [];

  // Фон — сукно
  parts.push(`
  <defs>
    <radialGradient id="felt" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#2f6b4f"/>
      <stop offset="70%" stop-color="#1a4533"/>
      <stop offset="100%" stop-color="#0e2a1e"/>
    </radialGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5c3a21"/>
      <stop offset="50%" stop-color="#3d2414"/>
      <stop offset="100%" stop-color="#2a160c"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wood)"/>
  <ellipse cx="${W / 2}" cy="${H / 2 + 10}" rx="390" ry="270" fill="url(#felt)" filter="url(#soft)"/>
  <ellipse cx="${W / 2}" cy="${H / 2 + 10}" rx="390" ry="270" fill="none" stroke="#c9a227" stroke-width="3" opacity="0.35"/>
  `);

  // Заголовок
  const phaseRu: Record<string, string> = {
    idle: 'Ожидание',
    bidding: 'Торговля',
    talonshow: 'Прикуп',
    discard: 'Снос',
    order: 'Заказ',
    play: 'Розыгрыш',
    roundend: 'Итог сдачи',
    gameover: 'Партия окончена',
  };
  parts.push(`
  <text x="40" y="36" font-family="Georgia, serif" font-size="26" font-weight="700" fill="#f0c75e">Тысяча</text>
  <text x="160" y="34" font-family="'Segoe UI', sans-serif" font-size="14" fill="#d4c4a8">сдача №${view.dealNumber} · ${phaseRu[view.phase] ?? view.phase}</text>
  `);

  if (view.trump) {
    parts.push(`
    <g>
      <rect x="740" y="14" width="130" height="36" rx="18" fill="#1a4533" stroke="#f0c75e" stroke-width="1.5"/>
      <text x="805" y="38" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="#f0c75e">Козырь ${SUIT_SYMBOL[view.trump]}</text>
    </g>`);
  }

  // Счёт игроков
  for (let i = 0; i < 3; i++) {
    const p = view.players[i];
    const s = view.scores[i];
    const extra = [
      s.onBarrel ? 'бочка' : '',
      s.bolts ? `болты ${s.bolts}` : '',
      view.bidder === i ? `заказ ${view.order ?? view.bid}` : '',
      `взятки ${view.roundPoints[i]}`,
    ]
      .filter(Boolean)
      .join(' · ');
    const x = 40 + i * 220;
    parts.push(scoreBadge(x, 52, p.name, s.total, extra || '—', view.whoseTurn === i));
  }

  // Соперники сверху (рубашки)
  const left = (playerIndex + 2) % 3;
  const right = (playerIndex + 1) % 3;
  const drawOpp = (idx: number, cx: number) => {
    const n = view.handSizes[idx];
    const start = cx - (n * 18) / 2;
    for (let i = 0; i < n; i++) {
      parts.push(backSvg(start + i * 18, 130, 48, 70));
    }
    parts.push(`
      <text x="${cx}" y="220" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="13" fill="#d4c4a8">${esc(view.players[idx].name)}</text>
    `);
  };
  drawOpp(left, 220);
  drawOpp(right, 680);

  // Прикуп / текущая взятка в центре
  const trick: TrickPlay[] = view.currentTrick;
  if (trick.length) {
    trick.forEach((t, i) => {
      const angle = [-40, 0, 40][i] ?? 0;
      const x = 380 + i * 70;
      const y = 260;
      parts.push(`<g transform="rotate(${angle} ${x + 36} ${y + 52})">${cardSvg(t.card, x, y)}</g>`);
    });
  } else if (view.talon && (view.phase === 'discard' || view.phase === 'talonshow')) {
    view.talon.forEach((c, i) => {
      parts.push(cardSvg(c, 340 + i * 80, 270));
    });
    parts.push(`
      <text x="450" y="400" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="14" fill="#f0c75e">Прикуп</text>
    `);
  } else {
    parts.push(`
      <text x="450" y="320" text-anchor="middle" font-family="Georgia, serif" font-size="18" fill="#8fb89a" opacity="0.7">${esc(view.message.slice(0, 60))}</text>
    `);
  }

  // Ставка
  parts.push(`
  <rect x="380" y="200" width="140" height="32" rx="16" fill="#0e2a1e" stroke="#2d5a45"/>
  <text x="450" y="221" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="14" fill="#f0c75e">Ставка ${view.bid}${view.order ? ` → ${view.order}` : ''}</text>
  `);

  // Рука игрока
  const hand = view.hand;
  const legal = new Set(view.legalCardIds);
  const hw = 72;
  const gap = hand.length > 8 ? 58 : 76;
  const totalW = (hand.length - 1) * gap + hw;
  const startX = (W - totalW) / 2;
  hand.forEach((c, i) => {
    const hl = legal.has(c.id) && (view.phase === 'play' || view.phase === 'discard');
    const dim = view.phase === 'play' && legal.size > 0 && !legal.has(c.id);
    parts.push(cardSvg(c, startX + i * gap, 470, hw, 104, { highlight: hl, dim }));
  });

  parts.push(`
  <text x="450" y="600" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="13" fill="#b8d4c4">${esc(view.players[playerIndex].name)} — ваши карты</text>
  `);

  // Марьяжи к объявлению
  if (view.canDeclareMarriage.length) {
    const label = view.canDeclareMarriage
      .map((s) => `${SUIT_SYMBOL[s]} ${MARRIAGE_POINTS[s]}`)
      .join('  ');
    parts.push(`
    <text x="450" y="455" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="14" fill="#f0c75e">Можно захвалить: ${label}</text>
    `);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${parts.join('\n')}
</svg>`;
}

export function marriageLabel(suit: Suit): string {
  return `${SUIT_NAME_RU[suit]} ${MARRIAGE_POINTS[suit]}`;
}
