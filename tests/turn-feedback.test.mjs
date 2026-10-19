import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../engine/internal/frontend/lobby.js',import.meta.url),'utf8');
const announce=source.slice(source.indexOf('function showRoundEndMessage('),source.indexOf('function revealRoundWord('));
test('turn endings keep the previous answer in chat as literal text',()=>{
 const messages=[];const context=vm.createContext({appendMessage:(...args)=>messages.push(args)});
 vm.runInContext(announce+';globalThis.announce=showRoundEndMessage;',context);
 context.announce('<img onerror=bad>');
 assert.deepEqual(messages,[['system-message',null,'The word was “<img onerror=bad>”.']]);
 context.announce(null);
 assert.equal(messages.length,2);assert.equal(messages[1][0],'system-message');
});
