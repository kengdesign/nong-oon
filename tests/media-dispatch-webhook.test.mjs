import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mediaFixture,mediaEvent} from './helpers/media.mjs';
import {handleRequest} from '../src/webhook.mjs';
test('durable media webhook dispatches without waiting for cron; duplicate events cannot duplicate inference',async()=>{
 const f=await mediaFixture();try{
  const secret='synthetic-only',env={...f.env,INGESTION_ENABLED:'true',LINE_CHANNEL_SECRET:secret},pending=[];
  const body=JSON.stringify({events:[mediaEvent(f.now)]});
  const send=()=>handleRequest(new Request('https://example.test/webhook/line',{method:'POST',headers:{'x-line-signature':createHmac('sha256',secret).update(body).digest('base64')},body}),env,{waitUntil(p){pending.push(p);}});
  assert.equal((await send()).status,200);await Promise.all(pending);assert.equal(f.messages.length,1);
  assert.equal(f.sql.prepare('SELECT attempts FROM media_jobs').get().attempts,0);
  assert.equal((await send()).status,200);await Promise.all(pending);assert.equal(f.messages.length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM media_jobs').get().n,1);
 }finally{f.close();}
});
