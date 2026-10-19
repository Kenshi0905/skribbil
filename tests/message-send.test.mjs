import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../engine/internal/frontend/lobby.js',import.meta.url),'utf8');
const submission=source.slice(source.indexOf('//Used to restore the last message'),source.indexOf('function setAllowDrawing('));
function fixture(){
 const input=Object.assign(new EventTarget(),{value:'',disabled:false}),button=Object.assign(new EventTarget(),{disabled:false}),form=new EventTarget();
 const document={activeElement:input,getElementById:id=>id==='message-form'?form:button};
 const messages=[],notices=[],socket={readyState:1,send:json=>messages.push(JSON.parse(json))};
 vm.runInNewContext(submission,{messageInput:input,document,socket,WebSocket:{OPEN:1},TextEncoder,appendMessage:(...args)=>notices.push(args),setTimeout});
 const dispatch=(target,type,properties={})=>{const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(properties))Object.defineProperty(event,key,{value});target.dispatchEvent(event);return event;};
 return {input,button,form,document,socket,messages,notices,dispatch};
}
test('the on-screen Send button submits composing mobile text once without losing input focus',()=>{
 const f=fixture();f.input.value='yo mr white';f.dispatch(f.input,'compositionstart');
 f.dispatch(f.form,'submit');assert.equal(f.messages.length,0,'IME candidate acceptance must not send');
 assert.equal(f.dispatch(f.button,'pointerdown',{button:0,isPrimary:true,pointerType:'touch'}).defaultPrevented,true,'keep the keyboard layout stable until click');
 const click=f.dispatch(f.button,'click',{detail:1});
 assert.equal(click.defaultPrevented,true,'prevent a second native form submission');
 assert.deepEqual(f.messages,[{type:'message',data:'yo mr white'}]);
 assert.equal(f.input.value,'');assert.equal(f.document.activeElement,f.input);
 f.dispatch(f.form,'submit');assert.equal(f.messages.length,1);
});
test('implicit composing Enter remains guarded; normal Enter and keyboard activation of Send still work',()=>{
 const f=fixture();f.input.value='candidate';f.dispatch(f.input,'compositionstart');
 f.dispatch(f.button,'click',{detail:0});assert.equal(f.messages.length,0);
 f.dispatch(f.input,'compositionend');f.dispatch(f.form,'submit');assert.equal(f.messages[0].data,'candidate');
 f.input.value='button keyboard activation';f.document.activeElement=f.button;f.dispatch(f.button,'click',{detail:0});
 assert.equal(f.messages[1].data,'button keyboard activation');
});
test('Send preserves spectator, connection and UTF-8 length restrictions and retains unsent text',()=>{
 const f=fixture();f.input.value='keep this';f.input.disabled=true;f.dispatch(f.button,'click',{detail:1});
 f.input.disabled=false;f.socket.readyState=3;f.dispatch(f.button,'click',{detail:1});
 assert.equal(f.messages.length,0);assert.equal(f.input.value,'keep this');
 f.socket.readyState=1;f.input.value='🙂'.repeat(2501);f.dispatch(f.button,'click',{detail:1});
 assert.equal(f.messages.length,0);assert.equal(f.notices.length,1);assert.equal(f.input.value.length,5002);
 assert.equal(f.dispatch(f.button,'pointerdown',{button:2,isPrimary:true}).defaultPrevented,false);
});
