import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../engine/internal/frontend/lobby.js',import.meta.url),'utf8');
const avatarFunction=source.slice(source.indexOf('function validCommunityPreset('),source.indexOf('function createPlayerStateImageNode('));
function render(player) {
  const document={createElement(tag){return {tag,children:[],events:{},classList:{add(){}},setAttribute(){},appendChild(child){this.children.push(child);child.remove=()=>{this.children=this.children.filter(item=>item!==child);};},addEventListener(name,handler){this.events[name]=handler;}};}};
  const context=vm.createContext({document,player});
  return vm.runInContext(`${avatarFunction}\ncreateCommunityAvatar(player);`,context);
}
test('native player avatar uses saved community preset and falls back after an image error',()=>{
  const avatar=render({name:'Kenshi',avatarUrl:'/api/avatar-presets/v1/2-0-0-0-0-1-1-0-0.svg'});
  assert.equal(avatar.textContent,'KE');assert.equal(avatar.children.length,1);
  assert.equal(avatar.children[0].src,'/api/avatar-presets/v1/2-0-0-0-0-1-1-0-0.svg');
  avatar.children[0].events.error();assert.equal(avatar.children.length,0);assert.equal(avatar.textContent,'KE');
});
test('uploads work; missing, external and malformed images use initials without requests',()=>{
  assert.equal(render({name:'Player',avatarUrl:'/api/avatar-presets/v2/0-12-6-0-0-6-1-7-1-1-0-0.svg'}).children.length,1);
  for(const avatarUrl of ['/api/avatar-presets/v2/0-24-6-0-0-6-1-7-1-1-0-0.svg','/api/avatar-presets/v2/00-12-6-0-0-6-1-7-1-1-0-0.svg','/api/avatar-presets/v2/0-12-6-0-0-6-1-7-1-1-0-0.svg?x'])assert.equal(render({name:'Player',avatarUrl}).children.length,0);
  assert.equal(render({name:'Player',avatarUrl:'/api/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}).children.length,1);
  for(const avatarUrl of [undefined,'https://example.com/track.png','//example.com/track.png','data:image/svg+xml,test','/api/media/../logout']) {
    const avatar=render({name:'<script>',avatarUrl});assert.equal(avatar.children.length,0);assert.equal(avatar.textContent,'<S');
  }
});
