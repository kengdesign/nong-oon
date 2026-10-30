import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaFixture,mediaEvent,other} from './helpers/media.mjs';
import {ingestMediaEvents,cleanupMedia,MEDIA_LEASE_MS} from '../src/media-store.mjs';
import {readMediaJob,retryMediaJob,saveMediaReview} from '../src/media-review.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
import {parseDraft} from '../src/draft-contract.mjs';
import {handleMediaApi} from '../src/media-api.mjs';
import {lookupDrugReference} from '../src/drug-reference.mjs';
async function ready({withText=false}={}){const f=await mediaFixture();await ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
 const id=f.sql.prepare('SELECT id FROM media_jobs').get().id;
 const draft={...JSON.parse(draftFromText('Samplebrand 20 mg','printed_label')),...(withText?{sourceText:'PRIVATE SYNTHETIC OCR\nSamplebrand 20 mg'}:{})};
 f.sql.prepare("UPDATE media_jobs SET state='awaiting_review',attempts=1,draft_json=?").run(JSON.stringify(draft));
 return {...f,context:{jobId:id,patientId:f.patientId,actorId:'U'+'1'.repeat(32),providerId:f.env.MEDIA_PROVIDER_ID,now:f.now}};}
test('bounded private OCR source permits legacy drafts but rejects controls and wrong source',()=>{
 const d=JSON.parse(draftFromText('synthetic','printed_label'));assert.equal(parseDraft(JSON.stringify(d)).ok,true);
 for(const sourceText of ['x'.repeat(8001),'\u0000',''])assert.equal(parseDraft(JSON.stringify({...d,sourceText})).ok,false);
 assert.equal(parseDraft(JSON.stringify({...d,sourceKind:'voice',sourceText:'synthetic'})).ok,false);
});
test('owner retry preserves expiry/attempts and refuses concurrent replay, other owner and attempt exhaustion',async()=>{
 const f=await ready();try{
  const before=f.sql.prepare('SELECT expires_at,attempts FROM media_jobs').get();
  await assert.rejects(retryMediaJob(f.db,{...f.context,actorId:other}));
  assert.equal((await retryMediaJob(f.db,f.context)).queued,true);
  assert.deepEqual({...f.sql.prepare('SELECT expires_at,attempts FROM media_jobs').get()},{...before});
  assert.equal(f.sql.prepare('SELECT draft_json FROM media_jobs').get().draft_json,null);
  await assert.rejects(retryMediaJob(f.db,f.context));
  f.sql.prepare("UPDATE media_jobs SET state='awaiting_review',attempts=3,draft_json=?").run(draftFromText('synthetic','printed_label'));
  await assert.rejects(retryMediaJob(f.db,f.context));
 }finally{f.close();}
});
test('saved edits block retry; expiry cleanup erases private OCR payload',async()=>{
 const f=await ready({withText:true});try{
  await saveMediaReview(f.db,{...f.context,itemIndex:0,input:{expectedReviewVersion:0,expectedScheduleVersion:1,sourceChecked:true,issuesResolved:true,useMode:'scheduled',strength:'20 mg',dose:'synthetic',schedule:{label:'Synthetic',instructions:'Synthetic only',times:['08:00'],weekdays:[1],startDate:'2026-10-29',endDate:null}}});
  await assert.rejects(retryMediaJob(f.db,f.context));assert.equal((await readMediaJob(f.db,f.context)).reviews.length,1);
  await cleanupMedia(f.env,f.now+86400000+MEDIA_LEASE_MS);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,0);
  await assert.rejects(readMediaJob(f.db,{...f.context,now:f.now+86400000+1}));
 }finally{f.close();}
});
test('curated reference needs exact name and matching strength, never manufacturer or fuzzy spelling',()=>{
 const f=(label,strength)=>({label:{value:label},strength:{value:strength}});
 assert.equal(lookupDrugReference(f('Bestatin 20','20 mg')).ingredient,'Simvastatin');
 for(const v of [f('Berlin','20 mg'),f('Bestatin 20','40 mg'),f('Bestatin','20 mg'),f('Bestatln 20','20 mg'),f(null,'20 mg')])assert.equal(lookupDrugReference(v),null);
});

test('actual media API lists private jobs and queues owner retry without changing expiry',async()=>{
 const f=await ready();try{
  const env={...f.env,MEDIA_PROVIDER_ENABLED:'true',GOOGLE_VISION_API_KEY:'synthetic-key'};
  const root=`https://example.test/api/media/patients/${f.patientId}/jobs`;
  const list=await handleMediaApi(new Request(root),env,f.context);assert.equal(list.status,200);
  assert.equal((await list.json()).jobs.length,1);
  const response=await handleMediaApi(new Request(root+'/'+f.context.jobId+'/retry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({acknowledge:true})}),env,f.context);
  assert.equal(response.status,202);assert.equal((await response.json()).queued,true);assert.equal(f.messages.length,1);
 }finally{f.close();}
});

test('existing OCR text reparses without changing attempts, expiry or queue',async()=>{
 const f=await ready({withText:true});try{
  const before=f.sql.prepare('SELECT expires_at,attempts FROM media_jobs').get();
  assert.equal((await retryMediaJob(f.db,f.context)).reparsed,true);
  assert.equal((await readMediaJob(f.db,f.context)).draft.sourceText.includes('PRIVATE SYNTHETIC'),true);
  assert.deepEqual({...f.sql.prepare('SELECT expires_at,attempts FROM media_jobs').get()},{...before});
  assert.equal(f.messages.length,0);
 }finally{f.close();}
});
