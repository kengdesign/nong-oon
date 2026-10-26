import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createTestDb } from './helpers/db.mjs';
import { handleRequest } from '../src/webhook.mjs';
import { materializePatient } from '../src/scheduler.mjs';
import { processLineEvents } from '../src/line-events.mjs';
import { purgePrivateData,DAY } from '../src/privacy.mjs';
const A='U'+'1'.repeat(32),B='U'+'2'.repeat(32);
const now=Date.parse('2026-10-26T01:00:00Z');
const origin='https://staging.nongoon.com';
const sha=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
  const f=createTestDb(),session='a'.repeat(64),csrf='c'.repeat(64);
  f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(A,A,now);
  f.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sha(session),A,csrf,now-1,now+DAY*1000);
  return {...f,session,csrf,env:{DB:f.db,CARE_API_ENABLED:'true',APP_ORIGIN:origin,APP_ENV:'staging'}};
}
const req=(path,method='GET',body,extras={})=>new Request(origin+path,{method,headers:extras,body:body===undefined?undefined:JSON.stringify(body)});
function call(f,path,method='GET',body,extras={}){return handleRequest(req(path,method,body,{
  cookie:`__Host-nongoon=${f.session}`,origin,'content-type':'application/json','x-csrf-token':f.csrf,...extras}),f.env);}
const profile={displayName:'QA synthetic',consent:true,consentVersion:'2026-10-26'};
test('complete authenticated HTTP -> SQLite consent, schedule, report, history, export and withdraw',async()=>{
  const f=fixture();try{
    let r=await call(f,'/api/session');assert.equal(r.status,200);assert.equal((await r.json()).actorId,A);
    r=await call(f,'/api/patients','POST',profile);assert.equal(r.status,201);const p=(await r.json()).patient;
    const path=`/api/patients/${p.id}`;
    const schedule={label:'QA item',instructions:'Synthetic fixture only',times:['08:00'],weekdays:[0,1,2,3,4,5,6],startDate:'2026-10-26',endDate:null,active:true,expectedVersion:1};
    r=await call(f,path+'/schedules','POST',schedule);assert.equal(r.status,201);const saved=await r.json();
    await materializePatient(f.db,p.id,now);
    const dose=f.sql.prepare('SELECT * FROM dose_records WHERE due_at=?').get(now);assert.ok(dose);
    // Route owns clock; use a known valid session/row window for live Date.now.
    f.sql.prepare('UPDATE dose_records SET due_at=?,expires_at=? WHERE dose_id=?').run(Date.now()-1000,Date.now()+DAY,dose.dose_id);
    r=await call(f,path+`/doses/${dose.dose_id}/report`,'POST',{type:'report_taken',commandId:'qa_once',scheduleVersion:2});
    assert.equal(r.status,200);assert.equal((await r.json()).status,'reported_taken');
    r=await call(f,path+'/schedules','POST',{...schedule,expectedVersion:2,label:'QA second'});assert.equal(r.status,201);
    r=await call(f,path+'/doses');const history=await r.json();
    assert.ok(history.doses.some(d=>d.doseId===dose.dose_id&&d.status==='reported_taken'&&d.scheduleVersion!==history.currentVersion));
    r=await call(f,path+'/export');assert.equal(r.status,200);assert.equal((await r.json()).patient.id,p.id);
    r=await call(f,path+'/consent','DELETE');assert.equal(r.status,200);
    assert.equal((await call(f,path+'/doses')).status,404);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM care_grants WHERE revoked_at IS NULL').get().n,0);
  }finally{f.close();}
});
test('Worker denies forged identities, CSRF, cross-site mutations, disabled gate and overlarge streamed body',async()=>{
 const f=fixture();try{
  assert.equal((await handleRequest(req('/api/patients','GET',undefined,{'x-actor-id':A,'cf-access-authenticated-user-email':'fake@test.invalid'}),f.env)).status,401);
  assert.equal((await call(f,'/api/patients','POST',profile,{'x-csrf-token':''})).status,403);
  assert.equal((await call(f,'/api/patients','POST',profile,{origin:'https://attacker.invalid'})).status,403);
  assert.equal((await call(f,'/api/patients','POST',profile,{'content-type':'text/plain'})).status,415);
  assert.equal((await call(f,'/api/patients','POST',{...profile,displayName:'x'.repeat(17000)})).status,413);
  const disabled=await handleRequest(req('/api/patients'),{...f.env,CARE_API_ENABLED:'false'});assert.equal(disabled.status,503);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM patients').get().n,0);
  const r=await call(f,'/api/session');assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('x-frame-options'),'DENY');
 }finally{f.close();}
});
async function inbox(f,eventId,type,timestamp,user=A){
 f.sql.prepare(`INSERT INTO webhook_inbox(event_id,event_type,event_timestamp,user_id,received_at,expires_at)
   VALUES(?,?,?,?,?,?)`).run(eventId,type,timestamp,user,now,now+7*DAY);
 await processLineEvents(f.db,now);
}
test('signed LINE unfollow revokes session; newer follow resumes only active consent+membership, never manual revocation',async()=>{
 const f=fixture();try{
  const p=(await (await call(f,'/api/patients','POST',profile)).json()).patient.id;
  f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(B,B,now);
  await inbox(f,'block','unfollow',20);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  assert.ok(f.sql.prepare('SELECT blocked_at FROM accounts WHERE actor_id=?').get(A).blocked_at);
  await inbox(f,'oldfollow','follow',10);
  assert.ok(f.sql.prepare('SELECT blocked_at FROM accounts WHERE actor_id=?').get(A).blocked_at);
  await inbox(f,'newfollow','follow',30);
  assert.equal(f.sql.prepare('SELECT blocked_at FROM accounts WHERE actor_id=?').get(A).blocked_at,null);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM care_grants WHERE patient_id=? AND revoked_at IS NULL').get(p).n,3);
  f.sql.prepare('UPDATE care_members SET revoked_at=? WHERE actor_id=?').run(now,A);
  await inbox(f,'follow_again','follow',40);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM care_grants WHERE revoked_at IS NULL').get().n,0);
  await inbox(f,'prelogin_block','unfollow',50,B);
  assert.ok(f.sql.prepare('SELECT blocked_at FROM accounts WHERE actor_id=?').get(B).blocked_at);
  const C='U'+'3'.repeat(32);await inbox(f,'unknown_block','unfollow',60,C);
  assert.ok(f.sql.prepare('SELECT blocked_at FROM accounts WHERE actor_id=?').get(C).blocked_at);
 }finally{f.close();}
});
test('signed webhook processes lifecycle without retaining messages, and duplicate event remains idempotent',async()=>{
 const f=fixture();try{
  const body=JSON.stringify({events:[{webhookEventId:'qa_block',type:'unfollow',timestamp:now,source:{userId:A},replyToken:'NEVER_RETAIN',message:{text:'NEVER_RETAIN'}}]});
  const secret='qa-only-secret',signature=createHmac('sha256',secret).update(body).digest('base64');
  const send=()=>handleRequest(new Request(origin+'/webhook/line',{method:'POST',headers:{'x-line-signature':signature},body}),{...f.env,LINE_CHANNEL_SECRET:secret,INGESTION_ENABLED:'true'});
  assert.equal((await send()).status,200);assert.equal((await send()).status,200);
  const row=f.sql.prepare('SELECT * FROM webhook_inbox').get();assert.ok(row.processed_at);assert.ok(!JSON.stringify(row).includes('NEVER_RETAIN'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM webhook_inbox').get().n,1);
 }finally{f.close();}
});
test('privacy expiry uses bounded atomic SQL, preserves active records and purges withdrawn dependencies with foreign keys',async()=>{
 const f=fixture();try{
  const p=(await (await call(f,'/api/patients','POST',profile)).json()).patient.id;
  await call(f,`/api/patients/${p}/consent`,'DELETE');
  const revoked=f.sql.prepare('SELECT revoked_at FROM patients').get().revoked_at;
  await purgePrivateData(f.db,revoked+29*DAY);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM patients').get().n,1);
  await purgePrivateData(f.db,revoked+30*DAY);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM patients').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM care_members').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM care_audit').get().n,2);
  await purgePrivateData(f.db,revoked+91*DAY);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM care_audit').get().n,0);
  await assert.rejects(purgePrivateData(f.db,-1),/INVALID/);
 }finally{f.close();}
});
