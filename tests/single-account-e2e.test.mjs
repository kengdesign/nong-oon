import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from './helpers/db.mjs';
import {runRehearsal} from '../acceptance-media/single-account-e2e.mjs';
import assets from '../acceptance-media/mock-assets.mjs';
async function fixture(){const f=createTestDb(),objects=new Map();return {...f,objects,env:{E2E_ENV:'isolated-single-account',E2E_DB:f.db,GOOGLE_VISION_API_KEY:'synthetic-test-key',E2E_R2:{async put(k,bytes){objects.set(k,bytes);},async get(k){return objects.has(k)?{body:objects.get(k)}:null;},async head(k){return objects.has(k)?{size:objects.get(k).length}:null;},async delete(k){objects.delete(k);}}}};}
test('isolated full backend rehearsal needs no real LINE account and verifies actual SQL payload clearing',async()=>{
 const f=await fixture();let calls=0;try{
  const result=await runRehearsal(f.env,{providerMode:'synthetic_provider_response',providerFetch:async(_url,init)=>{calls++;const body=JSON.parse(init.body),a=assets.find(a=>a.base64===body.requests[0].image.content);assert.ok(a);return Response.json({responses:[{fullTextAnnotation:{text:a.reference}}]});}});
  assert.equal(result.state,'passed');assert.equal(result.providerCalls,2);assert.equal(result.mainStagingAcceptance,false);assert.equal(f.objects.size,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM patients WHERE revoked_at IS NULL').get().n,0);
  const again=await runRehearsal(f.env,{providerFetch:()=>{throw Error('unexpected repeat');}});assert.equal(again.replayed,true);assert.equal(calls,2);
 }finally{f.close();}
});
test('main resource binding or LINE credentials reject before schema writes; absent OCR secret does not pass',async()=>{
 const f=await fixture();try{
  for(const value of [{DB:f.db},{MEDIA_R2:f.env.E2E_R2},{LINE_CHANNEL_ACCESS_TOKEN:'forbidden'}])await assert.rejects(runRehearsal({...f.env,...value}),/ISOLATION_REQUIRED/);
  const result=await runRehearsal({...f.env,GOOGLE_VISION_API_KEY:undefined});assert.equal(result.state,'blocked');
 }finally{f.close();}
});
test('bad provider output is failed, never retried automatically or misreported as E2E pass',async()=>{
 const f=await fixture();let calls=0;try{
  const result=await runRehearsal(f.env,{providerMode:'synthetic_provider_response',providerFetch:async()=>{calls++;return Response.json({responses:[{fullTextAnnotation:{text:'unreadable'}}]});}});
  assert.equal(result.state,'failed');await runRehearsal(f.env);assert.equal(calls,1);
 }finally{f.close();}
});

test('withdrawal success is independent of trigger-inclusive D1 change counts',async()=>{
 const f=await fixture();const original=f.env.E2E_DB.batch.bind(f.env.E2E_DB);let inflated=false;
 f.env.E2E_DB.batch=async statements=>{const result=await original(statements);if(statements[0].query.startsWith('UPDATE patients SET revoked_at=')){result[0].meta.changes=7;inflated=true;}return result;};
 try {const report=await runRehearsal(f.env,{providerMode:'synthetic_provider_response',providerFetch:async(_url,init)=>{const body=JSON.parse(init.body),a=assets.find(a=>a.base64===body.requests[0].image.content);return Response.json({responses:[{fullTextAnnotation:{text:a.reference}}]});}});assert.equal(inflated,true);assert.equal(report.state,'passed');}finally{f.close();}
});
