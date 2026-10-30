import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaFixture,mediaEvent,extraction} from './helpers/media.mjs';
import {ingestMediaEvents,cleanupMedia} from '../src/media-store.mjs';
import {MEDIA_TTL_MS} from '../src/media-policy.mjs';

test('24-hour media boundary erases payload and R2 object but retains metadata manifest',async()=>{
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
  const after=f.sql.prepare('SELECT * FROM media_jobs').get();
  assert.equal(after.state,'expired');assert.equal(after.draft_json,null);assert.equal(after.message_id,null);
  await cleanupMedia(f.env,job.expires_at+365*MEDIA_TTL_MS);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,1);
 }finally{f.close();}
});
