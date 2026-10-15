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
  vm.runInContext(`${renderers}\ntoast=()=>{}; globalThis.ui={state,loadLeaderboard,handleAction,resetAccountViews,submitForm,leaderboardFriendButton,sendLeaderboardFriendRequest};`,context);
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

const target={id:'other',username:'other_player',displayName:'Other Player'};
test('leaderboard friend controls distinguish self, friends, outgoing and incoming requests',()=>{
  const ui=client(); ui.state.data={user:{id:'me'},friends:[]};
  assert.equal(ui.leaderboardFriendButton({id:'me'}),'');
  assert.match(ui.leaderboardFriendButton(target),/aria-label="Send friend request to Other Player"/);
  for (const [friend,expected] of [
    [{...target,status:'accepted'},null],
    [{...target,status:'pending',outgoing:true},/disabled.*Request sent/s],
    [{...target,status:'pending',outgoing:false},/href="#\/friends".*Review request/s],
  ]) {
    ui.state.data.friends=[friend]; const html=ui.leaderboardFriendButton(target);
    if(expected) assert.match(html,expected); else assert.equal(html,'');
  }
  ui.state.data.user=null;ui.state.data.friends=[];
  assert.match(ui.leaderboardFriendButton(target),/Add friend/);
});

test('leaderboard sends a request once and reflects the authoritative friendship after refresh',async()=>{
  const calls=[],pending=deferred();
  const ui=client(async(path,options)=>{
    calls.push({path,options});
    if(path==='/api/friends'){await pending.promise;return response({ok:true});}
    if(path==='/api/bootstrap')return response({user:{id:'me'},friends:[{...target,status:'accepted'}]});
    return response({players:[target],total:1,page:1});
  });
  ui.state.data={user:{id:'me'},friends:[]};ui.state.board={players:[target]};
  const first=ui.handleAction('leaderboard-add-friend',{dataset:{id:target.id}});
  assert.match(ui.leaderboardFriendButton(target),/disabled.*Sending…/s);
  await ui.sendLeaderboardFriendRequest(target.id);
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body),{username:'other_player'});
  pending.resolve();await first;
  assert.equal(ui.state.leaderboardFriendPending,null);
  assert.equal(ui.leaderboardFriendButton(target),'');
  await ui.sendLeaderboardFriendRequest(target.id);assert.equal(calls.length,3);
});

test('failed leaderboard requests can retry, saved requests survive a refresh failure, and logout discards responses',async()=>{
  let phase='fail';const pending=deferred();let calls=0;
  const ui=client(async path=>{
    calls++;
    if(phase==='fail')return {ok:false,status:409,json:async()=>({error:'Unavailable'})};
    if(phase==='logout'){await pending.promise;return response({ok:true});}
    if(path==='/api/bootstrap')throw new Error('Offline');
    return response({ok:true});
  });
  ui.state.data={user:{id:'me'},friends:[]};ui.state.board={players:[target]};
  await ui.sendLeaderboardFriendRequest('unknown');await ui.sendLeaderboardFriendRequest('me');assert.equal(calls,0);
  await ui.sendLeaderboardFriendRequest(target.id);
  assert.equal(ui.state.leaderboardFriendPending,null);assert.match(ui.leaderboardFriendButton(target),/Add friend/);
  phase='saved';await ui.sendLeaderboardFriendRequest(target.id);
  assert.match(ui.leaderboardFriendButton(target),/disabled.*Request sent/s);
  ui.state.data.friends=[];phase='logout';const request=ui.sendLeaderboardFriendRequest(target.id);
  ui.resetAccountViews();ui.state.data={user:null,friends:[]};pending.resolve();await request;
  assert.equal(ui.state.data.friends.length,0);assert.equal(ui.state.leaderboardFriendPending,null);
});
