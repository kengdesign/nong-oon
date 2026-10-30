import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaFixture,mediaEvent,extraction} from './helpers/media.mjs';
import {ingestMediaEvents,cleanupMedia} from '../src/media-store.mjs';
import {MEDIA_TTL_MS} from '../src/media-policy.mjs';

test('24-hour media boundary erases payload and R2 object and removes completed metadata manifest',async()=>{
 const f=await mediaFixture();try{
  await ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
  const job=f.sql.prepare('SELECT * FROM media_jobs').get();
  assert.equal(job.expires_at,f.now+MEDIA_TTL_MS);
  f.sql.prepare("UPDATE media_jobs SET state='awaiting_review',draft_json=?,content_type='image/png' WHERE id=?").run(extraction(),job.id);
  f.objects.set(job.object_key,{bytes:new Uint8Array([1])});
  await cleanupMedia(f.env,job.expires_at-1);
  assert.equal(f.objects.has(job.object_key),true);
  assert.notEqual(f.sql.prepare('SELECT draft_json FROM media_jobs').get().draft_json,null);
  await cleanupMedia(f.env,job.expires_at);
  assert.equal(f.objects.has(job.object_key),false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,0);
  await cleanupMedia(f.env,job.expires_at+365*MEDIA_TTL_MS);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,0);
 }finally{f.close();}
});

test('R2 absence must be verified before expired metadata is removed',async()=>{
 const f=await mediaFixture();try{
  await ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
  const job=f.sql.prepare('SELECT * FROM media_jobs').get();
  await assert.rejects(cleanupMedia({...f.env,MEDIA_R2:{async delete(){},async head(){return {size:1};}}},job.expires_at),e=>e.code==='MEDIA_CLEANUP_INCOMPLETE');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,1);
  await cleanupMedia(f.env,job.expires_at+1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,0);
 }finally{f.close();}
});
