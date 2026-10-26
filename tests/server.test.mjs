import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createGameServer } from '../server.mjs';
import { CARDS, SUITS, card, hasSuit } from '../lib/cards.mjs';
import { assertConservation } from '../lib/engine.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, '.cache'); mkdirSync(CACHE, { recursive: true });
const fixture = async () => {
  const dir = mkdtempSync(path.join(CACHE, 'api-test-'));
  let app = createGameServer({ host: '127.0.0.1', port: 0, dataDir: dir, turnSeconds: 10 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let base = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (route, body, token, extra = {}) => {
    const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, json: await res.json() };
  };
  const create = async name => (await request('/api/rooms', { name })).json;
  const join = async (id, name) => (await request(`/api/rooms/${id}/join`, { name })).json;
  const read = async session => (await request('/api/rooms/' + session.roomId, undefined, session.token)).json;
  const action = async (session, body, revision) => request(`/api/rooms/${session.roomId}/actions`, { revision: revision ?? (await read(session)).revision, actionId: randomUUID(), ...body }, session.token);
  const cleanup = async () => {
    await app.stop();
    assert.ok(dir.startsWith(CACHE + path.sep + 'api-test-')); rmSync(dir, { recursive: true, force: true });
  };
  const restart = async () => {
    await app.stop(); app = createGameServer({ host: '127.0.0.1', port: 0, dataDir: dir, turnSeconds: 10 });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + app.server.address().port;
  };
  return { request, create, join, read, action, cleanup, restart, dir, get base() { return base; }, get store() { return app.store; } };
};
test('创建、按编号加入、重复名称、容量上限与开局后拒绝新座位', async () => {
  const f = await fixture();
  try {
    const h = await f.create('灯塔'); assert.match(h.roomId, /^\d{6}$/); assert.ok(h.token);
    assert.equal((await f.request(`/api/rooms/${h.roomId}/join`, { name: '灯塔' })).status, 409);
    const sessions = [h];
    for (const name of ['小鹿', '白夜', '海盐', '月亮']) sessions.push(await f.join(h.roomId, name));
    assert.equal((await f.request(`/api/rooms/${h.roomId}/join`, { name: '第六人' })).status, 409);
    for (const session of sessions.slice(1)) assert.equal((await f.action(session, { type: 'ready', ready: true })).status, 200);
    assert.equal((await f.action(h, { type: 'start' })).status, 200);
    assert.equal((await f.request(`/api/rooms/${h.roomId}/join`, { name: '后来者' })).status, 409);
    const state = await f.read(h); assert.equal(state.players.length, 5); assert.equal(state.hand.length, 7);
  } finally { await f.cleanup(); }
});
test('三人实时事件流、独立手牌、旧版本冲突及操作幂等', async () => {
  const f = await fixture(), abort = new AbortController();
  try {
    const h = await f.create('一'), b = await f.join(h.roomId, '二'), c = await f.join(h.roomId, '三');
    const response = await fetch(`${f.base}/api/rooms/${h.roomId}/events`, { headers: { Authorization: 'Bearer ' + h.token }, signal: abort.signal });
    assert.equal(response.headers.get('content-type').includes('text/event-stream'), true);
    const reader = response.body.getReader(), decode = new TextDecoder(); let buffer = '';
    const nextState = async predicate => {
      const end = Date.now() + 3000;
      while (Date.now() < end) {
        let split;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const text = event.split('\n').find(line => line.startsWith('data: '));
          if (text) { const data = JSON.parse(text.slice(6)); if (predicate(data)) return data; }
        }
        const result = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('SSE event timeout')), 3000).unref())]);
        if (result.done) break; buffer += decode.decode(result.value, { stream: true });
      }
      throw new Error('No matching SSE state');
    };
    await nextState(s => s.players.some(p => p.online));
    await f.action(b, { type: 'ready', ready: true }); await f.action(c, { type: 'ready', ready: true });
    await f.action(h, { type: 'start' });
    const event = await nextState(s => s.phase === 'playing'); assert.equal(event.hand.length, 7);
    const hs = await f.read(h), bs = await f.read(b);
    assert.equal(bs.hand.length, 6); assert.equal(hs.hand.some(id => bs.hand.includes(id)), false);
    assert.ok(hs.players.every(p => !('hand' in p) && !('tokenHash' in p)));
    assert.equal('deck' in hs, false); assert.equal('processed' in hs, false);
    const payload = { type: 'chat', text: '测试同步', actionId: randomUUID(), revision: hs.revision };
    assert.equal((await f.request(`/api/rooms/${h.roomId}/actions`, payload, h.token)).status, 200);
    assert.equal((await f.request(`/api/rooms/${h.roomId}/actions`, payload, h.token)).status, 200);
    assert.equal((await f.read(b)).logs.filter(l => l.text.includes('测试同步')).length, 1);
    assert.equal((await f.action(c, { type: 'chat', text: '过期操作' }, hs.revision)).status, 409);
    await reader.cancel();
  } finally { abort.abort(); await f.cleanup(); }
});
test('鉴权、越权、跨源请求、静态资源和目录隔离', async () => {
  const f = await fixture();
  try {
    const h = await f.create('<img src=x onerror=alert(1)>'); // Too long names are rejected.
    assert.equal(h.error, '游戏名称需要 1–16 个字符。');
    const host = await f.create('<b>旅人</b>'), guest = await f.join(host.roomId, '旅伴');
    assert.equal((await f.request('/api/rooms/' + host.roomId)).status, 401);
    assert.equal((await f.request('/api/rooms/' + host.roomId, undefined, 'x'.repeat(43))).status, 401);
    assert.equal((await f.action(guest, { type: 'start' })).status, 400);
    assert.equal((await f.request('/api/rooms', { name: '跨源' }, null, { Origin: 'https://evil.invalid' })).status, 403);
    for (const file of ['/data/' + host.roomId + '.json', '/config.json', '/server.mjs', '/lib/rooms.mjs', '/.git/config']) assert.equal((await fetch(f.base + file)).status, 404);
    for (const file of ['/', '/room/' + host.roomId, '/styles.css', '/app.js', '/table3d.js', '/vendor/three.module.js', '/assets/pride.webp', '/shared/cards.mjs']) {
      const response = await fetch(f.base + file); assert.equal(response.status, 200, file); assert.ok(response.headers.has('Content-Security-Policy'));
    }
  } finally { await f.cleanup(); }
});
test('重启恢复：令牌仅保存哈希，手牌与待结算状态保持', async () => {
  const f = await fixture();
  try {
    const h = await f.create('一'), b = await f.join(h.roomId, '二'), c = await f.join(h.roomId, '三');
    await f.action(b, { type: 'ready', ready: true }); await f.action(c, { type: 'ready', ready: true }); await f.action(h, { type: 'start' });
    const before = await f.read(h), disk = readFileSync(path.join(f.dir, h.roomId + '.json'), 'utf8');
    assert.equal(disk.includes(h.token), false); assert.ok(disk.includes('tokenHash'));
    await f.restart(); const after = await f.read(h);
    assert.deepEqual(after.hand, before.hand); assert.equal(after.turnPlayerId, before.turnPlayerId); assert.equal(after.phase, 'playing');
  } finally { await f.cleanup(); }
});
test('超时接管会实际推进游戏，聊天不会延长行动时限', async () => {
  const f = await fixture();
  try {
    const h = await f.create('一'), b = await f.join(h.roomId, '二'), c = await f.join(h.roomId, '三');
    await f.action(b, { type: 'ready', ready: true }); await f.action(c, { type: 'ready', ready: true }); await f.action(h, { type: 'start' });
    const before = await f.read(h); await f.action(b, { type: 'chat', text: '不延时' }); assert.equal((await f.read(h)).deadline, before.deadline);
    f.store.tick(before.deadline + 1);
    const after = await f.read(h); assert.ok(after.revision > before.revision); assert.ok(after.logs.some(l => l.text.includes('响应超时')));
    // 净化会以光环替换已出的牌，手牌张数可能保持不变。
    assert.equal(after.lastPlay.playerId, h.playerId);
    assert.equal(after.lastPlay.cards.length, 1);
    const played = after.lastPlay.cards[0];
    assert.ok(before.hand.includes(played));
    assert.ok(!after.hand.includes(played));
  } finally { await f.cleanup(); }
});

test('HTTP 暴食最后一张：缺少确认被拒绝且不改手牌，确认后才结算', async () => {
  const f=await fixture();
  try {
    const h=await f.create('确认者'),b=await f.join(h.roomId,'最后一张'),c=await f.join(h.roomId,'旁观旅伴');
    await f.action(b,{type:'ready',ready:true});await f.action(c,{type:'ready',ready:true});await f.action(h,{type:'start'});
    const room=f.store.get(h.roomId),hands=[['gluttony-1','sloth-1'],['pride-1'],['pride-2']];
    room.players.forEach((p,i)=>{p.hand=hands[i];p.stage=i===1?2:6;p.sloth=[];});
    room.deck=Object.keys(CARDS).filter(id=>id!=='halo'&&!hands.flat().includes(id));room.discard=[];room.table=[];room.pending=null;room.haloAvailable=true;assertConservation(room);
    const before=await f.read(h),body={type:'play',cards:['gluttony-1'],top:'gluttony-1',kind:'单张',mode:'steal',targetId:b.playerId};
    const refused=await f.action(h,body);assert.equal(refused.status,400);
    const unchanged=await f.read(h);assert.equal(unchanged.revision,before.revision);assert.deepEqual(unchanged.hand,before.hand);
    const accepted=await f.action(h,{...body,confirmLastCard:true});assert.equal(accepted.status,200);
    const after=await f.read(h);assert.equal(after.phase,'finished');assert.equal(after.winnerId,b.playerId);
    assert.equal((await f.read(c)).logs.some(l=>l.text.includes('傲慢1')),false);
  } finally {await f.cleanup();}
});
test('主存档损坏时读备份；损坏文件保留，不静默删除', async () => {
  const f = await fixture();
  try {
    const h = await f.create('备份玩家'); await f.action(h, { type: 'chat', text: '备份生成' });
    writeFileSync(path.join(f.dir, h.roomId + '.json'), 'broken json');
    await f.restart(); assert.equal((await f.read(h)).players[0].name, '备份玩家');
    assert.ok(f.store.diagnostics.some(m => m.includes('备份恢复')));
  } finally { await f.cleanup(); }
});
test('结束后退出回收手牌、面前懒惰和光环，冠军离开后仍保留名字', async () => {
  const f = await fixture();
  try {
    const h = await f.create('一'), b = await f.join(h.roomId, '二'), c = await f.join(h.roomId, '三');
    await f.action(b, {type:'ready',ready:true}); await f.action(c, {type:'ready',ready:true}); await f.action(h, {type:'start'});
    const r = f.store.get(h.roomId), winner = r.players.find(p => p.id === c.playerId), host = r.players.find(p => p.id === h.playerId);
    r.discard.push(...winner.hand); winner.hand=[]; winner.stage=0; r.phase='finished'; r.winnerId=winner.id;
    const zone = [r.deck,r.discard,r.table,...r.players.flatMap(p => [p.hand,p.sloth])].find(a => a.includes('sloth-1'));
    zone.splice(zone.indexOf('sloth-1'),1); host.sloth.push('sloth-1');
    host.hand.push('halo'); r.haloAvailable=false; assertConservation(r);
    assert.equal((await f.action(h,{type:'leave'})).status,200);
    const after = f.store.get(h.roomId); assertConservation(after); assert.equal(after.haloAvailable,true); assert.ok(after.discard.includes('sloth-1'));
    assert.equal((await f.action(c,{type:'leave'})).status,200);
    assert.equal((await f.read(b)).winnerName,'三');
    assert.equal((await f.action(b,{type:'leave'})).status,200); assert.equal(f.store.rooms.has(h.roomId),false);
  } finally { await f.cleanup(); }
});
test('三个独立客户端经 HTTP 和各自 SSE 完成整局，赢家与公开版本一致', async () => {
  const f = await fixture(), abort = new AbortController(), tasks = [];
  try {
    const h = await f.create('海盐'), b = await f.join(h.roomId, '白夜'), c = await f.join(h.roomId, '流萤');
    const sessions = [h, b, c], latest = new Map();
    for (const session of sessions) {
      const response = await fetch(`${f.base}/api/rooms/${h.roomId}/events`, { headers: { Authorization: 'Bearer ' + session.token }, signal: abort.signal });
      const reader = response.body.getReader(), decoder = new TextDecoder();
      tasks.push((async () => {
        let buffer = '';
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const data = event.split('\n').find(line => line.startsWith('data: '));
              if (data) latest.set(session.playerId, JSON.parse(data.slice(6)));
            }
          }
        } catch (error) { if (!abort.signal.aborted) throw error; }
      })());
    }
    await f.action(b, { type: 'ready', ready: true }); await f.action(c, { type: 'ready', ready: true }); await f.action(h, { type: 'start' });
    let overview = await f.read(h), steps = 0;
    while (overview.phase === 'playing' && steps++ < 1500) {
      const pending = overview.pending;
      const who = pending?.type === 'lustDiscard' ? pending.partners.find(id => !pending.submitted.includes(id)) : pending?.actorId || overview.turnPlayerId;
      const session = sessions.find(s => s.playerId === who), own = await f.read(session);
      let body;
      if (pending) {
        const smallest = own.players.filter(p => p.id !== who).sort((a, b) => a.handCount - b.handCount)[0];
        if (pending.type === 'lustDiscard') body = { type: 'respond', cardId: own.hand.find(id => id !== 'halo' && !hasSuit(id, 'lust')) || null };
        else body = { type: 'respond', ...({ pride: { choice: 'decline' }, wrath: { choice: 'decline' }, lustOffer: { choice: 'accept' }, envy: { choice: own.hand.length > smallest.handCount ? 'swap' : 'keep', targetId: smallest.id }, greed: { choice: 'deal' } }[pending.type]) };
      } else {
        let ids = ['halo'];
        if (!own.hand.includes('halo')) {
          const groups = SUITS.map(s => own.hand.filter(id => hasSuit(id, s)));
          for (let n = 0; n <= 8; n++) groups.push(own.hand.filter(id => card(id).value === n));
          ids = groups.sort((a, b) => b.length - a.length)[0];
        }
        const top = ids.find(id => card(id).suit === 'sloth') || ids.at(-1);
        body = { type: 'play', cards: ids, top, effect: 'sloth', targetId: own.players.find(p => p.id !== who).id, mode: 'steal', direction: 1, confirmLastCard: own.players.find(p => p.id !== who).handCount === 1 };
      }
      const result = await f.action(session, body, own.revision); assert.equal(result.status, 200, JSON.stringify(result.json));
      overview = await f.read(h);
    }
    assert.equal(overview.phase, 'finished'); assert.ok(overview.winnerId);
    for (let tries = 0; tries < 100 && [...latest.values()].some(s => s.revision < overview.revision); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(latest.size, 3);
    for (const session of sessions) {
      const s = latest.get(session.playerId);
      assert.equal(s.winnerId, overview.winnerId); assert.equal(s.revision, overview.revision); assert.equal(s.selfId, session.playerId);
      assert.ok(s.players.every(p => !('hand' in p))); assert.deepEqual(s.hand, (await f.read(session)).hand);
    }
    console.log(`真实 HTTP + SSE：三客户端完成整局，${steps} 次操作，赢家与各自手牌同步通过。`);
    for (const session of sessions) assert.equal((await f.action(session,{type:'leave'})).status,200);
  } finally { abort.abort(); await Promise.allSettled(tasks); await f.cleanup(); }
});
