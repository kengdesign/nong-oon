import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaFixture,mediaEvent,fakeFetch,owner} from './helpers/media.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
import {ingestMediaEvents,cleanupMedia,MEDIA_LEASE_MS} from '../src/media-store.mjs';
import {processMediaJob} from '../src/media-pipeline.mjs';
import {saveMediaReview,confirmMediaReview,cancelMediaJob} from '../src/media-review.mjs';
test('packaging pipeline -> manual correction -> explicit confirm/replay or cancel -> payload cleanup',async()=>{
 for(const cancel of [false,true]){
  const f=await mediaFixture();try{
   await ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
   const job=f.sql.prepare('SELECT id,object_key FROM media_jobs').get();
   await processMediaJob(f.env,job.id,{clock:()=>f.now,fetcher:fakeFetch,infer:async()=>draftFromText('SAMPLEBRAND 20 mg','printed_label')});
   const row=f.sql.prepare('SELECT state,draft_json FROM media_jobs').get();assert.equal(row.state,'awaiting_review');
   const fields=JSON.parse(row.draft_json).items[0].fields;assert.equal(fields.label.value,'SAMPLEBRAND');assert.equal(fields.dose.value,null);
   const context={jobId:job.id,patientId:f.patientId,actorId:owner,providerId:f.env.MEDIA_PROVIDER_ID,now:f.now,itemIndex:0};
   const input={expectedReviewVersion:0,expectedScheduleVersion:1,sourceChecked:true,issuesResolved:true,useMode:'scheduled',strength:fields.strength.value,dose:'synthetic amount',schedule:{label:fields.label.value,instructions:'synthetic only',times:['08:00'],weekdays:[0,1,2,3,4,5,6],startDate:'2026-10-29',endDate:null}};
   const review=await saveMediaReview(f.db,{...context,input});assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);
   const confirm={confirmationId:crypto.randomUUID(),expectedReviewVersion:review.reviewVersion,expectedScheduleVersion:review.expectedScheduleVersion,acknowledge:true};
   if(cancel){await cancelMediaJob(f.db,context);await assert.rejects(confirmMediaReview(f.db,{...context,input:confirm}));}
   else{await confirmMediaReview(f.db,{...context,input:confirm});assert.equal((await confirmMediaReview(f.db,{...context,input:confirm})).replayed,true);}
   await cleanupMedia(f.env,f.now+MEDIA_LEASE_MS+1);assert.equal(f.objects.size,0);
   assert.equal(f.sql.prepare('SELECT draft_json FROM media_jobs').get().draft_json,null);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,cancel?0:1);
  }finally{f.close();}
 }
});
