import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadImage} from '@napi-rs/canvas';
import * as v1 from '../web/avatar-v1.js';
import {avatarV2Options,avatarV2Keys,defaultAvatarV2,avatarFromUrl,avatarUrl,renderAvatar,editableAvatar,avatarVibes,randomAvatar} from '../web/avatar.js';

test('v1 URLs, options and artwork remain unchanged; v2 upgrades only on explicit edit',()=>{
  for(const key of v1.avatarKeys)for(let i=0;i<v1.avatarOptions[key].length;i++){
    const old={...v1.defaultAvatar,[key]:i},url=v1.avatarUrl(old);
    assert.deepEqual(avatarFromUrl(url),old);assert.equal(avatarUrl(old),url);assert.equal(renderAvatar(old),v1.renderAvatar(old));
    assert.equal(editableAvatar(old)[key],i);
  }
  assert.equal(editableAvatar(v1.defaultAvatar).version,2);
  for(const k of ['hair','eyes','eyebrows','mouth','accessory'])assert.deepEqual(avatarV2Options[k].slice(0,v1.avatarOptions[k].length),v1.avatarOptions[k]);
});
test('every v2 choice renders a safe 200x200 image and canonically round-trips',async()=>{
  for(const key of avatarV2Keys)for(let i=0;i<avatarV2Options[key].length;i++){
    const a={...defaultAvatarV2,[key]:i},url=avatarUrl(a),svg=renderAvatar(a);
    assert.deepEqual(avatarFromUrl(url),a);assert.doesNotMatch(svg,/<script|on\w+=|href=|undefined|NaN|<foreignObject/i);
    const img=await loadImage(Buffer.from(svg));assert.equal(img.width,200);assert.equal(img.height,200);
    assert.equal(avatarFromUrl(url+'?x=1'),null);assert.equal(avatarFromUrl(url.replace('/v2/','/v3/')),null);
    assert.equal(avatarFromUrl(url.replace('/v2/','/v2/0')),null);
    assert.equal(avatarFromUrl(avatarUrl(defaultAvatarV2).replace('/v2/0-','/v2/'+avatarV2Options.face.length+'-')),null);
    assert.throws(()=>avatarUrl({...a,[key]:avatarV2Options[key].length}));
  }
  for(const url of ['//host/a.svg','data:image/svg+xml,test','blob:x','javascript:x','/api/avatar-presets/v2/../v1/x.svg','/api/media/another-avatar'])assert.equal(avatarFromUrl(url),null);
});
test('vibes produce valid varied avatars and all inclusive skin tones',()=>{
  for(const vibe of avatarVibes){const seen=new Set();for(let i=0;i<1000;i++){const a=randomAvatar(Math.random,vibe);seen.add(a.skin);assert.deepEqual(avatarFromUrl(avatarUrl(a)),a);assert.doesNotThrow(()=>renderAvatar(a));}assert.equal(seen.size,8);}
  assert.throws(()=>randomAvatar(Math.random,'unknown'));
});
test('v2 option bounds stay synchronized with Go and native browser validation',()=>{
  const bounds=avatarV2Keys.map(k=>avatarV2Options[k].length);
  const go=readFileSync(new URL('../engine/internal/game/room_identity.go',import.meta.url),'utf8');
  assert.deepEqual(go.match(/PresetAvatarV2Bounds = \[\.\.\.\]int\{([^}]+)\}/)[1].split(',').map(Number),bounds);
  const js=readFileSync(new URL('../engine/internal/frontend/lobby.js',import.meta.url),'utf8');
  assert.deepEqual(js.match(/const bounds = .*? : \[([^\]]+)\]/)[1].split(',').map(Number),bounds);
});
