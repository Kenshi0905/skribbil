import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/^import .* from '\.\/avatar\.js';\r?\n/m,'');
const beforeListeners=source.slice(0,source.indexOf("document.addEventListener('click'"));
const account={id:'recipient-test',username:'recipient_test'};
const incoming={id:'incoming-test',username:'incoming_test',status:'pending',outgoing:false};
const sent={id:'sent-test',username:'sent_test',status:'pending',outgoing:true};
const accepted={id:'accepted-test',username:'accepted_test',status:'accepted',outgoing:false};
const bootstrap=friends=>({user:{...account},friends,teams:[],engine:{available:false}});
const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function client(data=bootstrap([incoming,sent,accepted]),fetcher=async()=>{throw new Error('Unexpected network request');}){
  const nodes=new Map(),calls=[],notifications=[],focused=[];
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',style:{},classList:{remove(){}},setAttribute(){},focus(){focused.push(selector);}});
    return nodes.get(selector);
  };
  const context=vm.createContext({
    document:{querySelector:node,body:{style:{}}},location:{hash:'#/friends',search:'',origin:'http://localhost'},
    window:{matchMedia:()=>({matches:false})},requestAnimationFrame:()=>{},URL,URLSearchParams,Intl,AbortController,setTimeout,clearTimeout,
    fetch:async(path,options)=>{calls.push({path,options});return fetcher(path,options);},notifications,
  });
  vm.runInContext(`${beforeListeners}\ntoast=(...args)=>notifications.push(args);\nglobalThis.ui={state,friendsPage,friendsPanel,friendRow,respondFriendRequest,refreshFriends,handleAction,resetAccountViews,render,friendListContent,friendProfileModal,openFriendProfile};`,context);
  const ui=context.ui;ui.state.data=data;ui.state.route='friends';ui.state.partyLoaded=true;ui.state.teamsLoaded=true;
  return {ui,calls,notifications,focused,html:()=>node('#app').innerHTML};
}

test('incoming requests have labeled decisions, sent requests have status only, and the tab counts accepted friends',()=>{
  const {ui}=client();
  const page=ui.friendsPage();
  assert.match(page,/>Your friends · 1<\/button>/);
  assert.match(page,/class="friends-columns"/);
  assert.ok(page.indexOf('Your friends<span')<page.indexOf('Incoming requests'));
  assert.ok(page.indexOf('Incoming requests')<page.indexOf('Sent requests'));
  assert.match(page,/aria-label="Friend requests"/);
  const incomingRow=ui.friendRow(incoming,'incoming');
  assert.match(incomingRow,/data-response="accept" aria-label="Accept friend request from incoming_test"/);
  assert.match(incomingRow,/data-response="decline" aria-label="Decline friend request from incoming_test"/);
  assert.match(incomingRow,/>Accept<\/button>/);
  assert.match(incomingRow,/>Decline<\/button>/);
  const sentRow=ui.friendRow(sent,'sent');
  assert.match(sentRow,/Request sent/);
  assert.doesNotMatch(sentRow,/data-action="respond-friend"/);
  assert.doesNotMatch(ui.friendRow(accepted,'accepted'),/data-action="respond-friend"/);
  assert.match(page,/data-action="refresh-friends"/);
});

test('accept posts the other account ID, blocks duplicate/opposite clicks, then refreshes immediately',async()=>{
  const pending=deferred();
  const {ui,calls,notifications,html,focused}=client(undefined,async(path)=>{
    if(path==='/api/friends/incoming-test/respond'){await pending.promise;return response({ok:true});}
    assert.equal(path,'/api/bootstrap');return response(bootstrap([{...incoming,status:'accepted'},sent,accepted]));
  });
  const first=ui.handleAction('respond-friend',{dataset:{id:incoming.id,response:'accept'}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body),{action:'accept'});
  assert.equal(calls[0].options.headers['X-Requested-With'],'Skribbil');
  assert.equal(calls[0].options.credentials,'same-origin');
  assert.match(html(),/Accepting…/);
  const buttons=[...html().matchAll(/<button[^>]+data-action="respond-friend"[^>]*>/g)];
  assert.equal(buttons.length,2);assert.ok(buttons.every(([button])=>button.includes('disabled')));
  await ui.respondFriendRequest(incoming.id,'accept');await ui.respondFriendRequest(incoming.id,'decline');
  await ui.refreshFriends();assert.equal(calls.length,1);
  pending.resolve();await first;
  assert.deepEqual(calls.map(call=>call.path),['/api/friends/incoming-test/respond','/api/bootstrap']);
  assert.equal(ui.state.friendDecision,null);assert.equal(ui.state.friendsError,null);
  assert.match(html(),/>Your friends · 2<\/button>/);assert.doesNotMatch(html(),/Incoming requests/);
  assert.match(notifications[0][0],/Friend request accepted/);
  assert.equal(focused.at(-1),'[data-action="refresh-friends"]');
});

test('decline removes only the incoming request and preserves accepted and sent rows',async()=>{
  const {ui,calls}=client(undefined,async(path)=>response(path==='/api/bootstrap'?bootstrap([sent,accepted]):{ok:true}));
  await ui.respondFriendRequest(incoming.id,'decline');
  assert.deepEqual(JSON.parse(calls[0].options.body),{action:'decline'});
  assert.deepEqual(Array.from(ui.state.data.friends,friend=>friend.id),[sent.id,accepted.id]);
  assert.match(ui.friendsPage(),/Request sent/);assert.match(ui.friendsPage(),/>Your friends · 1<\/button>/);
});

test('outgoing, accepted, unknown, and unsupported decisions never issue a request',async()=>{
  const {ui,calls}=client();
  await ui.respondFriendRequest(sent.id,'accept');await ui.respondFriendRequest(accepted.id,'decline');
  await ui.respondFriendRequest('unknown','accept');await ui.respondFriendRequest(incoming.id,'delete');
  assert.equal(calls.length,0);
});

test('a failed response keeps the incoming request actionable and shows the server error',async()=>{
  const {ui,calls,html,notifications}=client(undefined,async()=>response({error:'The request changed in another session.'},409));
  await ui.respondFriendRequest(incoming.id,'decline');
  assert.equal(calls.length,1);assert.equal(ui.state.friendDecision,null);
  assert.equal(ui.state.data.friends[0].status,'pending');
  assert.match(html(),/role="alert"/);assert.match(html(),/The request changed in another session/);
  const buttons=[...html().matchAll(/<button[^>]+data-action="respond-friend"[^>]*>/g)];
  assert.ok(buttons.every(([button])=>!button.includes('disabled')));
  assert.equal(notifications[0][1],true);
});

test('a confirmed decision survives a failed refresh and offers refresh instead of resending it',async()=>{
  const {ui,calls,html}=client(undefined,async(path)=>path==='/api/bootstrap'?response({error:'Service temporarily unavailable'},503):response({ok:true}));
  await ui.respondFriendRequest(incoming.id,'accept');
  assert.equal(calls.length,2);assert.equal(ui.state.data.friends[0].status,'accepted');
  assert.match(html(),/Your choice was saved/);assert.match(html(),/Use Refresh friends/);
  assert.doesNotMatch(html(),/data-action="respond-friend"/);
  await ui.respondFriendRequest(incoming.id,'decline');assert.equal(calls.length,2);
});

test('manual refresh retrieves new incoming requests without duplicating concurrent fetches',async()=>{
  const pending=deferred();
  const {ui,calls,html}=client(bootstrap([accepted]),async()=>{await pending.promise;return response(bootstrap([incoming,accepted]));});
  const first=ui.handleAction('refresh-friends',{dataset:{}});
  assert.match(html(),/Refreshing…/);await ui.refreshFriends();assert.equal(calls.length,1);
  pending.resolve();await first;
  assert.equal(calls[0].path,'/api/bootstrap');assert.equal(ui.state.friendsLoading,false);
  assert.match(html(),/Incoming requests/);assert.match(html(),/data-response="accept"/);
});

test('switching accounts during a response does not mutate the new account or display stale success',async()=>{
  const pending=deferred();const {ui,calls,notifications}=client(undefined,async()=>{await pending.promise;return response({ok:true});});
  const first=ui.respondFriendRequest(incoming.id,'accept');
  ui.resetAccountViews();ui.state.data={user:{id:'different-account',username:'different_test'},friends:[{...sent,id:'different-sent'}]};
  pending.resolve();await first;
  assert.equal(calls.length,1);assert.equal(notifications.length,0);
  assert.equal(ui.state.data.user.id,'different-account');assert.equal(ui.state.data.friends[0].id,'different-sent');
  assert.equal(ui.state.friendDecision,null);assert.equal(ui.state.friendsLoading,false);
});

test('names and server error text stay escaped in request controls',()=>{
  const {ui}=client(bootstrap([{...incoming,username:'<img src=x onerror=alert(1)>'}]));
  ui.state.friendsError='<script>unexpected()</script>';
  const html=ui.friendsPage();
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<img src=x|<script>/);
});


test('accepted friends open profiles and search matches display names and usernames',()=>{
  const {ui}=client();
  const row=ui.friendRow({...accepted,displayName:'Pencil Pal'},'accepted');
  assert.match(row,/data-action="friend-profile" data-id="accepted-test"/);
  assert.match(row,/View Pencil Pal’s profile/);
  assert.doesNotMatch(ui.friendRow(sent,'sent'),/data-action="friend-profile"/);
  ui.state.friendSearch='ACCEPTED_';assert.match(ui.friendListContent(),/accepted-test/);
  ui.state.friendSearch='missing';assert.match(ui.friendListContent(),/No friends found/);
});

test('profile loads real data, escapes content, and exposes no account edit controls',async()=>{
  const {ui,calls}=client(undefined,async()=>response({profile:{...accepted,displayName:'<script>pal</script>',bio:'<b>hello</b>',level:3,xp:250,gamesPlayed:4,wins:2,points:700,averageScore:175}}));
  await ui.openFriendProfile(accepted.id);
  assert.equal(calls[0].path,'/api/friends/accepted-test/profile');
  const html=ui.friendProfileModal();assert.match(html,/&lt;script&gt;pal/);assert.match(html,/&lt;b&gt;hello/);
  assert.match(html,/Games played/);assert.match(html,/>700<\/strong>/);
  assert.doesNotMatch(html,/data-action="edit-profile"|<script>|<b>hello/);
});

test('profile failures show retry and account changes discard in-flight profiles',async()=>{
  const failed=client(undefined,async()=>response({error:'Profile unavailable'},404));
  await failed.ui.openFriendProfile(accepted.id);assert.match(failed.ui.friendProfileModal(),/role="alert"/);
  assert.match(failed.ui.friendProfileModal(),/Try again/);
  const pending=deferred();const {ui}=client(undefined,async()=>{await pending.promise;return response({profile:accepted});});
  const first=ui.openFriendProfile(accepted.id);ui.resetAccountViews();pending.resolve();await first;
  assert.equal(ui.state.friendProfile,null);
});
