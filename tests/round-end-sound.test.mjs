import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../engine/internal/frontend/lobby.js',import.meta.url),'utf8');
const notify=source.slice(source.indexOf('function playRoundEndSound('),source.indexOf('function playWav('));
test('actual round endings play the end cue; initial waiting and repeated final results stay quiet',()=>{
 const sounds=[];const context=vm.createContext({gameState:'unstarted',playWav:file=>sounds.push(file)});
 vm.runInContext(notify+';globalThis.end=playRoundEndSound;',context);
 context.end();assert.equal(sounds.length,0);
 context.gameState='ongoing';context.end();assert.equal(sounds.length,1);assert.match(sounds[0],/end-turn.wav/);
 context.gameState='gameOver';context.end();assert.equal(sounds.length,1);
});
