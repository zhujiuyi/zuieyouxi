import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as cards from '../lib/cards.mjs';
import { artUrl } from '../public/art.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^bootstrap\(\);\s*$/m,'');
function fixture(hand,{targetCount=3,targetStage=6}={}) {
  const events=new Map(),sent=[],dialogs=[],errors=[],panel={outerHTML:''},handElement={dataset:{}};
  const document={activeElement:null,addEventListener:(type,fn)=>events.set(type,fn),querySelector:s=>s==='.action-panel'?panel:s==='.hand-cards'?handElement:null,querySelectorAll:()=>[],getElementById:()=>null,body:{style:{}}};
  const context=vm.createContext({...cards,artUrl,document,window:{addEventListener(){}},localStorage:{getItem:()=>null},location:{pathname:'/'},history:{},console,TextDecoder,AbortController,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,matchMedia:()=>({matches:false}),testSent:sent,testDialogs:dialogs,testErrors:errors});
  vm.runInContext(source+`
    render=()=>{};toast=message=>testErrors.push(message);
    openModal=(title,content)=>testDialogs.push({title,content});
    closeModal=()=>{state.stealConfirmation=null;testDialogs.length=0;};
    sendAction=async body=>testSent.push(JSON.stringify(body));
    globalThis.client={state,currentSelection,selectionControls,submitSelected};`,context);
  const client=context.client;
  client.state.connected=true;client.state.session={roomId:'123456',playerId:'p1'};
  client.state.room={id:'123456',selfId:'p1',phase:'playing',turnNo:1,turnPlayerId:'p1',pending:null,hand,players:[{id:'p1',name:'自己',stage:6,handCount:hand.length},{id:'p2',name:'目标',stage:targetStage,handCount:targetCount},{id:'p3',name:'旅伴',stage:6,handCount:4}],settings:{turnSeconds:120}};
  return {...client,panel,dialogs,errors,get sent(){return sent.map(JSON.parse);},
    click:(action,id)=>events.get('click')({target:{closest:()=>({dataset:{action,card:id}})},detail:1,preventDefault(){}}),
    change:(id,value)=>events.get('change')({target:{id,value},detail:0})};
}

test('点击手牌只选牌，普通组合以最后选择为顶牌，按钮才提交',async()=>{
  const f=fixture(['pride-5','pride-3','sloth-1']);
  await f.click('card','pride-5');await f.click('card','pride-3');
  assert.equal(f.sent.length,0);assert.equal(f.state.top,'pride-3');
  assert.match(f.panel.outerHTML,/出牌（2张）/);assert.equal(f.panel.outerHTML.includes('id="top"'),false);
  await f.click('card','pride-5');await f.click('card','pride-5');
  assert.equal(f.state.top,'pride-5');await f.click('play');
  assert.deepEqual(f.sent[0].cards,['pride-3','pride-5']);assert.equal(f.sent[0].top,'pride-5');assert.equal(f.sent[0].kind,'同花色');
});
test('顺子不受点击顺序影响，最大数字执行；同花顺可明确切换组合',async()=>{
  const f=fixture(['envy-4','lust-2','wrath-3']);
  for(const id of f.state.room.hand)await f.click('card',id);
  await f.click('play');assert.deepEqual(f.sent[0].cards,['lust-2','wrath-3','envy-4']);assert.equal(f.sent[0].top,'envy-4');
  const same=fixture(['pride-3','pride-2']);
  await same.click('card','pride-3');await same.click('card','pride-2');assert.equal(same.state.top,'pride-3');
  same.change('meldKind','同花色');assert.equal(same.state.top,'pride-2');await same.click('play');assert.equal(same.sent[0].kind,'同花色');
});
test('点击出牌会拦截非法组合，保留选牌并显示原因',async()=>{
  const f=fixture(['sloth-1','lust-3']);await f.click('card','sloth-1');await f.click('card','lust-3');await f.click('play');
  assert.equal(f.sent.length,0);assert.equal(f.state.selected.size,2);assert.match(f.errors.at(-1),/组合不合法/);assert.match(f.panel.outerHTML,/role="alert"/);
});
test('暴食抽最后一张先确认；取消保留选牌，确认才提交',async()=>{
  const f=fixture(['gluttony-1','sloth-1'],{targetCount:1,targetStage:2});
  await f.click('card','gluttony-1');f.change('mode','steal');await f.click('play');
  assert.equal(f.sent.length,0);assert.match(f.dialogs[0].content,/赢得本局/);
  await f.click('close');assert.equal(f.state.selected.size,1);assert.equal(f.sent.length,0);
  await f.click('play');await f.click('confirm-last-card');assert.equal(f.sent.length,1);assert.equal(f.sent[0].confirmLastCard,true);
});
test('暴食确认提示区分晋级；牌局变化后旧确认不能提交',async()=>{
  const f=fixture(['gluttony-1','sloth-1'],{targetCount:1,targetStage:6});
  await f.click('card','gluttony-1');f.change('mode','steal');await f.click('play');
  assert.match(f.dialogs[0].content,/6 降至 4/);assert.ok(!f.dialogs[0].content.includes('赢得本局'));
  f.state.room.players[1].handCount=2;await f.click('confirm-last-card');
  assert.equal(f.sent.length,0);assert.match(f.errors.at(-1),/已变化/);
  await f.click('play');assert.equal(f.sent.length,1);assert.equal(f.sent[0].confirmLastCard,false);
});
