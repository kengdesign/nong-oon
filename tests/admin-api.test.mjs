import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestDb } from './helpers/db.mjs';
import { handleAdminApi, ADMIN_INVITE_TTL } from '../src/admin-api.mjs';
import { handleRequest } from '../src/webhook.mjs';
import { handleCareApi } from '../src/care-api.mjs';

const owner=`U${'1'.repeat(32)}`, partner=`U${'2'.repeat(32)}`, other=`U${'3'.repeat(32)}`;
const origin='https://staging.nongoon.com', now=1800000000000;
const sha=value=>createHash('sha256').update(value).digest('hex');
function setup() {
  const f=createTestDb();
  for(const id of [owner,partner,other]) f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(id,id,now);
  f.env={DB:f.db,SERVICE_ADMIN_ENABLED:'true',SERVICE_OWNER_ACTOR_ID:owner,CARE_API_ENABLED:'true',APP_ORIGIN:origin};
  return f;
}
async function call(f,path,method='GET',body,actorId=owner,at=now,override={}) {
  const response=await handleAdminApi(new Request(`${origin}/api/admin${path}`,{method,
    ...(body===undefined?{}:{body:JSON.stringify(body)})}),{...f.env,...override},{actorId,now:at});
  return {status:response.status,data:await response.json()};
}
async function invite(f,targetActorId=partner) {
  const result=await call(f,'/invites','POST',{targetActorId});assert.equal(result.status,201,JSON.stringify(result));return result.data.code;
}
test('service owner is configured explicitly; no first-login bootstrap or client role promotion',async()=>{
  const f=setup();try {
    assert.equal((await call(f,'/session')).data.role,'owner');
    assert.equal((await call(f,'/session','GET',undefined,partner)).data.role,'none');
    assert.equal((await call(f,'/session','GET',undefined,owner,now,{SERVICE_ADMIN_ENABLED:'false'})).status,503);
    assert.equal((await call(f,'/session','GET',undefined,owner,now,{SERVICE_OWNER_ACTOR_ID:''})).status,503);
    assert.equal((await call(f,'/invites','POST',{targetActorId:partner,role:'owner'})).status,400);
    assert.equal((await call(f,'/session','GET',undefined,'fake')).status,401);
  }finally{f.close();}
});
test('invitation is hashed, bound to chosen LINE actor, single-use and audits grant atomically',async()=>{
  const f=setup();try {
    const code=await invite(f);
    const stored=f.sql.prepare('SELECT * FROM service_admin_invites').get();
    assert.equal(stored.code_hash,sha(code));assert.equal(stored.expires_at,now+ADMIN_INVITE_TTL);
    assert.equal(JSON.stringify(stored).includes(code),false);
    assert.equal((await call(f,'/invites/accept','POST',{code},other)).status,409);
    const results=await Promise.all([call(f,'/invites/accept','POST',{code},partner),call(f,'/invites/accept','POST',{code},partner)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await call(f,'/session','GET',undefined,partner)).data.role,'admin');
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM service_admin_audit WHERE action='admin_granted'").get().n,1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM care_members').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM care_grants').get().n,0);
  }finally{f.close();}
});
test('partner gets operational status without patient data, membership management or settings mutations',async()=>{
  const f=setup();try {
    const code=await invite(f);await call(f,'/invites/accept','POST',{code},partner);
    f.sql.prepare("INSERT INTO operation_health VALUES('retention',?,0)").run(now);
    f.sql.prepare(`INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id)
      VALUES('private',?,'Private medicine owner','v1',?,?,'test')`).run(owner,now,now);
    f.sql.exec("INSERT INTO care_schedules(patient_id,current_version) VALUES('private',1)");
    const status=await call(f,'/status','GET',undefined,partner);
    assert.equal(status.status,200);assert.equal(status.data.operations[0].task,'retention');
    assert.equal(JSON.stringify(status.data).includes('Private medicine'),false);
    for(const path of ['/members','/audit']) assert.equal((await call(f,path,'GET',undefined,partner)).status,403);
    assert.equal((await call(f,'/invites','POST',{targetActorId:other},partner)).status,403);
    assert.equal((await call(f,`/members/${owner}`,'DELETE',undefined,partner)).status,403);
    assert.equal((await call(f,'/settings','POST',{deliveryEnabled:true},partner)).status,403);
    const care=await handleCareApi(new Request(`${origin}/api/patients/private`),{DB:f.db},{actorId:partner,now});
    assert.equal(care.status,404);
  }finally{f.close();}
});
test('owner revokes partner immediately; already accepted token cannot restore access',async()=>{
  const f=setup();try {
    const code=await invite(f);await call(f,'/invites/accept','POST',{code},partner);
    assert.equal((await call(f,`/members/${partner}`,'DELETE',undefined,owner,now+1)).status,200);
    assert.equal((await call(f,'/status','GET',undefined,partner)).status,403);
    assert.equal((await call(f,'/invites/accept','POST',{code},partner)).status,409);
    assert.equal((await call(f,`/members/${owner}`,'DELETE')).status,403);
    const fresh=await invite(f);assert.equal((await call(f,'/invites/accept','POST',{code:fresh},partner)).status,200);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM service_admin_audit WHERE action='admin_revoked'").get().n,1);
  }finally{f.close();}
});
test('expired, revoked, blocked-target and blocked-owner invitations cannot grant access',async()=>{
  const f=setup();try {
    let code=await invite(f);
    assert.equal((await call(f,'/invites/accept','POST',{code},partner,now+ADMIN_INVITE_TTL)).status,409);
    assert.equal((await call(f,`/invites/${sha(code)}`,'DELETE')).status,200);
    assert.equal((await call(f,'/invites/accept','POST',{code},partner)).status,409);
    code=await invite(f);
    f.sql.prepare('UPDATE accounts SET blocked_at=? WHERE actor_id=?').run(now,partner);
    assert.equal((await call(f,'/invites/accept','POST',{code},partner)).status,401);
    f.sql.prepare('UPDATE accounts SET blocked_at=NULL WHERE actor_id=?').run(partner);
    f.sql.prepare('UPDATE accounts SET blocked_at=? WHERE actor_id=?').run(now,owner);
    assert.equal((await call(f,'/invites/accept','POST',{code},partner)).status,403);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM service_admins').get().n,0);
  }finally{f.close();}
});
test('failed audit rolls back acceptance and grant without leaking SQL',async()=>{
  const f=setup();try {
    const code=await invite(f);
    f.sql.exec("CREATE TRIGGER fail_admin_audit BEFORE INSERT ON service_admin_audit BEGIN SELECT RAISE(ABORT,'private SQL detail'); END");
    const result=await call(f,'/invites/accept','POST',{code},partner);
    assert.equal(result.status,503);assert.deepEqual(result.data,{error:'ADMIN_UNAVAILABLE'});
    assert.equal(f.sql.prepare('SELECT consumed_at FROM service_admin_invites').get().consumed_at,null);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM service_admins').get().n,0);
  }finally{f.close();}
});
test('capacity and duplicate invite checks are enforced inside SQL',async()=>{
  const f=setup();try {
    await invite(f);assert.equal((await call(f,'/invites','POST',{targetActorId:partner})).status,409);
    assert.equal((await call(f,'/invites','POST',{targetActorId:`U${'f'.repeat(32)}`})).status,409);
    assert.equal((await call(f,'/invites','POST',{targetActorId:owner})).status,400);
    for(let n=4;n<=8;n++) {const id=`U${String(n).repeat(32)}`;f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(id,id,now);
      f.sql.prepare('INSERT INTO service_admins(actor_id,granted_by,granted_at) VALUES(?,?,?)').run(id,owner,now);}
    assert.equal((await call(f,'/invites','POST',{targetActorId:other})).status,409);
    const code=f.sql.prepare('SELECT code_hash FROM service_admin_invites').get().code_hash;
    assert.equal((await call(f,'/invites/accept','POST',{code:'0'.repeat(64)},partner)).status,409);
    assert.equal(f.sql.prepare('SELECT consumed_at FROM service_admin_invites WHERE code_hash=?').get(code).consumed_at,null);
  }finally{f.close();}
});
test('admin HTTP routes use real session, CSRF and existing rate limits; identity headers are not authentication',async()=>{
  const f=setup();try {
    const authToken='a'.repeat(64),csrf='b'.repeat(64);
    f.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sha(authToken),owner,csrf,Date.now(),Date.now()+3600000);
    const request=(headers={},body={targetActorId:partner})=>new Request(`${origin}/api/admin/invites`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await handleRequest(request({'x-actor-id':owner}),f.env)).status,401);
    assert.equal((await handleRequest(request({cookie:`nongoon_session=${authToken}`}),f.env)).status,401);
    const headers={cookie:`__Host-nongoon=${authToken}`,origin,'x-csrf-token':csrf};
    assert.equal((await handleRequest(request({...headers,'x-csrf-token':'wrong'}),f.env)).status,403);
    const result=await handleRequest(request(headers),f.env);assert.equal(result.status,201,await result.text());
  }finally{f.close();}
});
