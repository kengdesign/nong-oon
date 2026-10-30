import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaFixture,mediaEvent,png} from './helpers/media.mjs';
import {ingestMediaEvents,cleanupMedia} from '../src/media-store.mjs';
test('interrupted writer keeps reconciliation manifest and sweeps a late object after deletion failure',async()=>{
 const f=await mediaFixture();try{
  await ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
  const job=f.sql.prepare('SELECT * FROM media_jobs').get();
  f.sql.prepare("UPDATE media_jobs SET state='cancelled',lease_until=? WHERE id=?").run(job.expires_at-1,job.id);
  f.objects.set(job.object_key,{bytes:png()});
  let fail=true;
  const env={...f.env,MEDIA_R2:{...f.env.MEDIA_R2,async delete(key){if(fail)throw Error('synthetic storage failure');return f.env.MEDIA_R2.delete(key);}}};
  await assert.rejects(cleanupMedia(env,job.expires_at),e=>e.code==='MEDIA_CLEANUP_INCOMPLETE');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,1);
  fail=false;await cleanupMedia(env,job.expires_at+1);assert.equal(f.objects.size,0);
  // A crashed invocation cannot prove all writes settled: retain its reconciliation key.
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,1);
  f.objects.set(job.object_key,{bytes:png()});
  await cleanupMedia(env,job.expires_at+2);assert.equal(f.objects.size,0);
 }finally{f.close();}
});
