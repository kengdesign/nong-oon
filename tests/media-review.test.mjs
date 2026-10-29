import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mediaFixture,mediaEvent,unsendEvent,owner,other,extraction} from './helpers/media.mjs';
import {ingestMediaEvents,cleanupMedia,MEDIA_LEASE_MS} from '../src/media-store.mjs';
import {saveMediaReview,confirmMediaReview,readMediaJob,cancelMediaJob} from '../src/media-review.mjs';
import {handleRequest} from '../src/webhook.mjs';
const origin='https://staging.nongoon.com';
const input=()=>({expectedReviewVersion:0,expectedScheduleVersion:1,sourceChecked:true,issuesResolved:true,useMode:'scheduled',
  strength:'ตามฉลากสังเคราะห์',dose:'จำนวนสังเคราะห์',schedule:{label:'รายการทดสอบ',instructions:'ข้อมูลทดสอบเท่านั้น',times:['18:00','08:00'],
    weekdays:[0,1,2,3,4,5,6],startDate:'2026-10-28',endDate:null}});
async function ready(){const f=await mediaFixture();await ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
  const id=f.sql.prepare('SELECT id FROM media_jobs').get().id;
  f.sql.prepare("UPDATE media_jobs SET state='awaiting_review',draft_json=?,content_type='image/png' WHERE id=?").run(extraction(),id);
  return {...f,context:{jobId:id,patientId:f.patientId,actorId:owner,providerId:f.env.MEDIA_PROVIDER_ID,now:f.now,itemIndex:0}};}
const confirmation=(r)=>({confirmationId:crypto.randomUUID(),expectedReviewVersion:r.reviewVersion,expectedScheduleVersion:r.expectedScheduleVersion,acknowledge:true});

test('owner cancellation blocks confirmation, clears reviews and remains idempotent without enabling schedules',async()=>{
  const f=await ready();try{
    const review=await saveMediaReview(f.db,{...f.context,input:input()});
    await assert.rejects(cancelMediaJob(f.db,{...f.context,actorId:other}));
    assert.equal((await cancelMediaJob(f.db,f.context)).cleanupPending,true);
    assert.equal((await cancelMediaJob(f.db,f.context)).cancelled,true);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_reviews').get().n,0);
    assert.equal(f.sql.prepare('SELECT draft_json FROM media_jobs').get().draft_json,null);
    await assert.rejects(confirmMediaReview(f.db,{...f.context,input:confirmation(review)}));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);
  }finally{f.close();}
});
test('cancellation preserves in-flight lease and catches late objects after lease expiry',async()=>{
  const f=await ready();try{
    const key=f.sql.prepare('SELECT object_key FROM media_jobs').get().object_key;
    f.sql.prepare("UPDATE media_jobs SET state='processing',lease_until=?").run(f.now+MEDIA_LEASE_MS);
    await cancelMediaJob(f.db,f.context);
    f.objects.set(key,{bytes:new Uint8Array([1])});
    await cleanupMedia(f.env,f.now+1);assert.equal(f.objects.size,1);
    await cleanupMedia(f.env,f.now+MEDIA_LEASE_MS+1);assert.equal(f.objects.size,0);
  }finally{f.close();}
});
test('cancellation cannot remove a confirmed schedule or its replay receipt',async()=>{
  const f=await ready();try{
    const review=await saveMediaReview(f.db,{...f.context,input:input()}),c=confirmation(review);
    await confirmMediaReview(f.db,{...f.context,input:c});
    await assert.rejects(cancelMediaJob(f.db,f.context));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,1);
    assert.equal((await confirmMediaReview(f.db,{...f.context,input:c})).replayed,true);
  }finally{f.close();}
});

test('review alone never creates a schedule; explicit confirm atomically writes schedule, audit and replay receipt',async()=>{
  const f=await ready();try{
    const r=await saveMediaReview(f.db,{...f.context,input:input()});assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);
    const c=confirmation(r);const saved=await confirmMediaReview(f.db,{...f.context,input:c});
    assert.equal(saved.replayed,false);const row=f.sql.prepare('SELECT * FROM medication_schedules').get();
    assert.equal(row.active,1);assert.deepEqual(JSON.parse(row.times_json),['08:00','18:00']);assert.match(row.instructions,/จำนวนต่อครั้ง/);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM care_audit WHERE action='media_schedule_confirmed'").get().n,1);
    assert.equal(f.sql.prepare('SELECT state FROM media_jobs').get().state,'confirmed');
    assert.equal(f.sql.prepare('SELECT draft_json FROM media_jobs').get().draft_json,null);
    const replay=await confirmMediaReview(f.db,{...f.context,input:c});assert.equal(replay.replayed,true);assert.equal(replay.scheduleId,row.id);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,1);
    await assert.rejects(confirmMediaReview(f.db,{...f.context,input:{...c,expectedReviewVersion:2}}));
  }finally{f.close();}
});
test('edits, expiration, invalid calendars, PRN and cross-account review require correction',async()=>{
  const f=await ready();try{
    for(const patch of [{sourceChecked:false},{issuesResolved:false},{useMode:'as_needed'},{actorId:other},
      {strength:''},{dose:''},{schedule:{...input().schedule,startDate:'2026-02-30'}},{schedule:{...input().schedule,times:[]}}])
      await assert.rejects(saveMediaReview(f.db,{...f.context,input:{...input(),...patch}}));
    await assert.rejects(saveMediaReview(f.db,{...f.context,actorId:other,input:input()}));
    const r=await saveMediaReview(f.db,{...f.context,input:input()});
    await assert.rejects(saveMediaReview(f.db,{...f.context,input:input()}));
    const revised=await saveMediaReview(f.db,{...f.context,input:{...input(),expectedReviewVersion:1}});
    await assert.rejects(confirmMediaReview(f.db,{...f.context,input:confirmation(r)}));
    await assert.rejects(confirmMediaReview(f.db,{...f.context,now:revised.expiresAt,input:confirmation(revised)}));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);
  }finally{f.close();}
});
test('a permission/unsend/review-version/schedule/cancellation change immediately before atomic write prevents confirmation',async()=>{
  for(const mode of ['withdraw','unsend','review','schedule','cancel']){
    const f=await ready();try{
      const r=await saveMediaReview(f.db,{...f.context,input:input()});const original=f.db.batch;
      f.db.batch=async statements=>{
        f.db.batch=original;
        if(mode==='withdraw')f.sql.prepare('UPDATE patients SET revoked_at=? WHERE id=?').run(f.now,f.patientId);
        if(mode==='unsend')await ingestMediaEvents(f.db,[unsendEvent()],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
        if(mode==='review')f.sql.prepare('UPDATE media_reviews SET version=version+1').run();
        if(mode==='schedule')f.sql.prepare('UPDATE care_schedules SET current_version=current_version+1').run();
        if(mode==='cancel')await cancelMediaJob(f.db,f.context);
        return original(statements);
      };
      await assert.rejects(confirmMediaReview(f.db,{...f.context,input:confirmation(r)}));
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_receipts').get().n,0);
    }finally{f.close();}
  }
});
test('audit failure rolls back confirmation including schedule/version/receipt and allows a clean retry',async()=>{
  const f=await ready();try{
    const r=await saveMediaReview(f.db,{...f.context,input:input()}),c=confirmation(r);
    f.sql.exec("CREATE TRIGGER fail_media_audit BEFORE INSERT ON care_audit WHEN NEW.action='media_schedule_confirmed' BEGIN SELECT RAISE(ABORT,'fixture'); END;");
    await assert.rejects(confirmMediaReview(f.db,{...f.context,input:c}));
    assert.equal(f.sql.prepare('SELECT current_version FROM care_schedules').get().current_version,1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);
    f.sql.exec('DROP TRIGGER fail_media_audit');assert.equal((await confirmMediaReview(f.db,{...f.context,input:c})).replayed,false);
  }finally{f.close();}
});
test('multi-item documents confirm separately; stale bases and duplicate schedules cannot silently add more rows',async()=>{
  const f=await ready();try{
    const d=JSON.parse(extraction());d.items.push(structuredClone(d.items[0]));
    f.sql.prepare('UPDATE media_jobs SET draft_json=?').run(JSON.stringify(d));
    const first=await saveMediaReview(f.db,{...f.context,input:input()});
    const second=await saveMediaReview(f.db,{...f.context,itemIndex:1,input:input()});
    await confirmMediaReview(f.db,{...f.context,input:confirmation(first)});
    assert.equal(f.sql.prepare('SELECT state FROM media_jobs').get().state,'awaiting_review');
    await assert.rejects(confirmMediaReview(f.db,{...f.context,itemIndex:1,input:confirmation(second)}));
    const revised=await saveMediaReview(f.db,{...f.context,itemIndex:1,input:{...input(),expectedReviewVersion:1,expectedScheduleVersion:2}});
    await assert.rejects(confirmMediaReview(f.db,{...f.context,itemIndex:1,input:confirmation(revised)}));
    const different=await saveMediaReview(f.db,{...f.context,itemIndex:1,input:{...input(),expectedReviewVersion:2,expectedScheduleVersion:2,
      schedule:{...input().schedule,label:'รายการทดสอบที่สอง'}}});
    await confirmMediaReview(f.db,{...f.context,itemIndex:1,input:confirmation(different)});
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,2);
    assert.equal(f.sql.prepare('SELECT state FROM media_jobs').get().state,'confirmed');
  }finally{f.close();}
});
test('actual Worker routes enforce session/CSRF/body limits, default-off switch and private source authorization',async()=>{
  const f=await ready();try{
    const session='a'.repeat(64),csrf='c'.repeat(64),hash=createHash('sha256').update(session).digest('hex');
    f.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(hash,owner,csrf,f.now-1,f.now+86400000);
    const env={...f.env,CARE_API_ENABLED:'true',APP_ORIGIN:origin};
    const call=(suffix,method='GET',data,extra={})=>handleRequest(new Request(origin+`/api/media/patients/${f.patientId}/`+suffix,{method,
      headers:{cookie:`__Host-nongoon=${session}`,origin,'x-csrf-token':csrf,'content-type':'application/json',...extra},
      body:data===undefined?undefined:JSON.stringify(data)}),env);
    const path=`jobs/${f.context.jobId}`;
    assert.equal((await call(path)).status,200);
    assert.equal((await call(path+'/reviews/0','PUT',input(),{'x-csrf-token':''})).status,403);
    assert.equal((await call(path,'DELETE',undefined,{'x-csrf-token':''})).status,403);
    assert.equal((await call(path+'/reviews/0','PUT',input(),{origin:'https://attacker.invalid'})).status,403);
    assert.equal((await call(path+'/reviews/0','PUT',{junk:'x'.repeat(17000)})).status,413);
    assert.equal((await call(path,'GET',undefined,{cookie:''})).status,401);
    env.MEDIA_API_ENABLED='false';assert.equal((await call(path)).status,503);env.MEDIA_API_ENABLED='true';
    const response=await call(path);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.doesNotMatch(await response.text(),/fixture-token|message_id|object_key|lease_token/);
    const r=await call(path+'/reviews/0','PUT',input());assert.equal(r.status,200);
    const saved=await r.json();assert.equal((await call(path+'/reviews/0/confirm','POST',confirmation(saved))).status,200);
    assert.equal((await call(path+'/source')).status,404);
  }finally{f.close();}
});
