import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaPreflight} from '../scripts/cloudflare-media-preflight.mjs';
const input={token:'never-print-this',accountId:'a'.repeat(32),worker:'synthetic-worker',bucket:'synthetic-bucket',queue:'synthetic-queue'};
test('drill readiness rejects wrong binding types, production and open or unknown delivery gates',async()=>{
  const base=[...Object.entries({DB:'d1',MEDIA_R2:'r2_bucket',MEDIA_QUEUE:'queue',AI:'ai',GOOGLE_VISION_API_KEY:'secret_text'}).map(([name,type])=>({name,type})),{name:'APP_ENV',type:'plain_text',text:'staging'},...['DELIVERY_ENABLED','INGESTION_ENABLED'].map(name=>({name,type:'plain_text',text:'false'}))];
  for(const mode of ['wrong_type','production','delivery_open','ingestion_unknown']){
    const bindings=structuredClone(base);
    if(mode==='wrong_type')bindings.find(b=>b.name==='MEDIA_R2').type='plain_text';
    if(mode==='production')bindings.find(b=>b.name==='APP_ENV').text='production';
    if(mode==='delivery_open')bindings.find(b=>b.name==='DELIVERY_ENABLED').text='true';
    if(mode==='ingestion_unknown')bindings.splice(bindings.findIndex(b=>b.name==='INGESTION_ENABLED'),1);
    const r=await mediaPreflight({...input,fetcher:async url=>Response.json({success:true,result:url.includes('/settings')?{bindings}:url.includes('/queues?')?[{queue_name:input.queue}]:{}})});
    assert.equal(r.readyForDrill,false,mode);
  }
});
test('preflight only reads and emits binding names and booleans, not runtime data',async()=>{
  const seen=[];
  const report=await mediaPreflight({...input,fetcher:async(url,options)=>{
    seen.push(url);assert.equal(options.method,undefined);assert.equal(options.headers.authorization,'Bearer never-print-this');
    return Response.json({success:true,result:url.includes('/settings')?{bindings:[...Object.entries({DB:'d1',MEDIA_R2:'r2_bucket',MEDIA_QUEUE:'queue',AI:'ai',GOOGLE_VISION_API_KEY:'secret_text'}).map(([name,type])=>({name,type,text:'secret-health-data'})),{name:'APP_ENV',type:'plain_text',text:'staging'},...['DELIVERY_ENABLED','INGESTION_ENABLED'].map(name=>({name,type:'plain_text',text:'false'}))]}:url.includes('/queues?')?[{queue_name:input.queue}]:{}});
  }});
  assert.equal(report.readyForDrill,true);assert.equal(seen.length,3);assert.equal(JSON.stringify(report).includes('secret-health-data'),false);assert.equal(JSON.stringify(report).includes(input.token),false);
});
test('preflight reports auth failures without copying provider error bodies',async()=>{
  const r=await mediaPreflight({...input,fetcher:async()=>new Response('private information',{status:403})});
  assert.equal(r.readyForDrill,false);assert.equal(r.settingsStatus,403);assert.equal(JSON.stringify(r).includes('private information'),false);
  await assert.rejects(mediaPreflight({...input,worker:'../other'}),/PREFLIGHT_INPUT_REQUIRED/);
});
