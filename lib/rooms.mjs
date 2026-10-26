import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { GameError, log, startGame, playCards, respond, assertConservation, publicRoom } from './engine.mjs';

const fail = (test, text, status = 400) => { if (!test) throw new GameError(text, status); };
const hash = token => createHash('sha256').update(token).digest('hex');
const cleanName = name => {
  fail(typeof name === 'string', '请输入游戏名称。');
  const value = name.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  fail(value.length >= 1 && [...value].length <= 16, '游戏名称需要 1–16 个字符。');
  return value;
};
const freshPlayer = (name, token) => ({ id: randomBytes(8).toString('hex'), name, tokenHash: hash(token), ready: false, stage: 6, hand: [], sloth: [] });

export class RoomStore {
  constructor(directory, config = {}) {
    this.directory = directory;
    this.config = { maxRooms: 200, roomRetentionHours: 168, turnSeconds: 120, ...config };
    this.rooms = new Map(); this.listeners = new Map(); this.online = new Map();
    this.diagnostics = [];
    mkdirSync(directory, { recursive: true });
    for (const file of readdirSync(directory).filter(n => /^\d{6}\.json$/.test(n))) {
      const filename = path.join(directory, file);
      try {
        let room;
        try { room = JSON.parse(readFileSync(filename, 'utf8')); assertConservation(room); }
        catch (error) {
          room = JSON.parse(readFileSync(filename + '.bak', 'utf8')); assertConservation(room);
          this.diagnostics.push(`${file} 主文件损坏，已从备份恢复。`);
        }
        fail(room.schema === 1 && room.id + '.json' === file && Array.isArray(room.players), '房间格式错误。');
        if (Date.now() - room.updatedAt < this.config.roomRetentionHours * 3600000) {
          room.deadline = Date.now() + this.config.turnSeconds * 1000;
          this.rooms.set(room.id, room);
        }
      } catch { this.diagnostics.push(`${file} 无法读取；保留原文件供恢复。`); }
    }
  }
  save(room) {
    const filename = path.join(this.directory, `${room.id}.json`);
    const temp = filename + '.tmp';
    writeFileSync(temp, JSON.stringify(room), { mode: 0o600, flush: true });
    try {
      // Never overwrite a healthy backup with a previously corrupted primary file.
      const previous = JSON.parse(readFileSync(filename, 'utf8')); assertConservation(previous);
      copyFileSync(filename, filename + '.bak');
    } catch (e) { if (e.code && e.code !== 'ENOENT') throw e; }
    renameSync(temp, filename);
  }
  publish(room) {
    this.rooms.set(room.id, room);
    for (const callback of this.listeners.get(room.id) || []) {
      try { callback(); } catch { /* A disconnected stream must not abort another player's turn. */ }
    }
  }
  commit(room) {
    room.updatedAt = Date.now(); room.revision++;
    assertConservation(room);
    this.save(room); this.publish(room);
  }
  create(name, title) {
    fail(this.rooms.size < this.config.maxRooms, '服务器房间已满，请稍后重试。', 503);
    const token = randomBytes(32).toString('base64url'), p = freshPlayer(cleanName(name), token);
    let id; do { id = String(randomInt(100000, 1000000)); } while (this.rooms.has(id));
    const room = {
      schema: 1, id, title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 24) : `${p.name}的救赎之旅`,
      hostId: p.id, players: [p], phase: 'lobby', revision: 0, createdAt: Date.now(), updatedAt: Date.now(),
      deck: [], discard: [], table: [], pending: null, logs: [], logSeq: 0, turnNo: 0, turnIndex: 0,
      haloAvailable: true, winnerId: null, winnerName: null, settings: { turnSeconds: this.config.turnSeconds }, processed: {}, deadline: null
    };
    log(room, `${p.name} 创建了房间，等待旅伴加入。`, 'system'); this.commit(room);
    return { roomId: id, playerId: p.id, token };
  }
  get(id) { const room = this.rooms.get(id); fail(room, '房间不存在或已过期，请检查六位房间号。', 404); return room; }
  authorize(id, token) {
    const room = this.get(id);
    fail(typeof token === 'string' && token.length >= 32 && token.length <= 128, '身份已失效，请重新加入房间。', 401);
    const digest = Buffer.from(hash(token), 'hex');
    const p = room.players.find(p => p.tokenHash && timingSafeEqual(Buffer.from(p.tokenHash, 'hex'), digest));
    fail(p, '身份已失效，请重新加入房间。', 401);
    return p.id;
  }
  join(id, name) {
    const current = this.get(id), room = structuredClone(current), display = cleanName(name);
    fail(room.phase === 'lobby', '游戏已经开始，只有原玩家可以恢复座位。', 409);
    fail(room.players.length < 5, '房间已满，最多 5 名玩家。', 409);
    fail(!room.players.some(p => p.name.toLocaleLowerCase() === display.toLocaleLowerCase()), '房间内已有这个名称，请换一个。', 409);
    const token = randomBytes(32).toString('base64url'), p = freshPlayer(display, token);
    room.players.push(p); log(room, `${p.name} 加入了房间。`, 'system'); this.commit(room);
    return { roomId: id, playerId: p.id, token };
  }
  state(id, who) {
    const room = this.get(id), state = publicRoom(room, who, this.online.get(id) || new Set());
    state.deadline = room.deadline; state.serverTime = Date.now();
    return state;
  }
  subscribe(id, who, fn) {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    if (!this.online.has(id)) this.online.set(id, new Set());
    const online = this.online.get(id);
    online.add(who); this.listeners.get(id).add(fn);
    for (const callback of this.listeners.get(id)) callback();
    return () => {
      this.listeners.get(id)?.delete(fn);
      // Multiple browser tabs may legitimately share the same player.
      if (![...(this.listeners.get(id) || [])].some(f => f.playerId === who)) online.delete(who);
      for (const callback of this.listeners.get(id) || []) { try { callback(); } catch {} }
    };
  }
  action(id, who, body) {
    const current = this.get(id);
    fail(body && typeof body === 'object' && typeof body.type === 'string', '请求格式错误。');
    fail(typeof body.actionId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(body.actionId), '操作编号无效。');
    if ((current.processed[who] || []).includes(body.actionId)) return this.state(id, who);
    fail(body.revision === current.revision, '房间状态已更新，请重新选择后再操作。', 409);
    const room = structuredClone(current), p = room.players.find(p => p.id === who), host = who === room.hostId;
    fail(p, '你已离开房间。', 401);
    switch (body.type) {
      case 'ready':
        fail(room.phase === 'lobby', '游戏已开始。'); p.ready = !!body.ready; break;
      case 'start':
        fail(host && room.phase === 'lobby', '只有房主可以开始游戏。');
        startGame(room, body.starterId); break;
      case 'play': playCards(room, who, body); break;
      case 'respond': respond(room, who, body); break;
      case 'chat': {
        fail(typeof body.text === 'string' && body.text.trim().length > 0 && body.text.length <= 180, '消息需要 1–180 个字符。');
        log(room, `${p.name}：${body.text.trim()}`, 'chat'); break;
      }
      case 'kick':
        fail(host && room.phase === 'lobby' && body.targetId !== who, '仅房主可在等待大厅移除其他玩家。');
        fail(room.players.some(p => p.id === body.targetId), '玩家已离开。');
        log(room, `${room.players.find(p => p.id === body.targetId).name} 被移出房间。`, 'system');
        room.players = room.players.filter(p => p.id !== body.targetId); break;
      case 'leave':
        fail(room.phase !== 'playing', '对局中请保留座位，可随时关页后重连；超时将自动行动。');
        if (room.phase === 'finished') {
          // Cards remain part of the deck even when their owner leaves the results screen.
          for (const id of [...p.hand, ...p.sloth]) {
            if (id === 'halo') room.haloAvailable = true;
            else room.discard.push(id);
          }
          p.hand = []; p.sloth = [];
          if (room.winnerId === who) room.winnerName = p.name;
        }
        room.players = room.players.filter(p => p.id !== who);
        if (!room.players.length) { this.delete(id); return { left: true }; }
        if (host) room.hostId = room.players[0].id;
        log(room, `${p.name} 离开了房间。`, 'system'); break;
      case 'rematch':
        fail(host && room.phase === 'finished', '仅房主可在游戏结束后开启新旅程。');
        Object.assign(room, { phase: 'lobby', deck: [], discard: [], table: [], pending: null, winnerId: null, winnerName: null, turnNo: 0, lastPlay: null, haloAvailable: true });
        room.players.forEach(p => Object.assign(p, { hand: [], sloth: [], stage: 6, ready: false }));
        log(room, '房主开启了新的旅程，请重新准备。', 'system'); break;
      default: throw new GameError('不支持的操作。');
    }
    const stateChanged = !['chat', 'ready', 'kick', 'leave'].includes(body.type);
    if (stateChanged) room.deadline = room.phase === 'playing' ? Date.now() + room.settings.turnSeconds * 1000 : null;
    room.processed[who] = [...(room.processed[who] || []), body.actionId].slice(-32);
    this.commit(room);
    return body.type === 'leave' ? { left: true } : this.state(id, who);
  }
  autoAction(room) {
    const pending = room.pending;
    let who, data;
    if (pending?.type === 'lustDiscard') {
      who = pending.partners.find(id => !Object.hasOwn(pending.choices, id)); data = { type: 'respond', cardId: null };
    } else if (pending) {
      who = pending.actorId;
      const choices = { pride: 'decline', wrath: 'decline', envy: 'keep', lustOffer: 'decline', greed: pending.canStop ? 'stop' : 'deal' };
      data = { type: 'respond', choice: choices[pending.type] };
    } else {
      const p = room.players[room.turnIndex]; who = p.id;
      const ids = [...p.hand].sort((a, b) => {
        const rank = id => ({ halo: 0, sloth: 1, purity: 2, pride: 3, lust: 4, envy: 5, wrath: 6, gluttony: 7, greed: 8, corruption: 9 }[id.split('-')[0]]);
        return rank(a) - rank(b);
      });
      const chosen = ids[0];
      if (!chosen) return;
      data = { type: 'play', cards: [chosen], top: chosen, effect: 'sloth', mode: 'draw', direction: 1, targetId: room.players.find(p => p.id !== who).id };
    }
    log(room, `${room.players.find(p => p.id === who).name} 响应超时，系统执行默认行动。`, 'system');
    if (data.type === 'play') playCards(room, who, data); else respond(room, who, data);
    room.deadline = room.phase === 'playing' ? Date.now() + room.settings.turnSeconds * 1000 : null;
  }
  tick(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (now - room.updatedAt > this.config.roomRetentionHours * 3600000 && !this.online.get(room.id)?.size) { this.delete(room.id); continue; }
      if (room.phase === 'playing' && room.deadline && now >= room.deadline) {
        try { const next = structuredClone(room); this.autoAction(next); this.commit(next); }
        catch (error) { this.diagnostics.push(`${room.id} 自动行动失败：${error.message}`); }
      }
    }
  }
  delete(id) {
    this.rooms.delete(id);
    for (const extension of ['', '.bak', '.tmp']) rmSync(path.join(this.directory, id + '.json' + extension), { force: true });
    for (const fn of this.listeners.get(id) || []) { try { fn(); } catch {} }
    this.listeners.delete(id); this.online.delete(id);
  }
}
