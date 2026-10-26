import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as cards from '../lib/cards.mjs';
import { wickednessPanel } from '../public/wickedness.js';

const clientSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^bootstrap\(\);\s*$/m, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(fetchImpl) {
  const values = new Map(), toasts = [], location = { pathname: '/room/123456' };
  const history = { replaceState(a, b, path) { location.pathname = path; }, pushState(a, b, path) { location.pathname = path; } };
  const context = vm.createContext({
    ...cards, wickednessPanel, fetch: fetchImpl, TextDecoder, AbortController,
    location, history, console, setInterval: () => 1, clearInterval: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 10)), clearTimeout,
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    document: { addEventListener() {}, querySelector() { return null; } },
    window: { addEventListener() {}, scrollTo() {} },
    testToasts: toasts
  });
  vm.runInContext(clientSource + `\nrender = () => {}; closeModal = () => {}; toast = message => testToasts.push(message); globalThis.client = { state, connect, sendAction, lostSeat, clearRoomSession };`, context);
  const client = context.client;
  const session = { roomId: '123456', playerId: 'p1', token: 'unit-test-placeholder-not-a-real-credential' };
  client.state.session = session;
  client.state.room = roomState();
  values.set('redemption:room:123456', JSON.stringify(session)); values.set('redemption:lastRoom', '123456');
  return { ...client, session, values, toasts, location };
}
function roomState(id = '123456', selfId = 'p1') {
  return { id, selfId, revision: 1, phase: 'lobby', players: [{ id: selfId, online: true }], hand: [], serverTime: Date.now(), pending: null };
}
function stream() {
  let writer;
  const response = new Response(new ReadableStream({ start(controller) { writer = controller; } }));
  return { response, emit: value => writer.enqueue(new TextEncoder().encode(value)) };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('主动退出：移除事件先到达，仍正常回首页并清理座位', async () => {
  const events = stream(); let respond;
  const f = fixture(url => url.endsWith('/events') ? Promise.resolve(events.response) : new Promise(resolve => { respond = resolve; }));
  const connection = f.connect(); await tick();
  const action = f.sendAction({ type: 'leave' }); await tick();
  events.emit('event: removed\ndata: {}\n\n'); await tick();
  respond(json({ left: true })); await action; await connection;
  assert.equal(f.location.pathname, '/'); assert.equal(f.state.session, null); assert.equal(f.state.room, null);
  assert.equal(f.state.busy, false); assert.equal(f.values.has('redemption:room:123456'), false);
  assert.equal(f.values.has('redemption:lastRoom'), false); assert.deepEqual(f.toasts, []);
});
test('主动退出确认后到达的旧 SSE 状态不能复活房间', async () => {
  const events = stream(); let respond;
  const f = fixture(url => url.endsWith('/events') ? Promise.resolve(events.response) : new Promise(resolve => { respond = resolve; }));
  const connection = f.connect(); await tick();
  const action = f.sendAction({ type: 'leave' }); await tick(); respond(json({ left: true })); await action;
  events.emit('event: state\ndata: ' + JSON.stringify(roomState()) + '\n\n'); await connection;
  assert.equal(f.location.pathname, '/'); assert.equal(f.state.session, null); assert.equal(f.state.room, null);
  assert.deepEqual(f.toasts, []);
});
test('旧请求迟到不会覆盖新房间或解除新操作的忙碌状态', async () => {
  let respond;
  const f = fixture(() => new Promise(resolve => { respond = resolve; }));
  const action = f.sendAction({ type: 'ready', ready: true }); await tick();
  f.lostSeat();
  const nextSession = { roomId: '654321', playerId: 'p2', token: 'another-test-placeholder' };
  f.state.session = nextSession; f.state.room = roomState('654321', 'p2'); f.state.busy = true;
  f.location.pathname = '/room/654321';
  respond(json(roomState())); await action;
  assert.equal(f.state.session, nextSession); assert.equal(f.state.room.id, '654321');
  assert.equal(f.state.busy, true); assert.equal(f.location.pathname, '/room/654321');
});
test('退出响应丢失后重试得到 404，也应正常回首页', async () => {
  let calls = 0;
  const f = fixture(async url => {
    assert.equal(url, '/api/rooms/123456/actions');
    if (++calls === 1) throw new TypeError('Simulated network disconnect');
    return json({ error: '房间不存在。' }, 404);
  });
  await f.sendAction({ type: 'leave' });
  assert.equal(calls, 2); assert.equal(f.location.pathname, '/'); assert.equal(f.state.session, null);
  assert.deepEqual(f.toasts, []);
});
test('非主动移除也回到首页，不残留失效房间链接', () => {
  const f = fixture(() => { throw new Error('No network call expected'); });
  f.lostSeat();
  assert.equal(f.location.pathname, '/'); assert.equal(f.state.room, null); assert.equal(f.state.session, null);
  assert.equal(f.values.has('redemption:room:123456'), false); assert.equal(f.toasts.length, 1);
});
