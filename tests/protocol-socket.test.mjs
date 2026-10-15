import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolSocket} from './helpers/protocol-socket.mjs';

function eventBytes(size) {
  const message={type:'your-turn',data:{timeLeft:30000,preSelectedWord:0,words:[''],hardWord:false}};
  message.data.words[0]='a'.repeat(size-Buffer.byteLength(JSON.stringify(message)));
  const bytes=Buffer.from(JSON.stringify(message));
  assert.equal(bytes.length,size);
  return bytes;
}
function frame(payload,{opcode=1,final=true}={}) {
  const header=Buffer.alloc(payload.length<126?2:payload.length<=65535?4:10);
  header[0]=(final?128:0)|opcode;
  if(header.length===2) header[1]=payload.length;
  else if(header.length===4) {header[1]=126;header.writeUInt16BE(payload.length,2);}
  else {header[1]=127;header.writeBigUInt64BE(BigInt(payload.length),2);}
  return Buffer.concat([header,payload]);
}
function client() {const socket=new ProtocolSocket();socket.upgraded=true;return socket;}

test('a 127-byte word-choice event does not stall following multiplayer events',()=>{
  const socket=client(),received=[];
  socket.on('event',event=>received.push(event.type));
  const next=Buffer.from(JSON.stringify({type:'next-turn',data:{round:1}}));
  socket.receive(Buffer.concat([frame(eventBytes(127)),frame(next)]));
  assert.deepEqual(received,['your-turn','next-turn']);
  assert.equal(socket.pending.length,2);assert.equal(socket.bytes.length,0);
});

test('protocol socket decodes short, 16-bit and 64-bit frame lengths across TCP chunks',()=>{
  for(const size of [125,126,127,128,65535,65536]) {
    const expected=eventBytes(size),bytes=frame(expected);
    for(const split of [1,2,3,4,9,10,bytes.length-1]) {
      const socket=client();
      socket.receive(bytes.subarray(0,split));socket.receive(bytes.subarray(split));
      assert.equal(socket.pending.length,1,`payload ${size}, split ${split}`);
      assert.deepEqual(socket.pending[0],JSON.parse(expected));
      assert.equal(socket.bytes.length,0);
    }
  }
});

test('fragmented word choices and a coalesced upgrade preserve the event stream',()=>{
  const payload=eventBytes(254),socket=new ProtocolSocket();
  const header=Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  socket.receive(Buffer.concat([header,frame(payload.subarray(0,127),{final:false})]));
  assert.equal(socket.pending.length,0);
  socket.receive(frame(payload.subarray(127),{opcode:0}));
  assert.equal(socket.upgraded,true);
  assert.deepEqual(socket.pending,[JSON.parse(payload)]);
});
