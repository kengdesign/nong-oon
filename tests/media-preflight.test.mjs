import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaPreflight} from '../scripts/cloudflare-media-preflight.mjs';
const input={token:'never-print-this',accountId:'a'.repeat(32),worker:'synthetic-worker',bucket:'synthetic-bucket',queue:'synthetic-queue'};
test('preflight only reads and emits binding names and booleans, not runtime data',async()=>{
  const seen=[];
  const report=await mediaPreflight({...input,fetcher:async(url,options)=>{
    seen.push(url);assert.equal(options.method,undefined);assert.equal(options.headers.authorization,'Bearer never-print-this');
    return Response.json({success:true,result:url.includes('/settings')?{bindings:[...['DB','MEDIA_R2','MEDIA_QUEUE','AI','GOOGLE_VISION_API_KEY'].map(name=>({name,type:'secret_text',text:'secret-health-data'})),{name:'DELIVERY_ENABLED',type:'plain_text',text:'secret-health-data'}]}:url.includes('/queues?')?[{queue_name:input.queue}]:{}});
  }});
  assert.equal(report.readyForDrill,true);assert.equal(seen.length,3);assert.equal(JSON.stringify(report).includes('secret-health-data'),false);assert.equal(JSON.stringify(report).includes(input.token),false);
});
test('preflight reports auth failures without copying provider error bodies',async()=>{
  const r=await mediaPreflight({...input,fetcher:async()=>new Response('private information',{status:403})});
  assert.equal(r.readyForDrill,false);assert.equal(r.settingsStatus,403);assert.equal(JSON.stringify(r).includes('private information'),false);
  await assert.rejects(mediaPreflight({...input,worker:'../other'}),/PREFLIGHT_INPUT_REQUIRED/);
});
