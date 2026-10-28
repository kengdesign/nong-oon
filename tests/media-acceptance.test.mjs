import test from 'node:test';
import assert from 'node:assert/strict';
import {measureSample} from '../acceptance-media/quality.mjs';
import {runCleanupAcceptance} from '../scripts/media-cleanup-acceptance.mjs';
const ref='ชื่อยา: SYNTHETIC ONLY\nความแรง: TEST\nจำนวนต่อครั้ง: TEST\nวิธีใช้: ทดสอบเท่านั้น\nเวลา: 08:00\nวัน: 0,1,2,3,4,5,6\nวันที่เริ่ม: 2026-10-28\nลักษณะการใช้: ตามเวลา';
const sample={kind:'image',reference:ref,base64:btoa('123456789012'),contentType:'image/png'};
test('quality compares known fields, one OCR call, aggregate output only',async()=>{
  let calls=0;const r=await measureSample({GOOGLE_VISION_API_KEY:'test'},sample,{fetcher:async()=>{calls++;return Response.json({responses:[{fullTextAnnotation:{text:ref}}]});}});
  assert.equal(calls,1);assert.equal(r.screen,'passed');assert.equal(r.knownFields,8);assert.equal(r.pilotReady,false);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC ONLY|ทดสอบเท่านั้น/);
});
test('poor recognition fails quality despite successful provider response',async()=>{
  const r=await measureSample({GOOGLE_VISION_API_KEY:'test'},sample,{fetcher:async()=>Response.json({responses:[{fullTextAnnotation:{text:'unrelated'}}]})});
  assert.equal(r.screen,'needs_review');assert.equal(r.knownMatches,0);
});
test('real voice adapter checks duration and quality without second call',async()=>{
  let calls=0;const env={AI:{async run(){calls++;return {text:ref,transcription_info:{duration:8}};}}};
  assert.equal((await measureSample(env,{...sample,kind:'voice',contentType:'audio/wav'})).screen,'passed');assert.equal(calls,1);
  await assert.rejects(measureSample({AI:{async run(){return {text:ref};}}},{...sample,kind:'voice',contentType:'audio/wav'}));
});
test('main cleanup acceptance covers expiry leases revoke retry delayed write',async()=>{
  const r=await runCleanupAcceptance();assert.equal(r.state,'passed');assert.equal(r.checks.length,4);assert.equal(r.liveD1CronVerified,false);
});

test('isolated cron uses main cleanup on D1-shaped SQLite and confirms R2 absence',async()=>{
  const {createTestDb}=await import('./helpers/db.mjs');
  const {readFileSync}=await import('node:fs');
  const {spawnSync}=await import('node:child_process');
  const {sweep}=await import('../acceptance-media/cleanup-worker.mjs');
  const prepared=spawnSync(process.execPath,['scripts/prepare-main-cleanup.mjs'],{encoding:'utf8'});assert.equal(prepared.status,0);
  const f=createTestDb({migrations:[]}),objects=new Map();
  try{
    f.sql.exec(readFileSync('acceptance-media/private/main-cleanup.sql','utf8'));
    const env={DB:f.db,CLEANUP_ACCEPTANCE_ENABLED:'true',MEDIA_R2:{async put(k,v){objects.set(k,v);},async head(k){return objects.has(k)?{}:null;},async delete(k){objects.delete(k);}}};
    await sweep(env);assert.equal(f.sql.prepare('SELECT state FROM acceptance_cleanup_receipt').get().state,'passed');assert.equal(objects.size,0);
    await sweep(env);assert.equal(objects.size,0);
  }finally{f.close();}
});
