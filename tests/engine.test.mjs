import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, SUITS, card, hasSuit, meldOptions, selectionPlan } from '../lib/cards.mjs';
import { startGame, playCards, respond, publicRoom, assertConservation } from '../lib/engine.mjs';

export function fresh() {
  return { id: '123456', title: '测试', hostId: 'p1', players: ['p1', 'p2', 'p3'].map(id => ({ id, name: id, ready: true, hand: [], stage: 6, sloth: [] })), phase: 'lobby', logs: [], logSeq: 0, revision: 1, settings: {} };
}
function setup(hands, nextDraws = [], stages = [6, 6, 6]) {
  const r = fresh(); startGame(r);
  r.players.forEach((p, i) => { p.hand = hands[i]; p.stage = stages[i]; p.sloth = []; });
  const used = hands.flat();
  r.haloAvailable = !used.includes('halo');
  r.table = []; r.pending = null; r.turnIndex = 0;
  r.deck = [...nextDraws].reverse();
  r.discard = Object.keys(CARDS).filter(id => id !== 'halo' && !used.includes(id) && !nextDraws.includes(id));
  assertConservation(r); return r;
}
const play = (r, cards, other = {}) => { playCards(r, r.players[r.turnIndex].id, { cards, top: cards.at(-1), targetId: 'p2', mode: 'draw', direction: 1, ...other }); assertConservation(r); };
const answer = (r, who, data) => { respond(r, who, data); assertConservation(r); };

test('选牌顺序决定普通组合顶牌，顺子自动升序，多种合法组合可切换', () => {
  const normal = selectionPlan(['pride-5', 'pride-3']);
  assert.equal(normal.kind, '同花色'); assert.equal(normal.top, 'pride-3');
  assert.deepEqual(normal.cards, ['pride-5', 'pride-3']);
  const run = selectionPlan(['envy-4', 'lust-2', 'wrath-3']);
  assert.equal(run.kind, '顺子'); assert.equal(run.top, 'envy-4');
  assert.deepEqual(run.cards, ['lust-2', 'wrath-3', 'envy-4']);
  assert.equal(selectionPlan(['pride-3', 'pride-2']).top, 'pride-3');
  assert.equal(selectionPlan(['pride-3', 'pride-2'], '同花色').top, 'pride-2');
  assert.equal(selectionPlan(['halo', 'pride-1']).valid, false);
  assert.equal(selectionPlan(['sloth-1', 'lust-3']).valid, false);
  assert.equal(selectionPlan(['pride-1'], '未知组合').valid, false);
});

test('明确组合方式时，服务器拒绝错误顶牌并按顺子顺序记录桌面', () => {
  const normal = setup([['pride-5','pride-3','sloth-7'],['lust-1'],['wrath-1']]);
  const before = structuredClone(normal);
  assert.throws(() => playCards(normal,'p1',{cards:['pride-5','pride-3'],top:'pride-5',kind:'同花色',targetId:'p2'}), /最后选中/);
  assert.deepEqual(normal,before);
  const run = setup([['envy-4','pride-2','wrath-3','sloth-7'],['pride-1'],['lust-1']],['greed-5','lust-7']);
  assert.throws(() => playCards(run,'p1',{cards:['envy-4','pride-2','wrath-3'],top:'wrath-3',kind:'顺子'}), /最大数字/);
  playCards(run,'p1',{cards:['envy-4','pride-2','wrath-3'],top:'envy-4',kind:'顺子'});
  assert.deepEqual(run.lastPlay.cards,['pride-2','wrath-3','envy-4']);
  assert.equal(run.lastPlay.effect,'envy'); assertConservation(run);
});

test('暴食抽最后一张需要明确确认，确认前不改变牌局，确认后正确晋级或获胜', () => {
  for (const stage of [6,4,2,0]) {
    const room=setup([['gluttony-1','sloth-1'],['pride-1'],['pride-2']],['greed-1','greed-2','greed-3','greed-4'],[6,stage,6]);
    const before=structuredClone(room);
    assert.throws(()=>play(room,['gluttony-1'],{mode:'steal'}),/最后一张/);
    assert.deepEqual(room,before);
    play(room,['gluttony-1'],{mode:'steal',confirmLastCard:true});
    assert.equal(room.players[1].stage,Math.max(0,stage-2));
    if(stage<=2){assert.equal(room.phase,'finished');assert.equal(room.winnerId,'p2');}
    else {assert.equal(room.phase,'playing');assert.equal(room.players[1].hand.length,stage-2);}
    assert.equal(room.logs.some(entry=>entry.text.includes('傲慢1')),false,'暗抽牌的牌名不能进入公开日志');
  }
});

test('贪婪主动结束记录每次明发人与收牌人，并逐人列出实际收到的牌', () => {
  const r=setup([['greed-1','pride-7'],['pride-1'],['pride-2']],['lust-1','envy-1','greed-2','sloth-1']);
  play(r,['greed-1']);
  for(let i=0;i<4;i++)answer(r,'p1',{choice:'deal'});
  assert.ok(r.logs.some(l=>l.text==='p1 因贪婪向 p2 明发 色欲1（待结算）。'));
  assert.ok(!r.logs.some(l=>l.text.includes('因 p1 的贪婪，收到')));
  answer(r,'p1',{choice:'stop'});
  assert.ok(r.logs.some(l=>l.text==='p2 因 p1 的贪婪，收到 色欲1、贪婪2（2 张）。'));
  assert.ok(r.logs.some(l=>l.text==='p3 因 p1 的贪婪，收到 嫉妒1、懒惰1（2 张）。'));
  assert.ok(r.players[1].hand.includes('lust-1')&&r.players[1].hand.includes('greed-2'));
});

test('贪婪成功、失败与牌堆耗尽均有准确结算日志', () => {
  const success=setup([['greed-1','pride-7'],['pride-1'],['pride-2']],['greed-2','lust-1','envy-1','greed-3','sloth-1']);
  play(success,['greed-1']);for(let i=0;i<5;i++)answer(success,'p1',{choice:'deal'});
  assert.ok(success.logs.some(l=>l.text.includes('p1 的贪婪成功')));
  assert.ok(success.logs.some(l=>l.text==='p2 因 p1 的贪婪，收到 贪婪2、嫉妒1、懒惰1（3 张）。'));
  for(const draws of [['lust-1','lust-2'],['corruption']]) {
    const failure=setup([['greed-1','pride-7'],['pride-1'],['pride-2']],draws);
    play(failure,['greed-1']);draws.forEach(()=>answer(failure,'p1',{choice:'deal'}));
    const result=failure.logs.find(l=>l.text.includes('贪婪失败'));
    assert.ok(result.text.includes(draws[0]==='corruption'?'翻到了腐化':'色欲 再次出现'));
    assert.ok(result.text.includes('由 p1 收回'));
    assert.ok(!failure.logs.some(l=>l.text.includes('因 p1 的贪婪，收到')));
  }
  const empty=setup([['greed-1','pride-7'],['pride-1'],['pride-2']],['purity']);
  play(empty,['greed-1']);answer(empty,'p1',{choice:'deal'});
  empty.players[2].hand.push(...empty.deck,...empty.discard);empty.deck=[];empty.discard=[];assertConservation(empty);
  answer(empty,'p1',{choice:'deal'});
  assert.ok(empty.logs.some(l=>l.text.includes('牌堆已无牌可发，p1 的贪婪结束')));
  assert.ok(empty.logs.some(l=>l.text==='p2 因 p1 的贪婪，收到 净化0（1 张）。'));
});

test('开局发牌：51 张洗牌、光环场外、先手 7 张，其余各 6 张', () => {
  const r = fresh(); startGame(r);
  assert.deepEqual(r.players.map(p => p.hand.length), [7, 6, 6]); assert.equal(r.deck.length, 32); assert.equal(r.haloAvailable, true); assertConservation(r);
  assert.throws(() => startGame({ ...fresh(), players: fresh().players.slice(0, 2) }), /3–5/);
});
test('组合与腐化：固定数字 8、可同色、顺子最大在上、光环只能单出', () => {
  assert.ok(meldOptions(['pride-1', 'pride-7']).length);
  assert.ok(meldOptions(['pride-2', 'lust-2']).length);
  assert.deepEqual(meldOptions(['purity', 'pride-1'])[0].tops, ['pride-1']);
  assert.equal(meldOptions(['pride-2', 'corruption']).length, 1); // Same suit, not a numeric wildcard.
  assert.equal(meldOptions(['pride-2', 'lust-4', 'corruption']).length, 0);
  assert.equal(meldOptions(['pride-7', 'corruption', 'purity']).length, 0);
  assert.equal(meldOptions(['halo', 'purity']).length, 0);
  assert.deepEqual(meldOptions(['pride-6', 'lust-7', 'corruption'])[0].tops, ['corruption']);
});
test('单出最后一张要先完成效果，嫉妒摸牌后不能提前晋级', () => {
  const r = setup([['envy-1'], ['pride-1'], ['pride-2']], ['envy-2', 'greed-1']);
  play(r, ['envy-1']); assert.equal(r.players[0].stage, 6); assert.equal(r.players[0].hand.length, 2); assert.equal(r.turnIndex, 1);
});
test('回合结束时其他空手玩家也晋级，懒惰只保留生效的一张', () => {
  const r = setup([['sloth-1', 'sloth-2'], ['halo'], ['pride-1']]);
  play(r, ['sloth-1', 'sloth-2']); assert.deepEqual(r.players[0].sloth, ['sloth-2']); assert.equal(r.players[0].stage, 4); assert.equal(r.players[0].hand.length, 4);
});
test('愤怒先摸 2 张，可以用刚摸到的愤怒反击；放弃不会再次摸牌', () => {
  const r = setup([['wrath-1', 'sloth-1'], ['pride-1'], ['pride-2']], ['wrath-2', 'lust-1', 'greed-1', 'greed-2']);
  play(r, ['wrath-1']); assert.equal(r.players[1].hand.length, 3); assert.equal(r.pending.actorId, 'p2');
  answer(r, 'p2', { choice: 'reflect', cardId: 'wrath-2' }); assert.equal(r.players[0].hand.length, 3);
  // p1 has no wrath, so the duel ends automatically.
  assert.equal(r.pending, null); assert.equal(r.turnIndex, 1); assert.equal(r.players[1].hand.length, 2);
});
test('傲慢是展示，不是弃牌；腐化也可展示', () => {
  const r = setup([['pride-1', 'sloth-1'], ['corruption'], ['pride-2']], ['greed-1']);
  play(r, ['pride-1']); answer(r, 'p2', { choice: 'show', cardId: 'corruption' });
  assert.ok(r.players[1].hand.includes('corruption')); assert.equal(r.players[0].hand.length, 2);
});
test('傲慢允许有牌却不展示', () => {
  const r = setup([['pride-1', 'sloth-1'], ['pride-3'], ['pride-2']], ['greed-1']);
  play(r, ['pride-1']); answer(r, 'p2', { choice: 'decline' }); assert.equal(r.players[1].hand.length, 2);
});
test('暴食无论摸三张还是抽对手一张都获得额外回合', () => {
  for (const mode of ['draw', 'steal']) {
    const r = setup([['gluttony-1', 'sloth-1'], ['pride-1', 'pride-3'], ['pride-2']], ['greed-1', 'greed-2', 'greed-3']);
    play(r, ['gluttony-1'], { mode }); assert.equal(r.turnIndex, 0); assert.equal(r.turnNo, 2);
    assert.equal(r.players[0].hand.length, mode === 'draw' ? 4 : 2);
  }
});
test('暴食抽走对方最后一张会立即令对方晋级或获胜', () => {
  const r = setup([['gluttony-1', 'sloth-1'], ['halo'], ['pride-2']], [], [6, 2, 6]);
  play(r, ['gluttony-1'], { mode: 'steal', confirmLastCard: true }); assert.equal(r.winnerId, 'p2'); assert.equal(r.phase, 'finished');
});
test('净化从别人手中取回光环，对方空手在结算末晋级；光环不进弃牌堆', () => {
  const r = setup([['purity'], ['halo'], ['pride-2']]);
  play(r, ['purity']); assert.deepEqual(r.players[0].hand, ['halo']); assert.equal(r.players[0].stage, 6); assert.equal(r.players[1].stage, 4);
  r.turnIndex = 0; play(r, ['halo']); assert.equal(r.players[0].stage, 4); assert.ok(!r.discard.includes('halo')); assert.equal(r.haloAvailable, true);
});
test('嫉妒换手资格在摸牌后检查，腐化阻止换手', () => {
  const r = setup([['envy-1', 'sloth-1'], ['pride-1'], ['pride-2']], ['corruption', 'lust-1']);
  play(r, ['envy-1']); assert.equal(r.pending, null);
  const s = setup([['envy-1', 'sloth-1'], ['pride-1'], ['pride-2']], ['greed-1', 'lust-1']);
  play(s, ['envy-1']); assert.equal(s.pending.type, 'envy'); answer(s, 'p1', { choice: 'swap', targetId: 'p2' });
  assert.deepEqual(s.players[0].hand, ['pride-1']); assert.equal(s.players[1].hand.length, 3);
});
test('色欲选择保密，双方提交后同时揭晓和惩罚，光环不能暗弃', () => {
  const r = setup([['lust-1', 'lust-2'], ['lust-3', 'halo'], ['pride-2']], ['greed-1', 'greed-2', 'greed-3', 'greed-4', 'greed-5', 'greed-6']);
  play(r, ['lust-1']); answer(r, 'p2', { choice: 'accept' });
  assert.throws(() => respond(r, 'p2', { cardId: 'halo' }), /光环/);
  answer(r, 'p1', { cardId: 'lust-2' });
  const publicState = publicRoom(r, 'p3'); assert.equal(publicState.pending.choices, undefined); assert.deepEqual(publicState.pending.submitted, ['p1']);
  assert.equal(r.players[0].hand.length, 1); // The concealed card stays in its owner's hand until both lock in.
  answer(r, 'p2', { cardId: 'lust-3' }); assert.equal(r.players[0].hand.length, 3); assert.equal(r.players[1].hand.length, 4);
});
test('色欲双方可不弃；两人同时到 0 时各摸一张继续决胜', () => {
  const r = setup([['lust-1'], ['pride-1'], ['pride-2']], ['greed-1', 'greed-2'], [2, 2, 6]);
  play(r, ['lust-1']); answer(r, 'p2', { choice: 'accept' }); answer(r, 'p1', { cardId: null }); answer(r, 'p2', { cardId: 'pride-1' });
  assert.equal(r.phase, 'playing'); assert.deepEqual(r.players.slice(0, 2).map(p => [p.stage, p.hand.length]), [[0, 1], [0, 1]]);
});
test('贪婪按总共五张成功计算，贪婪牌计入总数；跳过自己、可逆时针发牌', () => {
  const r = setup([['greed-1', 'pride-7'], ['pride-1'], ['pride-2']], ['greed-2', 'lust-1', 'envy-1', 'greed-3', 'sloth-1']);
  play(r, ['greed-1'], { direction: -1 });
  answer(r, 'p1', { choice: 'deal' }); assert.equal(r.pending.dealt[0].to, 'p3');
  answer(r, 'p1', { choice: 'deal' }); answer(r, 'p1', { choice: 'deal' }); assert.equal(r.pending.canStop, true);
  answer(r, 'p1', { choice: 'deal' }); assert.equal(r.pending.canStop, false);
  answer(r, 'p1', { choice: 'deal' }); assert.equal(r.players[0].stage, 4); assert.equal(r.pending, null);
});
test('贪婪同花失败收回全部牌，腐化即使第一张也失败，净化没有花色', () => {
  for (const draws of [['lust-1', 'lust-2'], ['corruption']]) {
    const r = setup([['greed-1', 'pride-7'], ['pride-1'], ['pride-2']], draws);
    play(r, ['greed-1']); draws.forEach(() => answer(r, 'p1', { choice: 'deal' }));
    assert.equal(r.players[0].hand.length, 1 + draws.length); assert.equal(r.players[0].stage, 6); assert.equal(r.pending, null);
  }
  const r = setup([['greed-1', 'pride-7'], ['pride-1'], ['pride-2']], ['purity', 'envy-1']);
  play(r, ['greed-1']); answer(r, 'p1', { choice: 'deal' }); answer(r, 'p1', { choice: 'deal' }); answer(r, 'p1', { choice: 'stop' });
  assert.ok(r.players[1].hand.includes('purity'));
});
test('已有懒惰者被其他懒惰或腐化影响，下次回合开始移除', () => {
  const r = setup([['sloth-1', 'pride-1'], ['sloth-2', 'pride-2'], ['corruption', 'pride-3']], ['greed-1', 'greed-2', 'greed-3']);
  play(r, ['sloth-1']); play(r, ['sloth-2']); assert.equal(r.players[0].hand.length, 2);
  play(r, ['corruption'], { effect: 'pride', targetId: 'p2' });
  if (r.pending) answer(r, 'p2', { choice: 'decline' });
  assert.equal(r.players[0].sloth.length, 0); assert.equal(r.players[0].hand.length, 3); assert.ok(r.discard.includes('sloth-1'));
});
test('无权限、非法组合、错误响应和重复牌被拒绝', () => {
  const r = setup([['sloth-1', 'lust-3'], ['pride-1'], ['pride-2']]);
  assert.throws(() => playCards(r, 'p2', { cards: ['pride-1'] }), /轮到/);
  assert.throws(() => playCards(r, 'p1', { cards: ['sloth-1', 'lust-3'] }), /组合/);
  assert.throws(() => playCards(r, 'p1', { cards: ['sloth-1', 'sloth-1'] }), /组合/);
  assertConservation(r);
});
test('100 局自动模拟全部完成，逐次验证 52 张牌守恒与隐藏手牌', () => {
  const effects = new Set(), categories = new Set(); let actions = 0;
  for (let game = 0; game < 100; game++) {
    const r = fresh(); if (game % 3) r.players.push({ id: 'p4', name: 'p4', ready: true, hand: [], stage: 6, sloth: [] });
    if (game % 5 === 0) r.players.push({ id: 'p5', name: 'p5', ready: true, hand: [], stage: 6, sloth: [] });
    startGame(r);
    for (let step = 0; step < 2500 && r.phase !== 'finished'; step++) {
      const p = r.pending;
      if (p) {
        if (p.type === 'lustDiscard') {
          const who = p.partners.find(id => !Object.hasOwn(p.choices, id)), owner = r.players.find(p => p.id === who);
          respond(r, who, { cardId: owner.hand.find(id => id !== 'halo' && !hasSuit(id, 'lust')) || null });
        } else {
          const owner = r.players.find(q => q.id === p.actorId), other = r.players.filter(q => q.id !== owner.id).sort((a, b) => a.hand.length - b.hand.length)[0];
          const responses = {
            pride: { choice: 'decline' }, wrath: { choice: 'decline' }, envy: { choice: other.hand.length < owner.hand.length ? 'swap' : 'keep', targetId: other.id },
            lustOffer: { choice: 'accept' }, greed: { choice: 'deal' }
          };
          respond(r, p.actorId, responses[p.type]);
        }
      } else {
        const owner = r.players[r.turnIndex], others = r.players.filter(p => p.id !== owner.id);
        const other = others.sort((a, b) => b.hand.length - a.hand.length)[0];
        let ids = owner.hand.includes('halo') ? ['halo'] : [owner.hand[0]];
        if (ids[0] !== 'halo') {
          const candidates = SUITS.map(s => owner.hand.filter(id => hasSuit(id, s)));
          for (let v = 0; v <= 8; v++) candidates.push(owner.hand.filter(id => card(id).value === v));
          ids = candidates.sort((a, b) => b.length - a.length)[0];
          if (!ids.length) ids = [owner.hand[0]];
        }
        const top = ids.find(id => card(id).suit === 'sloth') || ids.at(-1);
        playCards(r, owner.id, { cards: ids, top, effect: 'sloth', targetId: other.id, mode: game % 2 ? 'steal' : 'draw', direction: game % 2 ? 1 : -1, confirmLastCard: other.hand.length === 1 });
        effects.add(r.lastPlay.effect);
        ids.forEach(id => categories.add(card(id).suit));
      }
      assertConservation(r); actions++;
      const s = publicRoom(r, r.players[0].id); assert.ok(s.players.every(p => !('hand' in p))); assert.ok(!('deck' in s));
    }
    assert.equal(r.phase, 'finished', `Game ${game} did not finish`);
  }
  assert.equal(effects.size, 9); assert.equal(categories.size, 10);
  console.log(`模拟完成：100 局，${actions} 次操作，全部 10 类卡牌、9 类效果，卡牌守恒通过。`);
});
