/** Подсчёт очков, болты и бочка. */

import type { Card } from './cards.ts';
import { handPoints } from './cards.ts';

/** Округление до ближайших 5 (2 вниз, 3 вверх). */
export function roundToFive(n: number): number {
  const rem = ((n % 5) + 5) % 5;
  if (rem <= 2) return n - rem;
  return n + (5 - rem);
}

export interface PlayerScoreState {
  total: number;
  bolts: number;
  onBarrel: boolean;
  barrelAttempts: number;
}

export function createScoreState(): PlayerScoreState {
  return { total: 0, bolts: 0, onBarrel: false, barrelAttempts: 0 };
}

export interface RoundResultInput {
  /** Сырые очки взяток + марьяжи (без округления) */
  rawPoints: number[];
  bidderIndex: number;
  order: number;
  /** Кто уже был на бочке до записи этой сдачи */
  before: PlayerScoreState[];
}

export interface RoundResultOutput {
  after: PlayerScoreState[];
  deltas: number[];
  notes: string[];
  winnerIndex: number | null;
}

/**
 * Запись сдачи по правилам:
 * — играющий получает заказ или −заказ (без округления);
 * — соперники получают округлённый набор;
 * — на бочке чужие очки/болты не пишутся;
 * — бочка 880, 3 попытки, выход заказом ≥120.
 */
export function applyRoundScoring(input: RoundResultInput): RoundResultOutput {
  const { rawPoints, bidderIndex, order, before } = input;
  const n = before.length;
  const after = before.map((s) => ({ ...s }));
  const deltas = Array(n).fill(0) as number[];
  const notes: string[] = [];

  // Бочкующий расходует попытку, если сам купил игру
  if (after[bidderIndex].onBarrel) {
    after[bidderIndex].barrelAttempts += 1;
  }

  for (let i = 0; i < n; i++) {
    const wasOnBarrel = before[i].onBarrel;
    const isBidder = i === bidderIndex;

    // На бочке чужая игра: очки и болты не пишем
    if (wasOnBarrel && !isBidder) {
      notes.push(`Игрок ${i + 1} на бочке — чужие очки не записываются`);
      continue;
    }

    if (isBidder) {
      const made = rawPoints[i] >= order;
      let delta = made ? order : -order;

      if (wasOnBarrel) {
        if (made && order >= 120) {
          // Успешный выход с бочки
          after[i].total = 880 + order;
          after[i].onBarrel = false;
          after[i].barrelAttempts = 0;
          deltas[i] = order;
          notes.push(`Игрок ${i + 1} вышел с бочки: +${order} → ${after[i].total}`);
        } else if (made && order < 120) {
          // Попытка потрачена, остаёмся на 880
          after[i].total = 880;
          deltas[i] = 0;
          notes.push(`Игрок ${i + 1}: заказ <120 — бочка сохранена, попытка потрачена`);
        } else {
          // Недобрал — слетает с бочки, штраф = заказ
          after[i].total = 880 - order;
          after[i].onBarrel = false;
          after[i].barrelAttempts = 0;
          deltas[i] = -order;
          notes.push(`Игрок ${i + 1} слетел с бочки: −${order} → ${after[i].total}`);
        }
      } else {
        after[i].total += delta;
        deltas[i] = delta;
        notes.push(
          made
            ? `Игрок ${i + 1} выполнил заказ ${order}`
            : `Игрок ${i + 1} недобрал заказ ${order} (набрано ${rawPoints[i]})`,
        );
      }
    } else {
      // Соперник
      const rounded = roundToFive(rawPoints[i]);
      after[i].total += rounded;
      deltas[i] = rounded;
      notes.push(`Игрок ${i + 1}: ${rawPoints[i]} → ${rounded}`);

      // Болт: 0 очков до округления у соперника играющего
      if (rawPoints[i] === 0) {
        after[i].bolts += 1;
        notes.push(`Игрок ${i + 1}: болт (${after[i].bolts}/3)`);
        if (after[i].bolts >= 3) {
          after[i].total -= 120;
          deltas[i] -= 120;
          after[i].bolts = 0;
          notes.push(`Игрок ${i + 1}: 3 болта → −120`);
        }
      }
    }
  }

  // Проверка бочки для игроков вне бочки
  for (let i = 0; i < n; i++) {
    if (!before[i].onBarrel && !after[i].onBarrel && after[i].total >= 880) {
      // Нельзя выиграть той же сдачей, перепрыгнув бочку
      if (after[i].total >= 1000 && i === bidderIndex && rawPoints[i] >= order && order >= 120) {
        // Если уже был ≥880 до этой сдачи — обрабатывается выше.
        // Если впервые достиг ≥880 — садится на бочку, излишек не переносится.
      }
      if (after[i].total >= 880 && after[i].total < 1000) {
        after[i].total = 880;
        after[i].onBarrel = true;
        after[i].barrelAttempts = 0;
        notes.push(`Игрок ${i + 1} сел на бочку (880)`);
      } else if (after[i].total >= 880 && !before[i].onBarrel) {
        // Достиг 880+ впервые — сначала бочка, победа только со следующей сдачи
        after[i].total = 880;
        after[i].onBarrel = true;
        after[i].barrelAttempts = 0;
        notes.push(`Игрок ${i + 1} сел на бочку (880), победа отложена`);
      }
    }
  }

  // Исчерпание 3 попыток на бочке
  for (let i = 0; i < n; i++) {
    if (after[i].onBarrel && after[i].barrelAttempts >= 3) {
      after[i].total = 760;
      after[i].onBarrel = false;
      after[i].barrelAttempts = 0;
      notes.push(`Игрок ${i + 1}: 3 попытки на бочке исчерпаны → 760`);
    }
  }

  let winnerIndex: number | null = null;
  for (let i = 0; i < n; i++) {
    if (!after[i].onBarrel && after[i].total >= 1000) {
      winnerIndex = i;
      notes.push(`Игрок ${i + 1} набрал ${after[i].total} — победа!`);
      break;
    }
  }

  return { after, deltas, notes, winnerIndex };
}

export function tricksPoints(tricks: Card[][]): number {
  return tricks.reduce((s, t) => s + handPoints(t), 0);
}
