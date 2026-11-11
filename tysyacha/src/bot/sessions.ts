/** Хранение партий в памяти (на процесс). */

import { randomBytes } from 'node:crypto';
import { TysyachaGame, type PlayerInfo } from '../game/engine.ts';

export interface Session {
  chatId: number;
  directoryId: string;
  game: TysyachaGame;
  humanIndex: number;
  messageId?: number;
}

const sessions = new Map<number, Session>();

export function getSession(chatId: number): Session | undefined {
  return sessions.get(chatId);
}

export function activeSoloSessions(): Session[] {
  return [...sessions.values()].filter(({ chatId, game }) => chatId > 0 && game.phase !== 'gameover');
}

export function createSoloSession(chatId: number, humanName: string): Session {
  const players: PlayerInfo[] = [
    { id: String(chatId), name: humanName || 'Вы', isBot: false },
    { id: 'bot-north', name: 'Север', isBot: true },
    { id: 'bot-east', name: 'Восток', isBot: true },
  ];
  const game = new TysyachaGame(players);
  game.startGame(Math.floor(Math.random() * 3));
  const session: Session = { chatId, directoryId: randomBytes(8).toString('base64url'), game, humanIndex: 0 };
  sessions.set(chatId, session);
  return session;
}

export function deleteSession(chatId: number): void {
  sessions.delete(chatId);
}
