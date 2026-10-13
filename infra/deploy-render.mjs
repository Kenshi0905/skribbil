import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function deployRender({hook, revision, request=fetch, pause=sleep, attempts=120}) {
  if(!/^[a-f0-9]{40}$/.test(revision||''))throw new Error('A full Git commit SHA is required.');
  let url;
  try {url=new URL(hook);}catch {throw new Error('Render deploy hook is missing or invalid.');}
  if(url.origin!=='https://api.render.com'||url.pathname!=='/deploy/srv-db6if1g473hc739rmhb0'||!url.searchParams.get('key'))
    throw new Error('Unexpected Render deploy hook destination.');
  url.searchParams.set('ref',revision);
  let response;
  // Never log the hook URL, raw response bodies or fetch errors: they can contain credentials.
  try {response=await request(url,{method:'POST',signal:AbortSignal.timeout(30000),redirect:'error'});}
  catch {throw new Error('Could not contact Render deployment endpoint.');}
  if(!response.ok)throw new Error(`Render rejected deployment (HTTP ${response.status}).`);
  console.log(`Render accepted deployment for ${revision}. Waiting for the matching healthy server.`);
  for(let attempt=0;attempt<attempts;attempt++) {
    try {
      const health=await request('https://skribbil.onrender.com/api/health',{signal:AbortSignal.timeout(5000),cache:'no-store'});
      const body=health.ok?await health.json():null;
      if(body?.ok===true&&body.revision===revision){console.log('Requested server revision is live.');return;}
    }catch { /* Cold starts and rolling restarts are expected. */ }
    await pause(10000);
  }
  throw new Error('Timed out waiting for the requested revision; Pages was not published. Check Render logs.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {await deployRender({hook:process.env.RENDER_DEPLOY_HOOK_URL,revision:process.env.GITHUB_SHA});}
  catch(error){console.error(error.message);process.exitCode=1;}
}
