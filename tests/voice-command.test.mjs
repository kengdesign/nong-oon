import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyVoiceIntent} from '../src/voice-intent.mjs';
import {createMediaInfer} from '../src/media-providers.mjs';
import {parseDraft} from '../src/draft-contract.mjs';
import {emergencyCallPlan} from '../src/emergency.mjs';
test('voice negations, questions and unknown instructions cannot silently acknowledge doses',()=>{
 assert.equal(classifyVoiceIntent('ทานยาแล้ว').requiresConfirmation,true);
 assert.equal(classifyVoiceIntent('ทานยาไปแล้วหรือยัง?').intent,'read_status');
 for(const text of ['ยังไม่ทานยาแล้ว','อย่าบันทึกทานยาแล้ว','เพิ่มยา 2 เม็ด',null])assert.equal(classifyVoiceIntent(text).intent,'unknown');
});
test('Thai Whisper command persists only bounded enum behind opt-in; old adapter unchanged',async()=>{
 const env={MEDIA_PROVIDER_ENABLED:'true',MEDIA_PROVIDER_ID:'workers-ai-whisper-v1',AI:{run:async()=>({text:'ทานยาแล้ว',transcription_info:{duration:2}})}};
 const input={bytes:new Uint8Array(12),contentType:'audio/mp4',sourceKind:'voice',providerId:env.MEDIA_PROVIDER_ID};
 const ordinary=parseDraft(await createMediaInfer(env)(input));assert.equal(ordinary.ok,true);assert.equal(ordinary.draft.voiceIntent,undefined);
 const command=parseDraft(await createMediaInfer({...env,VOICE_COMMAND_ENABLED:'true'})(input));assert.equal(command.ok,true);assert.equal(command.draft.voiceIntent,'propose_taken');assert.equal(command.draft.sourceText,undefined);
 assert.equal(parseDraft(JSON.stringify({...command.draft,voiceIntent:'report_taken'})).ok,false);
});
test('telephone fallback keeps priority and never emits LINE IDs or automatic calls',()=>{
 const plan=emergencyCallPlan([{name:'Example',phone:'081-234-5678'}]);assert.equal(plan[0].href,'tel:0812345678');assert.equal(plan[0].priority,1);
 assert.throws(()=>emergencyCallPlan([{name:'bad',phone:'0812345678;ext=1'}]));
});

import {mediaFixture,mediaEvent,owner,other} from './helpers/media.mjs';
import {grantMediaConsent,ingestMediaEvents} from '../src/media-store.mjs';
import {processMediaJob} from '../src/media-pipeline.mjs';
import {handleCareApi} from '../src/care-api.mjs';
test('signed audio job flows through Whisper to owner-only intent and disappears after consent revocation',async()=>{
 const f=await mediaFixture();try{
  const env={...f.env,VOICE_COMMAND_ENABLED:'true',MEDIA_PROVIDER_ENABLED:'true',MEDIA_PROVIDER_ID:'workers-ai-whisper-v1',AI:{run:async()=>({text:'ทานยาแล้ว',transcription_info:{duration:2}})}};
  await grantMediaConsent(f.db,{patientId:f.patientId,actorId:owner,providerId:env.MEDIA_PROVIDER_ID,now:f.now});
  f.sql.prepare('INSERT INTO voice_command_consents VALUES(?,?,?,?)').run(f.patientId,owner,f.now-1,f.now+86400000);
  const event=mediaEvent(f.now,'456');event.message.type='audio';event.message.duration=2000;
  await ingestMediaEvents(f.db,[event],{now:f.now,providerId:env.MEDIA_PROVIDER_ID});
  const job=f.sql.prepare('SELECT id FROM media_jobs').get();assert.ok(job);
  const bytes=new Uint8Array([0,0,0,12,102,116,121,112,0,0,0,0]);
  const result=await processMediaJob(env,job.id,{clock:()=>f.now+10,fetcher:async()=>new Response(bytes,{headers:{'content-type':'audio/mp4'}})});
  assert.equal(result.outcome,'awaiting_review');
  const url=`https://example.test/api/patients/${f.patientId}/voice/latest`;
  const read=actorId=>handleCareApi(new Request(url),env,{actorId,now:f.now+20});
  assert.equal((await (await read(owner)).json()).intent,'propose_taken');
  assert.equal((await read(other)).status,404);
  f.sql.prepare('UPDATE media_consents SET revoked_at=?').run(f.now+15);
  assert.equal((await (await read(owner)).json()).intent,'unknown');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dose_records').get().n,0);
 }finally{f.close();}
});
test('explicit Thai commands accept polite suffixes but refuse questions, negation and mixed instructions',()=>{
 for(const value of ['กินยาแล้วครับ','รับประทานยาไปแล้วค่ะ','ทานยาแล้ว.'])assert.equal(classifyVoiceIntent(value).intent,'propose_taken');
 for(const value of ['รับประทานยาแล้วหรือยังครับ?','กินยาไปแล้วรึยัง'])assert.equal(classifyVoiceIntent(value).intent,'read_status');
 for(const value of ['ยังไม่ได้กินยา','ไม่ได้ทานยาแล้วค่ะ','กินยาแล้วหรือเปล่า','กินยาแล้ว และเพิ่มยา','ทานยาแล้วใช่ไหม'])assert.equal(classifyVoiceIntent(value).intent,'unknown');
});
