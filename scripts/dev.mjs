import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../server/config.mjs';
const config=await loadConfig();
const enginePath=process.env.ENGINE_BINARY || resolve(process.platform==='win32'?'.tools/skribbil-engine.exe':'.tools/skribbil-engine');
const children=[];
const enginePort=Number(process.env.ENGINE_PORT||4181);
if(existsSync(enginePath)) {
  const engine=spawn(enginePath,[],{cwd:resolve('engine'),stdio:'inherit',env:{...process.env,ROOT_PATH:'/engine',NETWORK_ADDRESS:'127.0.0.1',PORT:String(enginePort),
    SKRIBBIL_ENGINE_SECRET:config.secret,SKRIBBIL_EVENTS_URL:`http://127.0.0.1:${config.port}/api/internal/engine-events`,SKRIBBIL_OUTBOX_DIR:resolve('.data/engine-outbox')}});
  children.push(engine);
}else console.log('Engine binary is not built. The clubhouse will run; see README.md for Go build instructions.');
children.push(spawn(process.execPath,['--watch','server/index.mjs'],{stdio:'inherit',env:{...process.env,ENGINE_URL:`http://127.0.0.1:${enginePort}`,SKRIBBIL_ENGINE_SECRET:config.secret}}));
for(const child of children)child.on('exit',code=>{if(code){for(const other of children)other.kill();process.exitCode=code;}});
const stop=()=>{for(const child of children)child.kill();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
