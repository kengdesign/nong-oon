import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaFixture,mediaEvent,unsendEvent,owner,other,fakeFetch,extraction,png} from './helpers/media.mjs';
import {ingestMediaEvents,dispatchMediaJobs,claimMediaJob,cleanupMedia,grantMediaConsent,MEDIA_LEASE_MS} from '../src/media-store.mjs';
import {processMediaJob,readLineMedia,recoverMedia,handleMediaQueue} from '../src/media-pipeline.mjs';
const ingest=f=>ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});

test('one failed erase does not block other objects and errors stay redacted',async()=>{
  const f=await mediaFixture();try{
    await ingestMediaEvents(f.db,[mediaEvent(f.now,'123'),mediaEvent(f.now,'124')],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
    const rows=f.sql.prepare('SELECT * FROM media_jobs ORDER BY id').all();
    assert.equal(rows.length,2);
    for(const row of rows)f.objects.set(row.object_key,{bytes:png()});
    f.sql.exec("UPDATE media_jobs SET state='cancelled'");
    const env={...f.env,MEDIA_R2:{async delete(key){if(key===rows[0].object_key)throw Error('private provider failure');f.objects.delete(key);}}};
    await assert.rejects(cleanupMedia(env,f.now),e=>e.code==='MEDIA_CLEANUP_INCOMPLETE'&&e.status===503&&!e.message.includes('private'));
    assert.equal(f.objects.size,1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,2);
    await cleanupMedia(f.env,f.now+1);assert.equal(f.objects.size,0);
  }finally{f.close();}
});

test('durable intake deduplicates events and recovery sends queue IDs only after committed SQL',async()=>{
  const f=await mediaFixture();try{
    await ingest(f);await ingest(f);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,1);
    assert.equal(f.sql.prepare('SELECT jobs FROM media_budget').get().jobs,1);
    const id=f.sql.prepare('SELECT id FROM media_jobs').get().id;
    const broken={...f.env,MEDIA_QUEUE:{async send(){throw Error('network');}}};
    await assert.rejects(dispatchMediaJobs(broken,f.now));assert.equal(f.sql.prepare('SELECT state FROM media_jobs').get().state,'queued');
    await dispatchMediaJobs(f.env,f.now);assert.deepEqual(f.messages,[{jobId:id}]);
    await dispatchMediaJobs(f.env,f.now);assert.equal(f.messages.length,1);
    let calls=0;const opts={clock:()=>f.now,fetcher:fakeFetch,infer:async()=>{calls++;return extraction();}};
    await Promise.all([processMediaJob(f.env,id,opts),processMediaJob(f.env,id,opts)]);
    assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT state FROM media_jobs').get().state,'awaiting_review');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);
    assert.equal(f.objects.size,1);
  }finally{f.close();}
});
test('unsend before original and mid-inference revoke data use; media consent renewal cannot revive the source',async()=>{
  for(const mode of ['before','during','renew']){
    const f=await mediaFixture();try{
      if(mode==='before'){
        await ingestMediaEvents(f.db,[mediaEvent(f.now),unsendEvent()],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
        assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,0);continue;
      }
      await ingest(f);const id=f.sql.prepare('SELECT id FROM media_jobs').get().id;
      if(mode==='renew'){
        await grantMediaConsent(f.db,{patientId:f.patientId,actorId:owner,providerId:f.env.MEDIA_PROVIDER_ID,now:f.now+1});
        await ingest(f);assert.equal(f.sql.prepare('SELECT state FROM media_jobs').get().state,'cancelled');continue;
      }
      const r=await processMediaJob(f.env,id,{clock:()=>f.now+1,fetcher:fakeFetch,infer:async()=>{
        await ingestMediaEvents(f.db,[unsendEvent()],{now:f.now+1,providerId:f.env.MEDIA_PROVIDER_ID});return extraction();}});
      assert.equal(r.outcome,'revoked');assert.equal(f.sql.prepare('SELECT draft_json FROM media_jobs').get().draft_json,null);
      await cleanupMedia(f.env,f.now+MEDIA_LEASE_MS+2);assert.equal(f.objects.size,0);
    }finally{f.close();}
  }
});
test('blocked/withdrawn owners cannot claim jobs; expired leases recover and attempts are bounded',async()=>{
  for(const change of ['block','withdraw','lease']){
    const f=await mediaFixture();try{
      await ingest(f);const id=f.sql.prepare('SELECT id FROM media_jobs').get().id;
      if(change==='block')f.sql.prepare('UPDATE accounts SET blocked_at=? WHERE actor_id=?').run(f.now,owner);
      if(change==='withdraw')f.sql.prepare('UPDATE patients SET revoked_at=? WHERE id=?').run(f.now,f.patientId);
      if(change!=='lease'){assert.equal(await claimMediaJob(f.db,id,f.now,f.env.MEDIA_PROVIDER_ID),null);continue;}
      const one=await claimMediaJob(f.db,id,f.now,f.env.MEDIA_PROVIDER_ID);assert.ok(one);
      assert.equal(await claimMediaJob(f.db,id,f.now+1,f.env.MEDIA_PROVIDER_ID),null);
      assert.ok(await claimMediaJob(f.db,id,f.now+MEDIA_LEASE_MS,f.env.MEDIA_PROVIDER_ID));
      assert.ok(await claimMediaJob(f.db,id,f.now+MEDIA_LEASE_MS*2,f.env.MEDIA_PROVIDER_ID));
      assert.equal(await claimMediaJob(f.db,id,f.now+MEDIA_LEASE_MS*3,f.env.MEDIA_PROVIDER_ID),null);
      await recoverMedia(f.env,f.now+MEDIA_LEASE_MS*3);assert.equal(f.sql.prepare('SELECT state FROM media_jobs').get().state,'failed');
    }finally{f.close();}
  }
});
test('intake enforces daily quota transactionally and validates whole batches before writes',async()=>{
  const f=await mediaFixture();try{
    await assert.rejects(ingestMediaEvents(f.db,[mediaEvent(f.now),{...mediaEvent(f.now,'bad-id')}],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID}));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,0);
    await assert.rejects(ingestMediaEvents(f.db,Array.from({length:6},(_,i)=>mediaEvent(f.now,String(i+1))),{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID}));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_budget').get().n,0);
    await ingest(f);const wrong={...mediaEvent(f.now,'999'),source:{type:'user',userId:other}};
    await ingestMediaEvents(f.db,[wrong],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,1);
  }finally{f.close();}
});
test('content download uses fixed LINE host, rejects redirects, MIME spoof and streamed oversize',async()=>{
  let options,url;
  const good=await readLineMedia('123','printed_label','token',{fetcher:async(u,o)=>{url=u;options=o;return fakeFetch();}});
  assert.equal(good.type,'image/png');assert.equal(url,'https://api-data.line.me/v2/bot/message/123/content');assert.equal(options.redirect,'manual');
  for(const response of [new Response(null,{status:302,headers:{location:'https://attacker.test'}}),
    new Response('<script>bad</script>',{headers:{'content-type':'image/png'}}),
    new Response(new Uint8Array(5*1024*1024+1),{headers:{'content-type':'image/png','content-length':'1'}}),
    new Response(png(),{headers:{'content-type':'text/html'}})])
    await assert.rejects(readLineMedia('123','printed_label','token',{fetcher:async()=>response}));
  await assert.rejects(readLineMedia('../secret','printed_label','token',{fetcher:()=>{throw Error('should not call');}}));
});
test('202 downloads retry, provider errors are redacted and disabled/unconfigured consumers never call AI',async()=>{
  const f=await mediaFixture();try{
    await ingest(f);const id=f.sql.prepare('SELECT id FROM media_jobs').get().id;
    const r=await processMediaJob(f.env,id,{clock:()=>f.now,fetcher:async()=>new Response(null,{status:202}),infer:async()=>extraction()});
    assert.equal(r.outcome,'retry');assert.equal(f.sql.prepare('SELECT attempts FROM media_jobs').get().attempts,1);
    const bad=await processMediaJob(f.env,id,{clock:()=>f.now+60_000,fetcher:fakeFetch,infer:async()=>{throw Error('private-key and health data');}});
    assert.equal(bad.outcome,'failed');assert.doesNotMatch(JSON.stringify(bad),/private-key|health/);
    assert.equal((await processMediaJob({...f.env,MEDIA_PROCESSING_ENABLED:'false'},id)).outcome,'disabled');
    assert.equal((await processMediaJob(f.env,id)).outcome,'provider_not_ready');
    let retried=0;await handleMediaQueue({messages:[{body:{jobId:id},ack(){throw Error('must not ack');},retry(){retried++;}}]},f.env);
    assert.equal(retried,1);
  }finally{f.close();}
});
test('cleanup retries object deletion after partial failure and catches a delayed object write',async()=>{
  const f=await mediaFixture();try{
    await ingest(f);const job=f.sql.prepare('SELECT * FROM media_jobs').get();
    f.objects.set(job.object_key,{bytes:png()});f.sql.prepare("UPDATE media_jobs SET state='cancelled' WHERE id=?").run(job.id);
    await assert.rejects(cleanupMedia({...f.env,MEDIA_R2:{async delete(){throw Error('R2 down');}}},f.now));
    await cleanupMedia(f.env,f.now+1);assert.equal(f.objects.size,0);
    f.objects.set(job.object_key,{bytes:png()});await cleanupMedia(f.env,f.now+2);assert.equal(f.objects.size,0);
  }finally{f.close();}
});
