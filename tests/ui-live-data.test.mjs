import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the production renderers with an inert DOM. Test rows below are synthetic
// server responses used only by these tests, never shipped as UI fallback data.
const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8').replace(/^import .* from '\.\/avatar\.js';\r?\n/m, '');
const renderers = source.slice(0, source.indexOf("document.addEventListener('click'"));
function client(data = {}) {
  const nodes = new Map();
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {innerHTML:'',style:{},classList:{remove(){}},setAttribute(){}});
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: {querySelector:element,body:{style:{}}},
    location: {hash:'#/home',search:'',origin:'http://localhost'},
    window: {matchMedia:()=>({matches:false})},
    URL, URLSearchParams, Intl,
  });
  vm.runInContext(`${renderers}\nglobalThis.ui = {state,homePage,skribbilPage,gameShelf,sidebar,currentRoute,leaguePage,tournamentsPage,communityPage,profilePage,friendsPage,clubhousesPage,roomRow,tournamentCard,cosmeticsCollection,awardsPanel,leaderboardTableRows,boardPlayers,challengeRow,officialBracketModal,hero,topbar,render};`,context);
  context.ui.state.data = data;
  return context.ui;
}

const noInventedCards = html => {
  assert.doesNotMatch(html,/class="(?:podium-card|leaderboard-row|room-row|challenge-row|tournament-card|art-card|cosmetic |award-row)/);
  assert.doesNotMatch(html,/data-id="sample-|DoodleDemon|PixelPandit|ChaiAndChaos|NotAnArtist|GuessWho|Placeholder Open|Golden hour|Main character|Qualifier [1-4]|EXAMPLE|SAMPLE DOODLE/i);
};

test('Clubhouse navigation separates the shared community from its playable Skribbil section',()=>{
  const ui=client({});
  assert.match(ui.homePage(),/Welcome to the Clubhouse/);
  assert.match(ui.gameShelf(),/href="#\/skribbil"/);
  assert.match(ui.sidebar(),/assets\/skribbil-communities-light\.png/);
  assert.match(ui.sidebar(),/nav-game/);
  assert.match(ui.skribbilPage(),/data-action="play"/);
  assert.match(ui.skribbilPage(),/data-action="private-room"/);
  for(const route of ['home','skribbil','tournaments','community','friends','profile','clubhouses'])assert.match(ui.sidebar(),new RegExp(`href="#/${route}"`));
  assert.doesNotMatch(ui.gameShelf(),/Among Us|Duck Duck Goose/,'unavailable games are not presented as playable');
});

test('a fresh or unavailable community renders honest empty pages without manufactured activity', () => {
  const ui = client({user:null,leaderboard:[],seasonLeaderboard:[],rooms:[],challenges:[],tournaments:[],drawings:[],teams:[],friends:[],season:null});
  for (const page of ['homePage','leaguePage','tournamentsPage','communityPage','profilePage','friendsPage','clubhousesPage']) {
    const html = ui[page]();
    assert.ok(html.length > 100, `${page} should remain a useful page`);
    noInventedCards(html);
  }
  assert.match(ui.homePage(),/No public rooms are open/);
  assert.match(ui.sidebar(),/href="#\/league"/);
  assert.doesNotMatch(ui.sidebar(),/season-card/);
  assert.match(ui.homePage(),/href="#\/league"/);
  assert.match(ui.leaguePage(),/Leaderboard/);
  assert.match(ui.tournamentsPage(),/No tournaments scheduled/);
  assert.match(ui.communityPage(),/No drawings have been curated/);
  assert.match(ui.profilePage(),/Sign in to see your own match history/);
  assert.match(ui.hero(),/A LITTLE CAT ILLUSTRATION/);
  assert.doesNotMatch(ui.topbar(),/LOCAL COMMUNITY/);
  assert.match(ui.homePage(),/All-time points/);
  assert.doesNotMatch(ui.hero(),/\+120|You guessed it!/);
  ui.state.error = 'Community service unavailable.';
  assert.doesNotThrow(()=>ui.render());
});

test('season standings never substitute all-time results and search distinguishes no results from no match', () => {
  const ui = client({leagues:[{id:'test-league',name:'Weekend league'}],leaderboard:[{username:'render_test_player',points:840,wins:2,played:5}],seasonLeaderboard:[],season:null});
  ui.state.leaderboardTab = 'season';
  ui.state.board = {players:[],top:[],total:0,page:1};
  assert.equal(ui.boardPlayers().length,0);
  assert.doesNotMatch(ui.leaguePage(),/render_test_player/);
  ui.state.leaderboardTab = 'all-time';
  ui.state.board = {players:[{username:'render_test_player',points:840,wins:2,played:5,rank:1}],top:[],total:1,page:1};
  assert.match(ui.leaguePage(),/render_test_player/);
  assert.match(ui.leaguePage(),/>840</);
  ui.state.search = 'unknown';
  assert.match(ui.leaderboardTableRows([]),/No scribblers found/);
  assert.doesNotMatch(ui.leaguePage(),/Certified scribbler|Fresh pencil/);
});

test('room cards use real database population counts without fabricated settings or capacity', () => {
  const ui = client();
  const room = ui.roomRow({id:'room-render-test',mode:'private',players:'10',status:'lobby'},0);
  assert.match(room,/10 players/);
  assert.match(room,/data-action="join-room"[^>]*data-id="room-render-test"/);
  assert.match(room,/data-action="spectate-room"/);
  assert.doesNotMatch(room,/3 rounds|80 sec|10\/8/);
  assert.match(ui.roomRow({id:'unknown-count',mode:'private'},0),/Players unavailable/);
});

test('tournament registration counts do not impersonate the signed-in player registration', () => {
  const ui = client({user:{id:'account-render-test'}});
  const event = {id:'event-render-test',name:'Runtime tournament',format:'groups_knockout',status:'registration',registered:'0',joined:false,entryType:'team'};
  const open = ui.tournamentCard(event);
  assert.match(open,/0 registrations/);
  assert.match(open,/Groups then knockout/);
  assert.match(open,/Enter your team/);
  assert.doesNotMatch(open,/You’re on the list|disabled/);
  const joined = ui.tournamentCard({...event,registered:'3',joined:true});
  assert.match(joined,/3 registrations/);
  assert.match(joined,/You’re on the list/);
  assert.match(joined,/disabled/);
  assert.match(open,/data-action="view-bracket"[^>]*data-id="event-render-test"/);
});

test('team membership uses the database count and does not invent a member when missing', () => {
  const ui = client({teams:[{id:'team-render-test',name:'Runtime team',tag:'RT',members:'12'}]});
  ui.state.socialTab = 'teams';
  assert.match(ui.friendsPage(),/12 members/);
  ui.state.data.teams = [{id:'missing-count',name:'Runtime team',tag:'RT'}];
  assert.match(ui.friendsPage(),/Member count unavailable/);
});

test('the gallery only displays supplied curated drawings and keeps external assets blocked', () => {
  const ui = client({drawings:[
    {id:'drawing-fame',hall:'fame',prompt:'Runtime cat',artist:'render_test_artist',url:'/api/drawings/drawing-fame/image'},
    {id:'drawing-shame',hall:'shame',prompt:'Runtime horse',artist:'render_test_artist',url:'/api/drawings/drawing-shame/image'},
    {id:'drawing-unlisted',prompt:'Unlisted artwork',url:'/api/drawings/drawing-unlisted/image'},
  ]});
  assert.match(ui.communityPage(),/Runtime cat/);
  assert.doesNotMatch(ui.communityPage(),/Runtime horse|Unlisted artwork/);
  ui.state.communityTab = 'shame';
  assert.match(ui.communityPage(),/Runtime horse/);
  assert.doesNotMatch(ui.communityPage(),/Runtime cat/);
  ui.state.data.drawings[1].url = 'https://external.invalid/asset.png';
  assert.match(ui.communityPage(),/Artwork is not available/);
  assert.doesNotMatch(ui.communityPage(),/src="https:/);
});

test('account rewards are derived only from actual inventory, awards, and challenge records', () => {
  const ui = client({user:{username:'render_test_account',xp:240,level:2,history:[],inventory:[],achievements:[],trophies:[]}});
  assert.match(ui.cosmeticsCollection(ui.state.data.user),/unlocked decorations will appear/);
  assert.doesNotMatch(ui.profilePage(),/class="cosmetic |class="award-row|width:0%/);
  ui.state.data.user.inventory = [{slug:'runtime-title',name:'Earned runtime title',slot:'title',equipped:true}];
  ui.state.data.user.achievements = [{title:'Recorded achievement',description:'Recorded milestone'}];
  assert.match(ui.profilePage(),/Earned runtime title/);
  assert.match(ui.profilePage(),/Recorded achievement/);
  const challenge = ui.challengeRow({id:'challenge-render-test',title:'Runtime challenge',target:3,progress:3,xp:75},0);
  assert.match(challenge,/data-action="claim"[^>]*data-id="challenge-render-test"/);
  assert.doesNotMatch(ui.challengeRow({title:'Runtime challenge',target:3,progress:0},0),/\+100 XP/);
});

test('admin-created leagues supply escaped names and reveal league navigation', () => {
  const ui = client({leagues:[{id:'test-league',name:'Weekend <league>'}],season:null});
  assert.match(ui.sidebar(),/href="#\/league"/);
  assert.match(ui.sidebar(),/Weekend &lt;league&gt;/);
  assert.match(ui.topbar(),/Weekend &lt;league&gt;/);
  assert.match(ui.homePage(),/Weekend &lt;league&gt;/);
  assert.match(ui.leaguePage(),/Leaderboard/);
  ui.state.leaderboardTab = 'season';
  assert.match(ui.leaguePage(),/No active season/);
  ui.state.data.leagues=[];
  assert.doesNotMatch(ui.sidebar(),/season-card/);
  assert.match(ui.sidebar(),/href="#\/league"/);
});


test('public leaderboard defaults to all time and renders independent period and audience controls',()=>{
  const ui=client({user:{id:'mine',username:'my_name'}});
  assert.equal(ui.state.leaderboardTab,'all-time');
  ui.state.board={players:[{id:'mine',displayName:'<Player>',rank:29,points:123,wins:1,played:4,level:2}],top:[],me:{rank:29,points:123},total:30,page:2};
  let html=ui.leaguePage();
  for(const period of ['all-time','weekly','monthly','season']) assert.match(html,new RegExp(`data-value="${period}"`));
  for(const scope of ['everyone','friends']) assert.match(html,new RegExp(`data-value="${scope}"`));
  assert.match(html,/Your rank/);assert.match(html,/#29/);assert.match(html,/&lt;Player&gt;/);
  assert.match(html,/leaderboard-you/);assert.match(html,/Page 2 of 2/);
  assert.match(html,/data-label="Matches"/);
  ui.state.boardLoading=true;ui.state.board=null;
  assert.match(ui.leaguePage(),/Loading standings/);
  ui.state.boardLoading=false;ui.state.boardError='Server unavailable';
  assert.match(ui.leaguePage(),/Server unavailable/);assert.match(ui.leaguePage(),/Try again/);
  ui.state.data.user=null;ui.state.leaderboardScope='friends';
  html=ui.leaguePage();assert.match(html,/Sign in to compare/);assert.doesNotMatch(html,/community-leaderboard/);
});
