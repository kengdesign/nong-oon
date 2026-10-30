import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflow,createClient} from '../scripts/staging-media-e2e.mjs';
import {mediaFixture,mediaEvent,fakeFetch,owner} from './helpers/media.mjs';
import {ingestMediaEvents,cleanupMedia,MEDIA_LEASE_MS} from '../src/media-store.mjs';
import {processMediaJob} from '../src/media-pipeline.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
import {handleMediaApi} from '../src/media-api.mjs';
import {handleCareApi} from '../src/care-api.mjs';
test('staging API runner exercises actual handlers, replay and cancellation in disposable SQL only',async()=>{
 const f=await mediaFixture();try{
  f.sql.prepare('UPDATE patients SET display_name=? WHERE id=?').run('SYNTHETIC E2E',f.patientId);
  for(const id of ['99100001','99100002']){
   await ingestMediaEvents(f.db,[mediaEvent(f.now,id)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
  }
  const jobs=f.sql.prepare('SELECT id FROM media_jobs ORDER BY id').all().map(r=>r.id);
  for(const job of jobs)await processMediaJob(f.env,job,{clock:()=>f.now,fetcher:fakeFetch,infer:async()=>draftFromText('TESTBLISTER 5 mg','printed_label')});
  const request=async(path,method='GET',body)=>{
   if(path==='/health')return {status:200,data:{status:'staging',deliveryEnabled:false}};
   if(path==='/api/session')return {status:200,data:{authenticated:true}};
   const req=new Request('https://staging.nongoon.com'+path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
   const r=await (path.startsWith('/api/media/')?handleMediaApi:handleCareApi)(req,f.env,{actorId:owner,now:f.now});
   return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?await r.json():null};
  };
  const result=await runWorkflow({manifest:{syntheticOnly:true,patientId:f.patientId,jobs},request});
  assert.equal(result.workflow,'passed');assert.equal(result.endToEndPassed,false);assert.equal(result.physicalR2Deletion,'not_run');
  await cleanupMedia(f.env,f.now+MEDIA_LEASE_MS+1);
  assert.equal(f.objects.size,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs WHERE draft_json IS NOT NULL OR message_id IS NOT NULL').get().n,0);
 }finally{f.close();}
});
test('nonisolated manifests and real profiles fail before writes',async()=>{
 let writes=0;
 const request=async(path,method='GET')=>{if(method!=='GET')writes++;return {status:200,data:path==='/health'?{status:'staging',deliveryEnabled:false}:path==='/api/session'?{authenticated:true}:{patients:[{id:'p',role:'owner',displayName:'Keng'}]}};};
 await assert.rejects(runWorkflow({manifest:{syntheticOnly:true,patientId:'p',jobs:['a','b']},request}),/ISOLATED_TEST_PROFILE_REQUIRED/);
 await assert.rejects(runWorkflow({manifest:{syntheticOnly:true,patientId:'p',jobs:['a','a']},request}),/MANIFEST_REQUIRED/);
 assert.equal(writes,0);
});
test('Access redirects are blocked without forwarding cookies; non-JSON is never health proof',async()=>{
 const calls=[];const request=createClient({cookie:'test-only',fetcher:async(url,init)=>{calls.push({url,init});return new Response(null,{status:302,headers:{location:'https://example.invalid'}});}});
 await assert.rejects(request('/health'),/AUTH_REDIRECT_BLOCKED/);
 assert.equal(calls.length,1);assert.equal(calls[0].init.redirect,'manual');
 await assert.rejects(request('//example.invalid'),/INVALID_TARGET/);
 const html=createClient({fetcher:async()=>new Response('<html>sign in</html>',{headers:{'content-type':'text/html'}})});
 await assert.rejects(html('/health'),/NON_JSON_AUTH_OR_ROUTE_RESPONSE/);
});
