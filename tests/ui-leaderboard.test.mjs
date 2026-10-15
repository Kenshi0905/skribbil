import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/^import .* from '\.\/avatar\.js';\r?\n/m,'');
const renderers=source.slice(0,source.indexOf("document.addEventListener('click'"));
function client(fetcher) {
  const node={innerHTML:'',style:{},classList:{remove(){}},setAttribute(){}};
  const context=vm.createContext({document:{querySelector:()=>node,body:{style:{}}},location:{hash:'#/league',search:'',origin:'http://localhost'},
    window:{matchMedia:()=>({matches:false})},URL,URLSearchParams,Intl,AbortController,setTimeout,clearTimeout,fetch:fetcher});
  vm.runInContext(`${renderers}\nglobalThis.ui={state,loadLeaderboard,handleAction,resetAccountViews,submitForm};`,context);
  context.ui.state.route='league';return context.ui;
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=data=>({ok:true,json:async()=>data});

test('leaderboard discards stale filter responses and private account data after logout',async()=>{
  const calls=[],requests=[];
  const ui=client(path=>{calls.push(path);const request=deferred();requests.push(request);return request.promise;});
  const first=ui.loadLeaderboard();
  const second=ui.handleAction('leaderboard-tab',{dataset:{value:'weekly'}});
  requests[1].resolve(response({players:[],period:'weekly',total:0,page:1}));await second;
  requests[0].resolve(response({players:[],period:'all-time',total:0,page:1}));await first;
  assert.equal(ui.state.board.period,'weekly');assert.equal(ui.state.boardLoading,false);
  ui.state.data.user={id:'member'};
  const friends=ui.handleAction('leaderboard-scope',{dataset:{value:'friends'}});
  ui.resetAccountViews();ui.state.data.user=null;
  requests[2].resolve(response({players:[{id:'private-friend'}]}));await friends;
  assert.equal(ui.state.board,null);assert.equal(ui.state.leaderboardScope,'everyone');
  assert.match(calls[2],/scope=friends/);
});

test('search submits a full-board request and period changes reset pagination',async()=>{
  const calls=[];
  const ui=client(async path=>{calls.push(path);return response({players:[],total:0,page:1});});
  ui.state.leaderboardPage=4;
  await ui.submitForm({dataset:{form:'leaderboard-search'},elements:{search:{value:'name & more'}}});
  let query=new URL(calls.at(-1),'http://localhost').searchParams;
  assert.equal(query.get('page'),'1');assert.equal(query.get('search'),'name & more');
  await ui.handleAction('leaderboard-tab',{dataset:{value:'monthly'}});
  query=new URL(calls.at(-1),'http://localhost').searchParams;
  assert.equal(query.get('period'),'monthly');assert.equal(query.get('page'),'1');
  await ui.handleAction('leaderboard-scope',{dataset:{value:'friends'}});
  assert.equal(calls.length,2,'anonymous friends view prompts sign-in without a private request');
});
