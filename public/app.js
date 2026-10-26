import { CARDS, SUITS, META, card, label, hasSuit, meldOptions, selectionPlan } from '/shared/cards.mjs';
import { wickednessPanel } from './wickedness.js';
import { artUrl } from './art.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>', link: '<path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4m10 0 2-2a4 4 0 0 1 6 6l-4 4"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>', users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m2-14a3 3 0 0 1 0 6m2 8v-3a5 5 0 0 0-2-4"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>', shield: '<path d="m12 3 8 4v6c0 5-8 8-8 8S4 18 4 13V7Z"/><path d="m8 12 3 3 5-6"/>', copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  book: '<path d="M12 5c-4-3-9-2-9-2v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Zm0 0v16"/>', send: '<path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.plus}</svg>`;
const storage = { get(key) { try { return localStorage.getItem(key); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, value); } catch {} }, remove(key) { try { localStorage.removeItem(key); } catch {} } };
const state = {
  room: null, session: null, selected: new Set(), connected: false, busy: false, publicUrl: '', top: '', target: '', effect: 'sloth', mode: 'draw', direction: '1', timerOffset: 0, nameError: '', roomError: '', leavingRoomId: null, meldKind: '', playError: '', stealConfirmation: null,
  inputs: { playerName: storage.get('redemption:name') || '', inviteName: storage.get('redemption:name') || '', roomId: '', chat: '', starter: '', responseCard: '', responseTarget: '' }
};
let streamGeneration = 0, abortStream, scene, sceneNode, toastTimer, lastStateKey = '', sceneLoading;
const pathRoom = () => location.pathname.match(/^\/room\/(\d{6})\/?$/)?.[1] || null;
const nameOf = id => state.room?.players.find(p => p.id === id)?.name || (id === state.room?.winnerId ? state.room?.winnerName : null) || '旅伴';
const self = () => state.room?.players.find(p => p.id === state.session?.playerId);
const invitation = () => `${(state.publicUrl || location.origin).replace(/\/$/, '')}/room/${state.room.id}`;
const savedSession = id => { try { return JSON.parse(storage.get('redemption:room:' + id)); } catch { return null; } };
const cardHTML = (id, selected = false, action = 'card', extra = '') => {
  const c = card(id), m = META[c.suit];
  const order = selected ? selectionPlan([...state.selected], state.meldKind).cards.indexOf(id) + 1 : 0;
  return `<button type="button" class="game-card${selected ? ' selected' : ''}${selected && id === state.top ? ' execution-card' : ''}" style="--ink:${m.color};--selection-order:${order}" data-action="${action}" data-card="${id}" aria-label="${escape(label(id) + '，' + m.short + (selected ? `，待出第 ${order} 张${id === state.top ? '，最上方' : ''}` : ''))}" aria-pressed="${selected}" title="${escape(m.text)}" ${extra}><span class="card-ink"><span class="card-top"><span class="card-value">${c.value ?? '◎'}</span><span>${m.name}</span></span><img class="card-art" src="${artUrl(c.suit)}" alt="${m.name}插画" draggable="false"><span class="card-description"><b>${m.short}</b><small>${m.english}</small></span></span>${selected ? `<span class="selection-check" aria-hidden="true">${order}</span>` : ''}</button>`;
};
function toast(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = 'toast visible' + (error ? ' error' : '');
  toastTimer = setTimeout(() => { $('#toast').className = 'toast'; }, 4500);
}
async function api(url, body, token = state.session?.token) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) { const e = new Error(result.error || '请求失败，请稍后重试。'); e.status = response.status; throw e; }
  return result;
}
const header = () => `<header class="site-header"><a class="brand" href="/" data-action="home"><img src="/assets/favicon.svg" alt=""><span><span class="brand-title">赎罪之旅</span><span class="brand-sub">THE DEADLIES · ONLINE</span></span></a><nav class="header-nav" aria-label="主要导航"><button type="button" class="nav-button" data-action="rules">玩法速览</button><button type="button" class="nav-button" data-action="gallery">卡牌图鉴</button><span class="header-status"><i class="status-dot ${state.room && !state.connected ? 'offline' : ''}"></i>${state.room ? (state.connected ? '已连接牌桌' : '正在重连') : '邀上朋友，即刻开局'}</span></nav></header>`;
const footer = () => `<footer class="site-footer"><span>赎罪之旅 <span class="footer-diamonds"> · ◇ ◇ ◇</span></span><span>原作 The Deadlies · 私人好友牌桌</span></footer>`;
const field = (id, title, placeholder, max = 16, extra = '') => `<div><label for="${id}">${title}</label><input id="${id}" name="${id}" value="${escape(state.inputs[id] || '')}" placeholder="${placeholder}" maxlength="${max}" ${extra}></div>`;
function sceneSlot(mode) { return `<div class="scene-slot" id="scene-slot" data-scene-mode="${mode}" aria-label="Three.js 立体牌桌"></div>`; }
function landing() {
  const resumeId = storage.get('redemption:lastRoom'), resume = /^\d{6}$/.test(resumeId) && savedSession(resumeId);
  return `<main class="home-page">
    <div class="home-backdrop" aria-hidden="true" inert>${sceneSlot('hero')}</div>
    <div class="home-layout">
      <section class="home-intro" aria-labelledby="game-title">
        <p class="eyebrow">一场关于放下的朋友局</p>
        <h1 id="game-title">赎罪之旅</h1>
        <p class="home-tagline">放下七宗罪，走向<span>救赎。</span></p>
        <p class="home-description">傲慢、贪婪、嫉妒……谁能最先摆脱它们？<br>打出你的牌，猜透朋友的心思。<br>三次清空手牌，让这场充满诱惑的旅程，由你先抵达终点。</p>
        <div class="home-facts"><span>${icon('users')}3–5 位旅伴</span><span>${icon('time')}约 30 分钟</span><span>${icon('shield')}无需注册</span></div>
        ${resume ? `<a class="home-resume" href="/room/${resumeId}">继续上次旅程 #${resumeId} →</a>` : ''}
      </section>
      <section class="home-entry" aria-labelledby="entry-title">
        <h2 id="entry-title">准备入座</h2>
        <p class="home-entry-description">取个名字，与朋友一起开始这段旅程。</p>
        <form id="entry-form" novalidate>
          ${field('playerName', '你的游戏名称', '大家怎么称呼你？', 16, `autocomplete="nickname" required aria-describedby="name-error" aria-invalid="${!!state.nameError}" ${state.busy ? 'disabled' : ''}`)}
          <p id="name-error" class="home-form-error" role="alert">${escape(state.nameError)}</p>
          <div class="home-entry-actions">
            <button class="btn gold" type="submit" ${state.busy ? 'disabled' : ''}>${icon('plus')}${state.busy ? '正在进入牌桌…' : '建立房间'}</button>
            <button class="btn" type="button" data-action="open-join" ${state.busy ? 'disabled' : ''}>${icon('link')}加入别人房间</button>
          </div>
        </form>
        <p class="home-entry-note">无需注册 · 随时邀请朋友加入</p>
      </section>
    </div>
  </main>`;
}
function entryName() {
  const name = ($('#playerName')?.value ?? state.inputs.playerName).trim().replace(/[\u0000-\u001f\u007f]/g, '');
  state.nameError = !name ? '请先输入你的游戏名称。' : [...name].length > 16 ? '游戏名称最多 16 个字符。' : '';
  const input = $('#playerName'), error = $('#name-error');
  if (input) input.setAttribute('aria-invalid', String(!!state.nameError));
  if (error) error.textContent = state.nameError;
  if (state.nameError) { input?.focus(); return null; }
  state.inputs.playerName = name; return name;
}
function showRoomError(message) {
  state.roomError = message;
  const error = $('#room-error'); if (error) error.textContent = message;
}
function joinDialog() {
  if (state.busy) return;
  const name = entryName(); if (!name) return;
  state.roomError = '';
  openModal('加入别人房间', `<form class="join-room-form" id="join-room-form" novalidate>
    <p class="join-room-name">以 <strong>${escape(name)}</strong> 的身份，加入朋友的牌桌。</p>
    ${field('roomId', '六位房间号', '输入朋友的六位房间号', 6, 'inputmode="numeric" autocomplete="off" required aria-describedby="room-error" aria-invalid="false"')}
    <p class="home-form-error" id="room-error" role="alert"></p>
    <div class="join-room-actions"><button type="button" class="btn ghost" data-action="close">取消</button><button type="submit" class="btn gold" id="join-room-submit">加入${icon('arrow')}</button></div>
  </form>`);
  $('#roomId').focus();
}
function joinDialogBusy(busy) {
  const form = $('#join-room-form'); if (!form) return;
  form.querySelectorAll('button,input').forEach(el => { el.disabled = busy; });
  const close = $('.close-modal'); if (close) close.disabled = busy;
  $('#join-room-submit').innerHTML = busy ? '正在加入…' : `加入${icon('arrow')}`;
}
function inviteLanding(id) {
  return `<main><section class="box invite-entry"><p class="eyebrow">你收到了一份旅程邀请</p><h1>朋友的牌桌，等你入座。</h1><p class="muted tiny">房间 <span class="serif" style="color:#ddbd84;letter-spacing:3px">${id}</span> · 输入名字即可加入，无需注册。</p><form id="invite-form"><div class="form-row">${field('inviteName', '你的游戏名称', '大家怎么称呼你？', 16, 'autocomplete="nickname" required')}</div><button type="submit" class="btn gold wide" ${state.busy ? 'disabled' : ''}>加入这段旅程${icon('arrow')}</button></form><p class="footnote">已在这个房间？使用原来的浏览器即可恢复座位。</p><button type="button" class="nav-button" data-action="home">← 返回首页</button></section></main>`;
}
const avatarColors = ['#a18bba', '#b79c6b', '#7b9e93', '#b87d8c', '#7e97b3'];
const avatar = (p, i) => `<div class="avatar" style="--avatar:${avatarColors[i % 5]}">${escape([...p.name][0])}</div>`;
function lobby() {
  const r = state.room, isHost = r.hostId === state.session.playerId, ready = r.players.every(p => p.id === r.hostId || p.ready), me = self();
  return `<main><div class="page-heading"><div><span class="breadcrumb">朋友的牌桌 / 等待入座</span><h1>${escape(r.title)}</h1><p class="muted tiny">旅程开始前，先等一等你的朋友。</p></div><button type="button" class="btn ghost" data-action="leave">离开房间</button></div><div class="lobby-layout"><section class="box"><h2>${icon('users')}已入座的旅伴 <span class="section-count">${r.players.length} / 5</span></h2><div class="seat-grid">${Array.from({ length: 5 }, (_, i) => {
    const p = r.players[i];
    if (!p) return '<div class="seat empty"><span style="font-size:24px;font-weight:200">＋</span><span class="tiny">等待旅伴</span></div>';
    return `<div class="seat ${p.id === me.id ? 'self' : ''}">${p.id === r.hostId ? '<span class="host-tag">房主</span>' : ''}${isHost && p.id !== me.id ? `<button class="kick" data-action="kick" data-player="${p.id}" aria-label="移除 ${escape(p.name)}">×</button>` : ''}${avatar(p, i)}<div class="seat-name">${escape(p.name)}${p.id === me.id ? ' <span class="muted">/ 你</span>' : ''}</div><div class="seat-state ${p.ready || p.id === r.hostId ? 'ready' : ''}"><i class="status-dot ${p.online ? '' : 'offline'}"></i> ${p.id === r.hostId ? '掌灯人已就位' : (p.ready ? '已准备' : '还未准备')}${!p.online ? ' · 离线' : ''}</div></div>`;
  }).join('')}</div><div class="lobby-controls">${isHost ? `<div><label for="starter">起始玩家</label><select id="starter">${r.players.map(p => `<option value="${p.id}" ${(state.inputs.starter || r.hostId) === p.id ? 'selected' : ''}>${escape(p.name)}${p.id === r.hostId ? '（房主）' : ''}</option>`).join('')}</select></div><button type="button" class="btn gold" data-action="start" ${r.players.length < 3 || !ready || state.busy || !state.connected ? 'disabled' : ''}>开始旅程${icon('arrow')}</button>` : `<p class="tiny muted" style="flex:1">${me.ready ? '已准备，等待房主开始。' : '准备好后，让房主知道。'}</p><button type="button" class="btn ${me.ready ? 'ghost' : 'gold'}" data-action="ready" ${state.busy || !state.connected ? 'disabled' : ''}>${me.ready ? '取消准备' : '我已准备'}</button>`}</div><div class="info-strip">${r.players.length < 3 ? `还需 ${3 - r.players.length} 位旅伴即可开局。` : !ready ? '等待所有旅伴准备后，由房主开始。' : '所有旅伴已就位，旅程随时可以开始。'} 原版规则为 3–5 人，起始玩家多摸 1 张。</div></section><aside class="box"><h2>邀请朋友来坐坐</h2><div class="invite-code">${r.id}</div><p class="tiny muted" style="text-align:center">告诉朋友这个六位房间号</p><div class="invite-divider"></div><p class="tiny" style="color:#cbb8d5">或者，送出一份邀请链接</p><div class="invite-url">${escape(invitation())}</div><button type="button" class="btn wide" data-action="copy">${icon('copy')}复制邀请链接</button><div class="invite-divider"></div><div class="mini-howto"><span class="step-number">1</span><p>朋友打开链接，输入自己的游戏名称。</p></div><div class="mini-howto"><span class="step-number">2</span><p>所有人准备后，房主开始旅程。</p></div><div class="mini-howto"><span class="step-number">3</span><p>保留当前浏览器，即可断线重连。</p></div></aside></div></main>`;
}
function opponent(p, i) {
  const r = state.room, cleared = 3 - p.stage / 2;
  return `<div class="opponent ${r.turnPlayerId === p.id ? 'active' : ''}"><i class="status-dot ${p.online ? '' : 'offline'}"></i>${avatar(p, i)}<div><div class="opponent-name">${escape(p.name)}</div><div class="opponent-meta">手牌 <b>${p.handCount}</b> · 罪恶值 <b>${p.stage}</b>${p.sloth.length ? ' · 💤' : ''}</div><div class="stage-mini" title="已完成 ${cleared} 次清手">${[0, 1, 2].map(n => `<i class="${n < cleared ? 'done' : ''}"></i>`).join('')}</div></div></div>`;
}
function currentSelection() {
  const ids = [...state.selected], options = meldOptions(ids);
  if (state.meldKind && !options.some(o => o.kind === state.meldKind)) state.meldKind = '';
  const plan = selectionPlan(ids, state.meldKind);
  state.top = plan.top;
  return plan;
}
function selectionControls() {
  const r = state.room, plan = currentSelection(), ids = [...state.selected];
  const selectedTop = card(plan.top), effect = selectedTop?.suit === 'corruption' ? state.effect : selectedTop?.suit;
  const others = r.players.filter(p => p.id !== state.session.playerId);
  if (!others.some(p => p.id === state.target)) state.target = others[0]?.id || '';
  const select = (id, title, opts) => `<div><label for="${id}">${title}</label><select id="${id}">${opts}</select></div>`;
  const option = (value, text, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${escape(text)}</option>`;
  let fields = '';
  if (plan.options.length > 1) fields += select('meldKind', '组合方式', plan.options.map(o => option(o.kind, o.kind, plan.kind)).join(''));
  if (selectedTop?.suit === 'corruption') fields += select('effect', '腐化的效果', SUITS.map(s => option(s, META[s].name, state.effect)).join(''));
  if (effect === 'gluttony') fields += select('mode', '暴食的选择', option('draw', '摸 3 张，再行动', state.mode) + option('steal', '抽取对手 1 张，再行动', state.mode));
  if (['pride', 'wrath', 'lust'].includes(effect) || (effect === 'gluttony' && state.mode === 'steal')) fields += select('target', '选择一名旅伴', others.map(p => option(p.id, `${p.name} · ${p.handCount} 张手牌`, state.target)).join(''));
  if (effect === 'greed') fields += select('direction', '贪婪的发牌方向', option('1', '顺时针 →', state.direction) + option('-1', '逆时针 ←', state.direction));
  const queue = plan.valid ? plan.cards : ids;
  return `<section class="action-panel box" aria-label="出牌操作"><div class="action-body"><p class="selection-status ${ids.length && !plan.valid ? 'invalid' : ''}">${ids.length ? (plan.valid ? `${plan.kind} · 按下方顺序叠放` : plan.reason) : '点选手牌后，点击“出牌”提交。'}</p>${queue.length ? `<ol class="selection-order" aria-label="待出牌顺序，从底到顶">${queue.map((id, i) => `<li class="${id === plan.top ? 'execution' : ''}" style="--ink:${META[card(id).suit].color}"><span class="queue-number">${i + 1}</span><span>${label(id)}</span>${id === plan.top ? '<b>最上方</b>' : ''}</li>`).join('')}</ol>` : '<p class="selection-empty">同花色、同数字，或至少两张连续数字。</p>'}${plan.valid ? `<div class="execution-summary"><span>本次发动</span><strong>${label(plan.top)}${selectedTop?.suit === 'corruption' ? ` · ${META[effect]?.name || ''}` : ''}</strong><small>${plan.kind === '顺子' ? '顺子自动升序，最大数字在最上方。' : '最后选中的牌在最上方。'}</small></div>` : ''}<div class="selection-options">${fields}</div>${state.playError ? `<p class="play-validation" role="alert">${escape(state.playError)}</p>` : ''}<div class="action-footer"><span class="timer" data-timer></span><button type="button" class="nav-button" data-action="clear" ${ids.length ? '' : 'disabled'}>清除选择</button></div></div><div class="action-heading action-submit-row"><div><h2>出牌操作</h2><span class="action-count">已选 ${ids.length} 张</span></div><button type="button" class="nav-button mobile-controls-toggle" data-action="show-controls">出牌设置</button><button type="button" class="btn gold play-submit" data-action="play" ${!ids.length || state.busy || !state.connected ? 'disabled' : ''}>${state.busy ? '提交中…' : `出牌${ids.length ? `（${ids.length}张）` : ''}`}${icon('arrow')}</button></div></section>`;
}
function actionPanel() {
  const r = state.room;
  if (r.phase === 'playing' && r.turnPlayerId === r.selfId && !r.pending) return selectionControls();
  return `<section class="action-panel box" aria-label="牌局操作"><div class="action-heading"><div><h2>${r.pending ? '牌效处理' : r.phase === 'finished' ? '本局结束' : '等待行动'}</h2><span class="action-count">${r.phase === 'finished' ? '可点击手牌查看效果' : r.pending ? '先完成当前效果' : `轮到 ${escape(nameOf(r.turnPlayerId))}`}</span></div><button type="button" class="nav-button mobile-controls-toggle" data-action="show-controls">${r.pending ? '查看响应' : '查看状态'}</button></div><div class="action-body">${r.pending ? effectPanel() : `<p class="selection-empty">${r.phase === 'finished' ? '可由房主开始下一局。' : '等待旅伴出牌。'}</p><span class="timer" data-timer></span>`}</div></section>`;
}
function refreshSelection(keyboard = false) {
  const plan = currentSelection(), ids = plan.cards, focusedId = document.activeElement?.id;
  const hand = $('.hand-cards'); if (hand) hand.dataset.selectionInput = keyboard ? 'keyboard' : 'pointer';
  document.querySelectorAll('.hand-cards .game-card').forEach(el => {
    const index = ids.indexOf(el.dataset.card), selected = index >= 0;
    el.classList.toggle('selected', selected); el.classList.toggle('execution-card', selected && el.dataset.card === plan.top);
    el.setAttribute('aria-pressed', String(selected)); el.style.setProperty('--selection-order', String(index + 1));
    el.setAttribute('aria-label', label(el.dataset.card) + '，' + META[card(el.dataset.card).suit].short + (selected ? `，待出第 ${index + 1} 张${el.dataset.card === plan.top ? '，最上方' : ''}` : ''));
    let badge = el.querySelector('.selection-check');
    if (selected) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'selection-check'; el.appendChild(badge); }
      badge.textContent = String(index + 1); badge.setAttribute('aria-hidden', 'true');
    } else badge?.remove();
  });
  const panel = $('.action-panel'); if (panel) panel.outerHTML = actionPanel();
  const queue = $('.selection-order'); if (queue) queue.scrollTop = queue.scrollHeight;
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  updateTimers();
}
function selectionError(message) {
  state.playError = message; refreshSelection(); toast(message, true);
}
async function submitSelected(confirmation = null) {
  if (state.busy || !state.room || !state.session) return;
  const r = state.room;
  if (!state.connected) { selectionError('连接正在恢复，请稍后再出牌。'); return; }
  if (r.phase !== 'playing' || r.turnPlayerId !== r.selfId || r.pending) { selectionError('当前不能出牌，请等待自己的回合或完成牌效。'); return; }
  const plan = currentSelection();
  if (!plan.valid) { selectionError(plan.reason); return; }
  if (!plan.cards.every(id => r.hand.includes(id))) { selectionError('手牌已变化，请重新选择。'); return; }
  const effect = card(plan.top).suit === 'corruption' ? state.effect : card(plan.top).suit;
  const target = r.players.find(p => p.id === state.target && p.id !== r.selfId);
  if (card(plan.top).suit === 'corruption' && !SUITS.includes(effect)) { selectionError('请选择腐化要发动的效果。'); return; }
  if ((['pride','wrath','lust'].includes(effect) || effect === 'gluttony' && state.mode === 'steal') && !target) { selectionError('请选择一名有效的旅伴。'); return; }
  if (effect === 'gluttony' && !['draw','steal'].includes(state.mode)) { selectionError('请选择暴食的行动。'); return; }
  if (effect === 'gluttony' && state.mode === 'steal' && !target.handCount) { selectionError('对方没有可以抽取的手牌。'); return; }
  if (effect === 'greed' && ![1,-1].includes(Number(state.direction))) { selectionError('请选择贪婪的发牌方向。'); return; }
  const signature = JSON.stringify([r.id,r.turnNo,plan.cards,plan.kind,plan.top,effect,state.mode,state.target,target?.handCount,target?.stage]);
  if (confirmation && confirmation.signature !== signature) { selectionError('牌局或选牌已变化，请重新确认。'); return; }
  const lastCard = effect === 'gluttony' && state.mode === 'steal' && target.handCount === 1;
  if (lastCard && !confirmation) {
    state.stealConfirmation = { signature, roomId:r.id, turnNo:r.turnNo };
    const consequence = target.stage <= 2 ? `<strong>${escape(target.name)} 将立即清空手牌并赢得本局。</strong>` : `${escape(target.name)} 将立即晋级，罪恶值由 ${target.stage} 降至 ${target.stage - 2}，并按规则补牌。`;
    openModal('确认抽取对方最后一张牌？', `<div class="last-card-warning"><p>${escape(target.name)} 当前只剩 <strong>1 张手牌</strong>。</p><p>${consequence}</p><p class="tiny muted">仍要用暴食抽取这张牌吗？</p></div><div class="effect-actions"><button type="button" class="btn ghost" data-action="close">取消，保留选牌</button><button type="button" class="btn danger" data-action="confirm-last-card">仍然抽取</button></div>`);
    return;
  }
  state.playError = ''; state.stealConfirmation = null;
  await sendAction({ type:'play',cards:plan.cards,top:plan.top,kind:plan.kind,effect:state.effect,targetId:state.target,mode:state.mode,direction:Number(state.direction),confirmLastCard:lastCard && Boolean(confirmation) });
}
const responseCards = suit => state.room.hand.filter(id => hasSuit(id, suit));
function effectPanel() {
  const r = state.room, p = r.pending;
  if (!p) return '';
  const mine = p.actorId === state.session.playerId || p.type === 'lustDiscard' && p.partners.includes(state.session.playerId);
  const titles = { pride: '傲慢 · 亮出你的底气', wrath: '愤怒 · 这场较量继续吗？', envy: '嫉妒 · 换一副命运', lustOffer: '色欲 · 一次心照不宣的邀请', lustDiscard: '色欲 · 暗置，然后同时揭晓', greed: '贪婪 · 见好就收，还是再赌一张？' };
  const button = (text, choice, gold = false, disabled = false) => `<button class="btn ${gold ? 'gold' : 'ghost'}" data-action="respond" data-choice="${choice}" ${state.busy || !state.connected || disabled ? 'disabled' : ''}>${text}</button>`;
  const choiceCards = ids => `<select id="responseCard" aria-label="选择响应的卡牌">${ids.map(id => `<option value="${id}" ${state.inputs.responseCard === id ? 'selected' : ''}>${label(id)}</option>`).join('')}</select>`;
  let desc = '', controls = '';
  if (!mine) desc = p.type === 'lustDiscard' ? `等待 ${p.partners.filter(id => !p.submitted.includes(id)).map(nameOf).map(escape).join('、')} 暗置手牌，其他人看不到选择。` : `等待 ${escape(nameOf(p.actorId))} 完成选择。`;
  else switch (p.type) {
    case 'pride': desc = `${escape(nameOf(p.sourceId))} 问你：“你有傲慢吗？”展示后对方摸 1 张；不展示则自己摸 1 张。`; controls = choiceCards(responseCards('pride')) + button('展示这张', 'show', true) + button('不展示，我摸 1 张', 'decline'); break;
    case 'wrath': desc = '你已经摸了 2 张。现在可以弃一张愤怒或腐化，让对方也摸 2 张。'; controls = choiceCards(responseCards('wrath')) + button('弃牌反击', 'reflect', true) + button('结束较量', 'decline'); break;
    case 'envy': desc = '摸牌后手中没有嫉妒或腐化。你可以与另一名玩家交换全部手牌。'; controls = `<select id="responseTarget" aria-label="交换手牌的玩家">${r.players.filter(p => p.id !== r.selfId).map(p => `<option value="${p.id}" ${state.inputs.responseTarget === p.id ? 'selected' : ''}>${escape(p.name)} / ${p.handCount} 张</option>`).join('')}</select>` + button('交换手牌', 'swap', true) + button('保留手牌', 'keep'); break;
    case 'lustOffer': desc = `${escape(nameOf(p.sourceId))} 邀请你参与暗弃。接受后，双方可以各暗弃 1 张，也可以不弃；弃出色欲会令对方摸 3 张。`; controls = button('参与暗弃', 'accept', true) + button('什么也不做', 'decline'); break;
    case 'lustDiscard': {
      const submitted = p.submitted.includes(r.selfId);
      desc = submitted ? '你已提交暗置选择。等待对方，双方选择将在全部提交后同时揭晓。' : '选择一张手牌暗弃，也可不弃。光环不能暗弃；腐化视为色欲。提交后不可更改。';
      if (!submitted) controls = choiceCards(r.hand.filter(id => id !== 'halo')) + button('暗弃这张', 'discard', true, !r.hand.some(id => id !== 'halo')) + button('不弃牌', 'none');
      break;
    }
    case 'greed': desc = `已发 ${p.dealt.length} / 5 张，其中 ${p.nonGreed} 张非贪婪。${p.canStop ? '现在可以停止，让对方收牌。' : '现在还不能停止。'}五张成功清空手牌，非贪婪同色重复或腐化会失败。`; controls = button('再发一张', 'deal', true) + button('见好就收', 'stop', false, !p.canStop); break;
  }
  const revealed = p.type === 'greed' ? `<div class="greed-cards">${p.dealt.map(d => `<span class="greed-card" style="color:${META[card(d.card).suit].color}">${label(d.card)} → ${escape(nameOf(d.to))}</span>`).join('')}</div>` : '';
  return `<section class="effect-box" aria-live="polite"><h3>${titles[p.type]}</h3><p>${desc}</p>${revealed}${controls ? `<div class="effect-actions">${controls}</div>` : ''}<div class="timer tiny" data-timer></div></section>`;
}
function logPanel() {
  return `<section class="box log-box"><div class="log-header"><h2>旅程手记</h2><span>本局实时记录</span></div><div class="log-list" id="log-list">${state.room.logs.map(entry => `<div class="log-entry ${entry.type}"><time>${new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>${escape(entry.text)}</div>`).join('')}</div><form id="chat-form" class="chat-form"><label class="visually-hidden" for="chat">发送桌边消息</label><input id="chat" value="${escape(state.inputs.chat)}" placeholder="说点什么…" maxlength="180" autocomplete="off"><button class="btn ghost" type="submit" aria-label="发送消息" ${state.busy ? 'disabled' : ''}>${icon('send')}</button></form></section>`;
}
function board() {
  const r = state.room, me = self(), myTurn = r.turnPlayerId === me.id && !r.pending && r.phase === 'playing';
  const seatIndex = r.players.findIndex(p => p.id === me.id), others = [...r.players.slice(seatIndex + 1), ...r.players.slice(0, seatIndex)], actionMarkup = actionPanel();
  const sideCount = Math.ceil(others.length / 2), leftOpponents = others.slice(0, sideCount).reverse(), rightOpponents = others.slice(sideCount);
  return `<main><div class="game-layout"><div class="table-column"><div class="room-top"><p class="room-tag">${escape(r.title)} <strong>#${r.id}</strong></p><div class="room-tools"><button class="nav-button" data-action="copy">复制邀请</button><button class="nav-button" data-action="rules">规则</button><button class="nav-button" data-action="leave">${r.phase === 'playing' ? '暂离' : '离开'}</button></div></div>${r.phase === 'finished' ? `<section class="winner-box"><span class="winner-icon">♧</span><h2>${escape(nameOf(r.winnerId))}，完成救赎。</h2><p>三次清空手牌，走到了旅程的终点。</p>${r.hostId === me.id ? '<button class="btn gold" data-action="rematch">再开启一段旅程</button>' : '<span class="tiny muted">等待房主开启下一局，或离开房间。</span>'}</section>` : ''}<div class="table-arena"><div class="opponents opponents-left" aria-label="左侧旅伴">${leftOpponents.map(p => opponent(p, others.indexOf(p))).join('')}</div><section class="table-stage"><div class="table-caption"><strong>${r.phase === 'finished' ? '旅 程 已 抵 达 终 点' : r.pending ? '罪 孽 正 在 结 算' : myTurn ? '轮 到 你 的 回 合' : `${escape(nameOf(r.turnPlayerId))} 的 回 合`}</strong><p>${r.phase === 'playing' ? `第 ${r.turnNo} 回合 <span data-timer class="timer"></span>` : '谢谢每一位同行的旅伴'}</p></div>${sceneSlot('board')}<div class="pile-labels"><span>抽牌堆<b>${r.deckCount}</b></span><span>弃牌堆<b>${r.discardCount}</b></span><span>光环<b>${r.haloAvailable ? '可获取' : '已入手'}</b></span></div></section><div class="opponents opponents-right" aria-label="右侧旅伴">${rightOpponents.map(p => opponent(p, others.indexOf(p))).join('')}</div></div><div class="player-area">${wickednessPanel(me.stage, { finished: r.phase === 'finished', winner: r.winnerId === me.id })}<section class="hand-zone"><div class="hand-heading"><strong>${escape(me.name)}的手牌 <span class="muted">/ ${r.hand.length} 张${me.sloth.length ? ' · 懒惰生效中' : ''}</span></strong></div><div class="hand-scroll"><div class="hand-cards">${[...r.hand].sort((a, b) => { const ca = card(a), cb = card(b); return Object.keys(META).indexOf(ca.suit) - Object.keys(META).indexOf(cb.suit) || ca.value - cb.value; }).map(id => cardHTML(id, state.selected.has(id))).join('') || '<p class="muted tiny">手中已没有罪孽。</p>'}</div></div><p class="hand-instruction">${myTurn ? '点击选牌或取消；在操作区点击“出牌”提交。' : r.pending ? '请在操作区处理当前牌效。' : '点击手牌可查看效果。'}</p></section></div></div><aside class="game-sidebar">${logPanel()}${actionMarkup}</aside></div></main>`;
}
function render() {
  const active = document.activeElement, focusedId = active?.id, selectionStart = active?.selectionStart, selectionEnd = active?.selectionEnd;
  const handScroll = $('.hand-scroll')?.scrollLeft || 0, handFocus = active?.closest?.('.hand-cards .game-card')?.dataset.card;
  const logEl = $('#log-list'), logScroll = logEl?.scrollTop, logAtEnd = !logEl || logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80;
  $('#app').innerHTML = `<div class="shell${!state.room && !pathRoom() ? ' home-shell' : ''}">${header()}${state.room && !state.connected ? '<div class="connection-banner" role="status">与牌桌的连接暂时中断，正在自动重连。你的座位和手牌会保留。</div>' : ''}${state.room ? (state.room.phase === 'lobby' ? lobby() : board()) : pathRoom() ? inviteLanding(pathRoom()) : landing()}${footer()}</div>`;
  if (focusedId) { const el = document.getElementById(focusedId); if (el) { el.focus({ preventScroll: true }); try { if (typeof selectionStart === 'number') el.setSelectionRange(selectionStart, selectionEnd); } catch {} } }
  const newHand = $('.hand-scroll'); if (newHand) newHand.scrollLeft = handScroll;
  if (handFocus) document.querySelector(`.hand-cards [data-card="${handFocus}"]`)?.focus({ preventScroll: true });
  const newLog = $('#log-list'); if (newLog) newLog.scrollTop = logAtEnd ? newLog.scrollHeight : logScroll;
  mountScene(); updateTimers();
}
function mountScene() {
  const slot = $('#scene-slot'); if (!slot) return;
  const mode = slot.dataset.sceneMode;
  if (!sceneNode) {
    sceneNode = document.createElement('div'); sceneNode.className = 'scene-root';
    sceneNode.innerHTML = '<div class="scene-fallback"></div>';
  }
  const fallback = sceneNode.querySelector('.scene-fallback');
  const fallbackKey = mode + ':' + (state.room?.revision || 0);
  if (fallback.dataset.key !== fallbackKey) {
    fallback.dataset.key = fallbackKey; fallback.classList.toggle('board-fallback', mode === 'board');
    fallback.innerHTML = mode === 'hero'
      ? ['greed-3', 'pride-7', 'lust-5'].map((id, i) => cardHTML(id, false, 'inspect').replace('style="', `style="--fan:${(i - 1) * 18}deg;`)).join('')
      : `<div class="card-back" aria-label="抽牌堆"><img src="/assets/favicon.svg" alt="牌背"></div>${state.room.discardTop ? cardHTML(state.room.discardTop, false, 'inspect') : '<div class="empty-pile" aria-label="弃牌堆为空"></div>'}${state.room.haloAvailable ? cardHTML('halo', false, 'inspect') : '<div class="empty-pile" aria-label="光环已收入玩家手中">◎</div>'}`;
  }
  slot.replaceWith(sceneNode);
  if (scene) { scene.update(state.room, mode); return; }
  if (!sceneLoading) {
    sceneLoading = import('./table3d.js').then(async ({ TableScene }) => {
      const candidate = new TableScene(sceneNode); await candidate.init(); scene = candidate; sceneNode.classList.add('loaded');
      scene.update(state.room, state.room?.phase !== 'lobby' && state.room ? 'board' : 'hero');
    }).catch(error => { console.warn('3D 牌桌不可用，使用卡牌视图。', error.message); sceneNode.setAttribute('aria-label', '此设备使用兼容卡牌视图'); });
  }
}
function setRoom(room) {
  if (!state.session || room.id !== state.session.roomId || room.selfId !== state.session.playerId) return;
  if (state.room && room.revision < state.room.revision) return;
  const phaseChanged = state.room && state.room.phase !== room.phase;
  if (state.stealConfirmation && (state.stealConfirmation.roomId !== room.id || state.stealConfirmation.turnNo !== room.turnNo || room.pending || room.phase !== 'playing')) closeModal(true);
  const key = `${room.id}:${room.revision}:${room.players.map(p => p.online).join()}`;
  state.room = room; state.timerOffset = room.serverTime - Date.now();
  state.selected = new Set([...state.selected].filter(id => room.hand.includes(id)));
  if (room.turnPlayerId !== room.selfId || room.pending || room.phase !== 'playing') state.selected.clear();
  if (!state.selected.size) { state.meldKind = ''; state.top = ''; state.playError = ''; }
  if (key !== lastStateKey) { lastStateKey = key; render(); if (phaseChanged) window.scrollTo({ top: 0, behavior: 'instant' }); }
}
async function enter(session) {
  abortStream?.abort(); streamGeneration++; state.session = session; state.room = null; lastStateKey = '';
  storage.set('redemption:room:' + session.roomId, JSON.stringify(session)); storage.set('redemption:lastRoom', session.roomId);
  let room;
  try { room = await api('/api/rooms/' + session.roomId); }
  catch (error) {
    if ([401, 404].includes(error.status)) storage.remove('redemption:room:' + session.roomId);
    state.session = null; state.connected = false; throw error;
  }
  history.pushState({}, '', '/room/' + session.roomId);
  setRoom(room); window.scrollTo({ top: 0, behavior: 'instant' }); connect();
}
async function connect() {
  const session = state.session; if (!session) return;
  const generation = ++streamGeneration;
  while (generation === streamGeneration && state.session === session) {
    const controller = new AbortController(); abortStream = controller;
    let idle;
    try {
      const response = await fetch(`/api/rooms/${session.roomId}/events`, { headers: { Authorization: 'Bearer ' + session.token }, signal: controller.signal });
      if (generation !== streamGeneration || state.session !== session) { response.body?.cancel().catch(() => {}); return; }
      if (!response.ok) { if ([401, 404].includes(response.status)) { lostSeat(); return; } throw new Error('连接暂时不可用'); }
      state.connected = true; render();
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', lastChunk = Date.now();
      idle = setInterval(() => { if (Date.now() - lastChunk > 45000) controller.abort(); }, 5000);
      while (generation === streamGeneration) {
        const { value, done } = await reader.read(); if (generation !== streamGeneration || state.session !== session) return; if (done) break;
        lastChunk = Date.now(); buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = event.split('\n').find(line => line.startsWith('data: '));
          if (event.startsWith('event: removed')) { lostSeat(); return; }
          if (data) setRoom(JSON.parse(data.slice(6)));
        }
      }
    } catch (error) { if (generation !== streamGeneration) return; }
    finally { clearInterval(idle); }
    if (generation !== streamGeneration) return;
    state.connected = false; render();
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
function lostSeat() {
  if (state.session && state.leavingRoomId === state.session.roomId) return;
  clearRoomSession(state.session?.roomId);
  toast('房间已结束、已过期，或你已被移出房间。', true);
}
function clearRoomSession(roomId) {
  abortStream?.abort(); streamGeneration++;
  if (roomId) {
    storage.remove('redemption:room:' + roomId);
    if (storage.get('redemption:lastRoom') === roomId) storage.remove('redemption:lastRoom');
  }
  state.session = null; state.room = null; state.connected = false; state.busy = false;
  state.leavingRoomId = null; state.selected.clear(); lastStateKey = '';
  history.replaceState({}, '', '/'); closeModal(true); render(); window.scrollTo({ top: 0, behavior: 'instant' });
}
async function sendAction(body) {
  if (state.busy || !state.room || !state.session) return;
  const session = state.session, roomId = session.roomId, leaving = body.type === 'leave';
  state.busy = true;
  if (leaving) state.leavingRoomId = roomId;
  // crypto.randomUUID needs a secure context. IP + plain HTTP is a supported deployment.
  const actionId = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const payload = { ...body, revision: state.room.revision, actionId };
  try {
    let result;
    try { result = await api(`/api/rooms/${roomId}/actions`, payload, session.token); }
    catch (error) { if (!error.status) result = await api(`/api/rooms/${roomId}/actions`, payload, session.token); else throw error; }
    if (state.session !== session) return;
    if (result.left) clearRoomSession(roomId);
    else setRoom(result);
  } catch (error) {
    if (state.session !== session) return;
    if (leaving && [401, 404].includes(error.status)) { clearRoomSession(roomId); return; }
    if (error.status === 409) { try { setRoom(await api('/api/rooms/' + roomId, undefined, session.token)); } catch {} }
    if (state.session !== session) return;
    if ([401, 404].includes(error.status)) { lostSeat(); return; }
    toast(error.message, true);
  } finally {
    if (state.session === session) {
      if (state.leavingRoomId === roomId) state.leavingRoomId = null;
      state.busy = false; render();
    }
  }
}
async function copyInvite() {
  const text = invitation();
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else { const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.left = '-9999px'; document.body.append(input); input.select(); const ok = document.execCommand('copy'); input.remove(); if (!ok) throw new Error('copy'); }
    toast('邀请链接已复制，发给你的朋友即可。');
  } catch { openModal('邀请链接', `<p class="tiny muted">当前浏览器不支持一键复制，请选中下方链接手动复制。</p><input id="manual-copy" value="${escape(text)}" readonly style="margin-top:15px">`); $('#manual-copy').select(); }
}
function openModal(title, content) {
  const previousFocus = document.activeElement;
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><header class="modal-header"><h2 id="modal-title">${title}</h2><button type="button" class="close-modal" data-action="close" aria-label="关闭">×</button></header><div class="modal-content">${content}</div></section></div>`;
  $('#modal-root').previousFocus = previousFocus;
  $('.close-modal').focus(); document.body.style.overflow = 'hidden';
}
function closeModal(force = false) {
  if (!force && state.busy && $('#join-room-form')) return;
  state.stealConfirmation = null;
  $('#modal-root').innerHTML = ''; document.body.style.overflow = '';
  if ($('#modal-root').previousFocus?.isConnected) $('#modal-root').previousFocus.focus();
  else $('#playerName')?.focus({ preventScroll: true });
}
function rules() {
  openModal('旅程开始前，了解一点规则。', `<div class="rule-steps"><div class="rule-step"><b>01</b><h3>打出合法组合</h3><p>可以单出、同花色、同数字或顺子。顺子至少 2 张，0–8 连续，不能循环，不能过牌。无须跟随上一家的牌。</p></div><div class="rule-step"><b>02</b><h3>结算最上方的牌</h3><p>每次只发动最上方的一张。顺子必须以最大数字在上；其他组合按选牌顺序叠放，最后选中的牌在最上方。被抽走或被弃掉的牌不发动效果。</p></div><div class="rule-step"><b>03</b><h3>三次清空，完成救赎</h3><p>效果全部完成后，检查所有空手玩家。罪恶值 6 → 4 → 2 → 0，并补对应数量的手牌。到 0 时空手即可获胜。</p></div></div><div class="rule-detail"><h3>开局与补牌</h3><p>3–5 人，每人起始 6 张，起始玩家额外摸 1 张。51 张牌洗混，光环在桌面场外。抽牌堆用完后重洗弃牌堆；尚在结算的牌与面前的懒惰不参与重洗。</p></div><div class="rule-detail"><h3>光环与腐化</h3><p>净化为 0，没有花色，可以参加顺子。光环无花色无数字，只能单独打出；清空手牌后回到桌面。腐化固定为 8，同时属于七种花色；可选择其中一种效果，不能代替其他数字，也不能发动净化。</p></div><div class="rule-detail"><h3>清手时机与平手</h3><p>回合效果结算完成后，所有空手玩家都晋级。暴食抽走对方最后一张时，对方立即晋级。若多人同时到 0，则这些玩家各摸 1 张继续，直到只有一位 0 罪恶值玩家空手。</p></div><div class="rule-detail"><h3>联机约定</h3><p>等待大厅可离开和移除玩家；对局开始后座位固定。保留原浏览器即可重连。每次操作限时 ${state.room?.settings.turnSeconds || 120} 秒；超时会自动单出一张或执行保守的响应。色欲暗选在双方提交前不会公开。刷新页面不改变身份。</p></div><div class="rule-detail"><h3>规则参考</h3><p>本版本采用原版规则，平手处理参考出版方说明。</p><p><a href="https://iellogames.com/wp-content/uploads/2021/09/Deadlies_Rulebook_LOCA_V1_Light.pdf" target="_blank" rel="noopener">出版方英文规则</a> · 原作 Paul Saxberg · 插画 Leah Fuhrman · Smirk &amp; Dagger / IELLO</p></div>`);
}
function gallery() {
  openModal('七宗罪，与你将遇到的卡牌。', `<div class="gallery">${Object.keys(META).map(s => `<div class="gallery-item">${cardHTML(SUITS.includes(s) ? s + '-5' : s, false, 'inspect')}<p>${META[s].short}</p></div>`).join('')}</div>`);
}
function inspect(id) {
  const c = card(id), m = META[c.suit];
  openModal(m.name + ' · ' + m.english, `<div class="card-detail">${cardHTML(id, false, 'inspect')}<div class="card-detail-copy"><span class="eyebrow">${c.value === null ? '无数字 · 无花色' : '数字 ' + c.value + (['purity', 'corruption'].includes(c.suit) ? (c.suit === 'purity' ? ' · 无花色' : ' · 全部七种花色') : ' · 七宗罪之一')}</span><h3>${m.short}</h3><p>${m.text}</p></div></div>`);
}
document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el) return;
  const action = el.dataset.action;
  if (action === 'home') {
    event.preventDefault();
    if (state.room) { toast('你仍在房间中。请使用“离开房间”或“暂离”返回首页。'); return; }
    history.pushState({}, '', '/'); render(); return;
  }
  if (action === 'rules') rules();
  else if (action === 'open-join') joinDialog();
  else if (action === 'gallery') gallery();
  else if (action === 'inspect') inspect(el.dataset.card);
  else if (action === 'close' || action === 'backdrop' && event.target === el) closeModal();
  else if (action === 'copy') await copyInvite();
  else if (action === 'card') {
    if (state.room?.turnPlayerId !== state.room?.selfId || state.room?.pending || state.room?.phase !== 'playing') { inspect(el.dataset.card); return; }
    if (state.busy) return;
    const id = el.dataset.card;
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    state.playError = ''; state.stealConfirmation = null; refreshSelection(event.detail === 0);
  }
  else if (action === 'clear') { state.selected.clear(); state.top = ''; state.meldKind = ''; state.playError = ''; state.stealConfirmation = null; refreshSelection(event.detail === 0); }
  else if (action === 'start') await sendAction({ type: 'start', starterId: $('#starter').value });
  else if (action === 'ready') await sendAction({ type: 'ready', ready: !self().ready });
  else if (action === 'kick') {
    openModal('移除这位旅伴？', `<p class="muted tiny">将 ${escape(nameOf(el.dataset.player))} 移出等待大厅。对方可以使用邀请链接重新加入。</p><div class="effect-actions"><button class="btn danger" data-action="confirm-kick" data-player="${el.dataset.player}">确认移除</button><button class="btn ghost" data-action="close">取消</button></div>`);
  }
  else if (action === 'confirm-kick') { closeModal(); await sendAction({ type: 'kick', targetId: el.dataset.player }); }
  else if (action === 'play') await submitSelected();
  else if (action === 'confirm-last-card') { const confirmation = state.stealConfirmation; closeModal(); await submitSelected(confirmation); }
  else if (action === 'show-controls') $('.action-panel')?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  else if (action === 'respond') await sendAction({ type: 'respond', choice: el.dataset.choice, cardId: el.dataset.choice === 'none' ? null : $('#responseCard')?.value || null, targetId: $('#responseTarget')?.value });
  else if (action === 'rematch') await sendAction({ type: 'rematch' });
  else if (action === 'leave') {
    if (state.room?.phase === 'playing') {
      openModal('暂时离开牌桌', `<p class="muted tiny">你的座位和手牌会保留。超过操作时限会执行默认行动。使用这个浏览器再次打开邀请链接，即可回到牌桌。</p><div class="effect-actions"><button class="btn gold" data-action="away">暂离，保留座位</button><button class="btn ghost" data-action="close">继续游戏</button></div>`);
    } else await sendAction({ type: 'leave' });
  }
  else if (action === 'away') { closeModal(); abortStream?.abort(); streamGeneration++; state.room = null; state.session = null; state.connected = false; lastStateKey = ''; history.pushState({}, '', '/'); render(); }
  else if (action === 'resume') { try { await enter(savedSession(el.dataset.room)); } catch (error) { lostSeat(); } }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (Object.hasOwn(state.inputs, el.id)) state.inputs[el.id] = el.value;
  if (el.id === 'playerName' && state.nameError) { state.nameError = ''; el.setAttribute('aria-invalid', 'false'); $('#name-error').textContent = ''; }
  if (el.id === 'roomId') { el.setAttribute('aria-invalid', 'false'); showRoomError(''); }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (Object.hasOwn(state.inputs, el.id)) state.inputs[el.id] = el.value;
  if (['meldKind', 'effect', 'target', 'mode', 'direction'].includes(el.id)) { state[el.id] = el.value; state.playError = ''; state.stealConfirmation = null; refreshSelection(event.detail === 0); }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy) return;
  const form = event.target;
  if (form.id === 'chat-form') { const text = state.inputs.chat.trim(); if (!text) return; state.inputs.chat = ''; await sendAction({ type: 'chat', text }); return; }
  if (!['entry-form', 'join-room-form', 'invite-form'].includes(form.id)) return;
  const joining = form.id === 'join-room-form';
  const name = form.id === 'invite-form' ? state.inputs.inviteName.trim() : entryName();
  if (!name) { if (form.id === 'invite-form') { toast('请先输入你的游戏名称。', true); $('#inviteName')?.focus(); } return; }
  const id = form.id === 'invite-form' ? pathRoom() : ($('#roomId')?.value ?? state.inputs.roomId).trim();
  if (form.id !== 'entry-form' && !/^\d{6}$/.test(id)) {
    if (joining) { showRoomError('请输入六位数字房间号。'); $('#roomId').setAttribute('aria-invalid', 'true'); $('#roomId').focus(); }
    else toast('请输入六位数字房间号。', true);
    return;
  }
  state.busy = true; render(); joinDialogBusy(true);
  try {
    let session;
    if (form.id === 'entry-form') session = await api('/api/rooms', { name }, null);
    else session = savedSession(id) || await api(`/api/rooms/${id}/join`, { name }, null);
    storage.set('redemption:name', name); state.inputs.playerName = name; state.inputs.inviteName = name; await enter(session);
    if (joining) closeModal(true);
  } catch (error) { if (joining) showRoomError(error.message); else toast(error.message, true); }
  finally { state.busy = false; joinDialogBusy(false); render(); if (joining && $('#join-room-form')) $('#roomId').focus(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab' && $('.modal')) {
    const focusable = [...$('.modal').querySelectorAll('button,a,input,select,[tabindex="0"]')].filter(el => !el.disabled);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
function updateTimers() {
  if (!state.room?.deadline || state.room.phase !== 'playing') return;
  const seconds = Math.max(0, Math.ceil((state.room.deadline - Date.now() - state.timerOffset) / 1000));
  document.querySelectorAll('[data-timer]').forEach(el => { el.textContent = ` · ${seconds} 秒后自动行动`; });
}
setInterval(updateTimers, 1000);
window.addEventListener('popstate', () => { if (state.session && pathRoom() === state.session.roomId) render(); else location.reload(); });
async function bootstrap() {
  render();
  try { state.publicUrl = (await api('/api/config', undefined, null)).publicUrl; } catch {}
  const id = pathRoom(), session = id && savedSession(id);
  if (session) { try { await enter(session); } catch { lostSeat(); } }
}
bootstrap();
