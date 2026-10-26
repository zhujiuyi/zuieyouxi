import { randomInt } from 'node:crypto';
import { CARDS, SUITS, META, card, hasSuit, label, meldOptions } from './cards.mjs';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const requireThat = (condition, message) => { if (!condition) throw new GameError(message); };
export const shuffled = items => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const player = (room, id) => room.players.find(p => p.id === id);
const actor = room => room.players[room.turnIndex];
export const log = (room, text, type = 'action') => {
  room.logs.push({ seq: ++room.logSeq, text, type, at: Date.now() });
  if (room.logs.length > 100) room.logs.shift();
};
const discard = (room, ids) => {
  for (const id of ids) { if (id === 'halo') room.haloAvailable = true; else room.discard.push(id); }
};
const take = (room, id, count) => {
  const p = player(room, id); let got = 0;
  for (let i = 0; i < count; i++) {
    if (!room.deck.length && room.discard.length) {
      room.deck = shuffled(room.discard); room.discard = [];
      log(room, '弃牌堆已重新洗入抽牌堆。', 'system');
    }
    if (!room.deck.length) break;
    p.hand.push(room.deck.pop()); got++;
  }
  if (got < count) log(room, `抽牌堆与弃牌堆均已用尽，${p.name} 实际摸到 ${got} 张牌。`, 'system');
  return got;
};
const revealDraw = (room, id, n) => {
  const count = take(room, id, n); log(room, `${player(room, id).name} 摸了 ${count} 张牌。`, 'draw');
};
function advanceEmpty(room, onlyIds = null) {
  const empty = room.players.filter(p => p.hand.length === 0 && (!onlyIds || onlyIds.includes(p.id)));
  for (const p of empty) {
    p.stage = Math.max(0, p.stage - 2);
    log(room, `${p.name} 清空手牌，罪恶值降至 ${p.stage}！`, 'stage');
  }
  const winners = empty.filter(p => p.stage === 0);
  if (winners.length === 1) {
    room.phase = 'finished'; room.winnerId = winners[0].id; room.winnerName = winners[0].name; room.pending = null;
    log(room, `${winners[0].name} 完成救赎，赢得本局！`, 'win'); return;
  }
  if (winners.length > 1) {
    log(room, '多人同时达到 0，平手玩家各摸 1 张继续决胜。', 'system');
    winners.forEach(p => take(room, p.id, 1));
  }
  empty.filter(p => p.stage > 0).forEach(p => take(room, p.id, p.stage));
}
function beginTurn(room) {
  const p = actor(room);
  if (p.sloth.length) { discard(room, p.sloth); p.sloth = []; }
  room.turnNo++;
}
function finishTurn(room) {
  const extra = room.extraTurn;
  room.pending = null;
  discard(room, room.table); room.table = [];
  advanceEmpty(room);
  if (room.phase === 'finished') return;
  if (!extra) room.turnIndex = (room.turnIndex + 1) % room.players.length;
  else log(room, `${actor(room).name} 获得额外回合。`, 'extra');
  room.extraTurn = false;
  beginTurn(room);
}
export function startGame(room, starterId) {
  requireThat(room.players.length >= 3 && room.players.length <= 5, '原版规则需要 3–5 名玩家。');
  requireThat(room.players.every(p => p.id === room.hostId || p.ready), '请等待所有玩家准备。');
  const starter = room.players.findIndex(p => p.id === (starterId || room.hostId));
  requireThat(starter >= 0, '请选择有效的起始玩家。');
  Object.assign(room, { phase: 'playing', turnIndex: starter, turnNo: 0, deck: shuffled(Object.keys(CARDS).filter(id => id !== 'halo')), discard: [], table: [], pending: null, haloAvailable: true, winnerId: null, winnerName: null, extraTurn: false, lastPlay: null });
  for (const p of room.players) { p.hand = []; p.sloth = []; p.stage = 6; }
  for (let round = 0; round < 6; round++) for (const p of room.players) take(room, p.id, 1);
  take(room, actor(room).id, 1);
  log(room, `旅程开始。${actor(room).name} 先手，额外摸 1 张牌。`, 'system');
  beginTurn(room);
}
function targetCheck(room, who, targetId) {
  requireThat(targetId && targetId !== who && player(room, targetId), '请选择另一名玩家。');
  return player(room, targetId);
}
function wrathDraw(room, from, to) {
  revealDraw(room, to, 2);
  if (player(room, to).hand.some(id => hasSuit(id, 'wrath'))) room.pending = { type: 'wrath', actorId: to, opponentId: from };
  else finishTurn(room);
}
function triggerSloth(room) {
  for (const p of room.players) if (p.sloth.length) revealDraw(room, p.id, 1);
}
export function playCards(room, who, data) {
  requireThat(room.phase === 'playing' && !room.pending, '当前不能出牌，请先完成效果结算。');
  requireThat(actor(room).id === who, '还没有轮到你。');
  const ids = data.cards;
  requireThat(Array.isArray(ids) && ids.length > 0 && ids.length <= 52 && ids.every(id => player(room, who).hand.includes(id)), '请选择自己手中的牌。');
  const options = meldOptions(ids);
  const top = data.top || (options[0]?.tops.length === 1 ? options[0].tops[0] : ids.at(-1));
  const option = options.find(o => o.tops.includes(top));
  requireThat(option, '组合不合法：需要同花色、同数字或连续顺子；顺子的最大数字必须在最上方。');
  const topCard = card(top);
  const effect = topCard.suit === 'corruption' ? data.effect : topCard.suit;
  requireThat(effect && (topCard.suit !== 'corruption' || SUITS.includes(effect)), '请为腐化选择一种罪孽效果。');
  if (['pride', 'lust', 'wrath'].includes(effect) || (effect === 'gluttony' && data.mode !== 'draw')) targetCheck(room, who, data.targetId);
  if (effect === 'gluttony') requireThat(['draw', 'steal'].includes(data.mode), '请选择暴食的行动。');
  if (effect === 'greed') requireThat([1, -1].includes(data.direction), '请选择贪婪的发牌方向。');
  const p = player(room, who);
  p.hand = p.hand.filter(id => !ids.includes(id));
  room.table = [...ids.filter(id => id !== top), top];
  room.lastPlay = { playerId: who, cards: [...room.table], effect, kind: option.kind, turn: room.turnNo };
  log(room, `${p.name} 打出 ${ids.map(label).join('、')}（${option.kind}），发动${META[effect].name}。`, 'play');
  // Only the top card resolves. Corruption is always all suits, including sloth.
  if (effect === 'sloth' || topCard.suit === 'corruption') triggerSloth(room);
  switch (effect) {
    case 'halo':
      discard(room, p.hand); p.hand = []; finishTurn(room); break;
    case 'purity': {
      for (const other of room.players) other.hand = other.hand.filter(id => id !== 'halo');
      room.haloAvailable = false; p.hand.push('halo');
      log(room, `${p.name} 将光环收入手中。`, 'effect'); finishTurn(room); break;
    }
    case 'sloth':
      room.table = room.table.filter(id => id !== top); p.sloth.push(top); finishTurn(room); break;
    case 'pride':
      room.pending = { type: 'pride', actorId: data.targetId, sourceId: who };
      if (!player(room, data.targetId).hand.some(id => hasSuit(id, 'pride'))) { revealDraw(room, data.targetId, 1); finishTurn(room); }
      break;
    case 'wrath': wrathDraw(room, who, data.targetId); break;
    case 'envy':
      revealDraw(room, who, 2);
      if (p.hand.some(id => hasSuit(id, 'envy'))) finishTurn(room);
      else room.pending = { type: 'envy', actorId: who };
      break;
    case 'gluttony': {
      room.extraTurn = true;
      if (data.mode === 'draw') revealDraw(room, who, 3);
      else {
        const target = player(room, data.targetId);
        requireThat(target.hand.length > 0, '对方没有可以抽取的手牌。');
        const [taken] = target.hand.splice(randomInt(target.hand.length), 1); p.hand.push(taken);
        log(room, `${p.name} 随机取得 ${target.name} 的 1 张手牌。`, 'effect');
        if (!target.hand.length) advanceEmpty(room, [target.id]);
      }
      if (room.phase !== 'finished') finishTurn(room);
      else { discard(room, room.table); room.table = []; }
      break;
    }
    case 'lust': room.pending = { type: 'lustOffer', actorId: data.targetId, sourceId: who }; break;
    case 'greed': room.pending = { type: 'greed', actorId: who, direction: data.direction, dealt: [], nonGreed: 0, seen: [], canStop: false }; break;
  }
}
function resolveGreed(room, who, data) {
  const pending = room.pending;
  if (data.choice === 'stop') {
    requireThat(pending.canStop, '至少发出 2 张非贪婪牌，且最后一张不是贪婪，才能停止。');
    for (const { to, card: id } of pending.dealt) player(room, to).hand.push(id);
    log(room, `${player(room, who).name} 见好就收，对手收下已发的 ${pending.dealt.length} 张牌。`, 'effect');
    finishTurn(room); return;
  }
  requireThat(data.choice === 'deal', '请选择继续发牌或停止。');
  if (!room.deck.length && room.discard.length) { room.deck = shuffled(room.discard); room.discard = []; log(room, '弃牌堆已重新洗入抽牌堆。', 'system'); }
  if (!room.deck.length) {
    for (const { to, card: id } of pending.dealt) player(room, to).hand.push(id);
    log(room, '没有可继续发出的牌，贪婪停止，玩家收下已发的牌。', 'system'); finishTurn(room); return;
  }
  const others = [];
  for (let offset = 1; offset < room.players.length; offset++) others.push(room.players[(room.turnIndex + offset * pending.direction + room.players.length) % room.players.length]);
  const id = room.deck.pop(), suit = card(id).suit, recipient = others[pending.dealt.length % others.length];
  pending.dealt.push({ to: recipient.id, card: id });
  log(room, `贪婪翻出 ${label(id)}，暂发给 ${recipient.name}。`, 'reveal');
  const bust = suit === 'corruption' || (SUITS.includes(suit) && suit !== 'greed' && pending.seen.includes(suit));
  if (bust) {
    player(room, who).hand.push(...pending.dealt.map(d => d.card));
    log(room, `${player(room, who).name} 贪婪失败，收回全部 ${pending.dealt.length} 张牌。`, 'effect'); finishTurn(room); return;
  }
  if (suit !== 'greed') pending.nonGreed++;
  if (SUITS.includes(suit) && suit !== 'greed') pending.seen.push(suit);
  pending.canStop = pending.nonGreed >= 2 && suit !== 'greed';
  if (pending.dealt.length >= 5) {
    for (const { to, card: dealtId } of pending.dealt) player(room, to).hand.push(dealtId);
    discard(room, player(room, who).hand); player(room, who).hand = [];
    log(room, `${player(room, who).name} 成功发出 5 张，清空全部手牌！`, 'stage'); finishTurn(room);
  }
}
export function respond(room, who, data) {
  requireThat(room.phase === 'playing' && room.pending, '当前没有待处理的效果。');
  const pending = room.pending;
  if (pending.type === 'lustDiscard') {
    requireThat(pending.partners.includes(who), '此效果不需要你的响应。');
    requireThat(!Object.hasOwn(pending.choices, who), '你已暗置选择，请等待对方。');
    const id = data.cardId ?? null;
    requireThat(id === null || (id !== 'halo' && player(room, who).hand.includes(id)), '请选择自己的手牌；光环不能暗弃。');
    pending.choices[who] = id;
    if (pending.partners.every(id => Object.hasOwn(pending.choices, id))) {
      const penalties = [];
      for (const id of pending.partners) {
        const chosen = pending.choices[id];
        if (chosen) {
          player(room, id).hand = player(room, id).hand.filter(c => c !== chosen); discard(room, [chosen]);
          log(room, `${player(room, id).name} 暗弃了 ${label(chosen)}。`, 'reveal');
          if (hasSuit(chosen, 'lust')) penalties.push(pending.partners.find(p => p !== id));
        } else log(room, `${player(room, id).name} 选择不弃牌。`, 'reveal');
      }
      penalties.forEach(id => revealDraw(room, id, 3)); finishTurn(room);
    }
    return;
  }
  requireThat(pending.actorId === who, '请等待指定玩家响应。');
  switch (pending.type) {
    case 'pride':
      requireThat(['show', 'decline'].includes(data.choice), '请选择展示傲慢或不展示。');
      if (data.choice === 'show') {
        requireThat(player(room, who).hand.includes(data.cardId) && hasSuit(data.cardId, 'pride'), '请选择傲慢或腐化进行展示。');
        log(room, `${player(room, who).name} 展示了 ${label(data.cardId)}，保留在手中。`, 'reveal');
        revealDraw(room, pending.sourceId, 1);
      } else revealDraw(room, who, 1);
      finishTurn(room); break;
    case 'wrath':
      requireThat(['reflect', 'decline'].includes(data.choice), '请选择反击或结束。');
      if (data.choice === 'reflect') {
        requireThat(player(room, who).hand.includes(data.cardId) && hasSuit(data.cardId, 'wrath'), '请选择愤怒或腐化进行反击。');
        player(room, who).hand = player(room, who).hand.filter(id => id !== data.cardId); discard(room, [data.cardId]);
        log(room, `${player(room, who).name} 弃出 ${label(data.cardId)} 反击。`, 'effect'); wrathDraw(room, who, pending.opponentId);
      } else finishTurn(room);
      break;
    case 'envy':
      requireThat(['swap', 'keep'].includes(data.choice), '请选择交换或保留手牌。');
      if (data.choice === 'swap') {
        const other = targetCheck(room, who, data.targetId);
        [player(room, who).hand, other.hand] = [other.hand, player(room, who).hand];
        log(room, `${player(room, who).name} 与 ${other.name} 交换了全部手牌。`, 'effect');
      }
      finishTurn(room); break;
    case 'lustOffer':
      requireThat(['accept', 'decline'].includes(data.choice), '请选择参与暗弃或什么也不做。');
      if (data.choice === 'accept') room.pending = { type: 'lustDiscard', partners: [pending.sourceId, who], choices: {} };
      else { log(room, `${player(room, who).name} 拒绝了色欲的邀请。`, 'effect'); finishTurn(room); }
      break;
    case 'greed': resolveGreed(room, who, data); break;
    default: throw new GameError('未知的结算阶段。');
  }
}
export function assertConservation(room) {
  if (!['playing', 'finished'].includes(room.phase)) return;
  const all = [...room.deck, ...room.discard, ...room.table, ...room.players.flatMap(p => [...p.hand, ...p.sloth]), ...(room.pending?.type === 'greed' ? room.pending.dealt.map(d => d.card) : []), ...(room.haloAvailable ? ['halo'] : [])];
  if (all.length !== 52 || new Set(all).size !== 52 || all.some(id => !CARDS[id])) throw new Error('卡牌守恒校验失败。');
}
export function publicRoom(room, who, online = new Set()) {
  let pending = room.pending ? structuredClone(room.pending) : null;
  if (pending?.type === 'lustDiscard') { pending.submitted = Object.keys(pending.choices); delete pending.choices; }
  return {
    id: room.id, title: room.title, revision: room.revision, phase: room.phase, hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, stage: p.stage, handCount: p.hand.length, sloth: p.sloth, online: online.has(p.id) })),
    selfId: who, hand: player(room, who)?.hand || [], turnPlayerId: room.phase === 'playing' ? actor(room).id : null,
    turnNo: room.turnNo, pending, lastPlay: room.lastPlay, table: room.table,
    deckCount: room.deck.length, discardCount: room.discard.length, discardTop: room.discard.at(-1) || null, haloAvailable: room.haloAvailable,
    winnerId: room.winnerId, winnerName: room.players.find(p => p.id === room.winnerId)?.name || room.winnerName || null, logs: room.logs, createdAt: room.createdAt,
    settings: room.settings
  };
}
