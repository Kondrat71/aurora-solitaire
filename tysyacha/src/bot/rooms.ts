import { randomBytes, randomInt } from 'node:crypto';
import { TysyachaGame } from '../game/engine.ts';

export interface Member {
  id: number;
  name: string;
  messageId?: number;
}

export interface Room {
  id: string;
  number: number;
  size: 3 | 4;
  members: Member[];
  game?: TysyachaGame;
  waitingFourth?: Member;
  revision: number;
}

export class Rooms {
  private readonly byId = new Map<string, Room>();
  private readonly byMember = new Map<number, Room>();
  private lastNumber = 0;

  list(): Room[] {
    return [...this.byId.values()];
  }

  byNumber(number: number): Room | undefined {
    return this.list().find((room) => room.number === number);
  }

  forMember(id: number): Room | undefined {
    return this.byMember.get(id);
  }

  create(member: Member, size: 3 | 4): Room {
    if (this.byMember.has(member.id)) throw new Error('Вы уже за столом');
    let id: string;
    do {
      id = randomBytes(9).toString('base64url');
    } while (this.byId.has(id));
    const room: Room = { id, number: ++this.lastNumber, size, members: [member], revision: 0 };
    this.byId.set(id, room);
    this.byMember.set(member.id, room);
    return room;
  }

  join(id: string, member: Member): Room {
    const room = this.byId.get(id);
    if (!room) throw new Error('Стол закрыт или приглашение устарело');
    const current = this.forMember(member.id);
    if (current === room) return room;
    if (current) throw new Error('Сначала выйдите из своего стола через /leave');
    if (room.game || room.members.length === room.size) throw new Error('За этим столом все места заняты');
    room.members.push(member);
    this.byMember.set(member.id, room);
    room.revision++;
    return room;
  }

  acceptsMember(room: Room): boolean {
    return room.game ? room.size === 3 && !room.waitingFourth : room.members.length < room.size;
  }

  admit(room: Room, member: Member): void {
    if (this.byId.get(room.id) !== room || !this.acceptsMember(room)) throw new Error('Свободных мест уже нет');
    if (this.byMember.has(member.id)) throw new Error('Игрок уже за другим столом');
    if (!room.game) {
      this.join(room.id, member);
      return;
    }
    room.waitingFourth = member;
    this.byMember.set(member.id, room);
    room.revision++;
  }

  private seatFourth(room: Room): void {
    if (!room.waitingFourth) return;
    room.members.push(room.waitingFourth);
    room.size = 4;
    room.waitingFourth = undefined;
  }

  act(room: Room, id: number, revision: number, action: string): void {
    const seat = room.members.findIndex((member) => member.id === id);
    if (seat < 0) throw new Error('Вы не за этим столом');
    if (revision !== room.revision) throw new Error('Стол обновился. Используйте свежие кнопки');
    const [kind, value] = action.split(':');
    const game = room.game;
    const waiting = room.waitingFourth;
    const fourth = waiting && { id: String(waiting.id), name: waiting.name, isBot: false };

    if (!game) {
      if (kind !== 'start' || seat !== 0) throw new Error('Партию запускает создатель стола');
      if (room.members.length !== room.size) throw new Error('Дождитесь всех игроков');
      room.game = new TysyachaGame(
        room.members.map((member) => ({ id: String(member.id), name: member.name, isBot: false })),
      );
      room.game.startGame(randomInt(room.size));
    } else if (kind === 'restart' && seat === 0 && game.phase === 'gameover') {
      game.startGame(randomInt(fourth ? 4 : room.size), fourth);
      this.seatFourth(room);
    } else if (kind === 'next') {
      game.nextDeal(fourth);
      this.seatFourth(room);
    } else if (kind === 'bid') {
      game.placeBid(seat, value === 'pass' ? value : Number(value));
    } else if (kind === 'order') {
      game.setOrder(seat, Number(value));
    } else if (kind === 'card' && game.phase === 'discard') {
      game.discardCard(seat, value);
    } else if (kind === 'card' && game.phase === 'play') {
      game.playCard(seat, value);
    } else {
      throw new Error('Действие сейчас недоступно');
    }
    room.revision++;
  }

  leave(room: Room, id: number): { departed: Member[]; closed: boolean } {
    if (room.waitingFourth?.id === id) {
      const departed = [room.waitingFourth];
      room.waitingFourth = undefined;
      this.byMember.delete(id);
      room.revision++;
      return { departed, closed: false };
    }
    const seat = room.members.findIndex((member) => member.id === id);
    if (seat < 0) throw new Error('Вы не за этим столом');
    const closed = room.game !== undefined || room.members.length === 1;
    const departed = closed ? [...room.members, ...(room.waitingFourth ? [room.waitingFourth] : [])] : room.members.splice(seat, 1);
    departed.forEach((member) => this.byMember.delete(member.id));
    if (closed) this.byId.delete(room.id);
    room.revision++;
    return { departed, closed };
  }
}
