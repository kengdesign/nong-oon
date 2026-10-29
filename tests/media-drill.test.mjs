import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createTestDb} from './helpers/db.mjs';import worker,{seed,consume} from '../platform-media/worker.mjs';
async function fixture(){const f=createTestDb();f.sql.exec(readFileSync('platform-media/schema.sql','utf8'));const objects=new Map(),messages=[];
return {...f,objects,messages,env:{DRILL_ENABLED:'true',DB:f.db,QUEUE:{send:async b=>messages.push(b)},R2:{put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?{text:async()=>new TextDecoder().decode(objects.get(k))}:null,delete:async k=>objects.delete(k),head:async k=>objects.has(k)?{}:null}}};}
test('isolated drill uses D1 job IDs and records confirmed automatic deletion, duplicates inert',async()=>{
const f=await fixture();await seed(f.env);assert.equal(f.messages.length,1);assert.equal(f.objects.size,1);let ack=0;
const batch={messages:[{body:f.messages[0],ack(){ack++;},retry(){throw Error('unexpected');}}]};
await consume(batch,f.env);await consume(batch,f.env);assert.equal(ack,2);assert.equal(f.objects.size,0);assert.equal(f.sql.prepare('SELECT state FROM drill_jobs').get().state,'deleted');
await seed(f.env);assert.equal(f.messages.length,1);assert.equal((await worker.fetch()).status,404);f.close();});
test('disabled drill and arbitrary IDs cannot write or delete',async()=>{const f=await fixture();await seed({...f.env,DRILL_ENABLED:'false'});assert.equal(f.messages.length,0);
await consume({messages:[{body:{jobId:'other'},ack(){},retry(){throw Error();}}]},f.env);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM drill_jobs').get().n,0);f.close();});
test('dispatches are bounded and delete failures retry without false receipts',async()=>{const f=await fixture();for(let i=0;i<15;i++)await seed(f.env);assert.equal(f.messages.length,10);let retries=0;
await consume({messages:[{body:f.messages[0],ack(){throw Error();},retry(){retries++;}}]},{...f.env,R2:{...f.env.R2,delete:async()=>{throw Error();}}});
assert.equal(retries,1);assert.equal(f.sql.prepare('SELECT state FROM drill_jobs').get().state,'queued');f.close();});
