import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from './helpers/db.mjs';
import {materializePatient,bangkokInstant,nextWake} from '../src/scheduler.mjs';
import {deliverPatientOutbox,lineNotificationMessage,deliveryStatus} from '../src/delivery.mjs';
import {applyLineDosePostback} from '../src/line-dose-postback.mjs';
const owner='U'+'1'.repeat(32),care='U'+'2'.repeat(32),at=t=>bangkokInstant('2026-11-03',t);
const env={APP_ENV:'production',SCHEDULER_ENABLED:'true',DELIVERY_ENABLED:'true',SNOOZE_ENABLED:'true',LINE_POSTBACK_ENABLED:'true',APP_ORIGIN:'https://example.test',LIVE_LINE_RECIPIENTS:JSON.stringify([owner,care]),LINE_CHANNEL_ACCESS_TOKEN:'synthetic-only'};
async function fixture(){
 const f=createTestDb();
 for(const a of [owner,care])f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(a,a,at('00:00'));
 f.sql.prepare(`INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id) VALUES('p1',?,'test','v1',?,?,'seed')`).run(owner,at('00:00'),at('00:00'));
 f.sql.prepare("INSERT INTO care_members VALUES('p1',?,'owner',NULL),('p1',?,'caregiver',NULL)").run(owner,care);
 f.sql.prepare("INSERT INTO care_grants(patient_id,actor_id,action,revoked_at) VALUES('p1',?,'report_taken',NULL)").run(owner);
 f.sql.exec(`INSERT INTO care_schedules(patient_id,current_version) VALUES('p1',1); INSERT INTO medication_schedules VALUES('s1','p1','test','test','["08:00"]','[0,1,2,3,4,5,6]','2026-11-03',NULL,1,1,0)`);
 await materializePatient(f.db,'p1',at('07:00'));
 const calls=[];
 f.deliver=now=>deliverPatientOutbox(f.db,'p1',now,env,{clock:()=>now,fetcher:async(u,o)=>{calls.push(JSON.parse(o.body));return new Response(null,{status:200});}});
 await f.deliver(at('08:00'));
 f.job=f.sql.prepare("SELECT * FROM notification_outbox WHERE kind='reminder' AND generation=0 ORDER BY available_at LIMIT 1").get();
 f.calls=calls;f.event=(kind,id=f.job.id,user=owner)=>({type:'postback',source:{type:'user',userId:user},postback:{data:kind+':'+id}});
 return f;
}
test('continuous production and snooze actions remain separate from staging pilot',()=>{
 assert.equal(deliveryStatus(env,at('08:00')).state,'active');
 assert.equal(deliveryStatus({...env,APP_ENV:'staging'},at('08:00')).state,'invalid');
 const m=lineNotificationMessage('test','11111111-1111-4111-8111-111111111111',null,false,true);
 assert.equal(m.template.actions.length,2);assert.match(m.template.actions[1].data,/^dose_snooze:/);
});
test('snooze persists one child, replay keeps deadline, and fires after 15 minutes',async()=>{
 const f=await fixture();const options={snoozeEnabled:true};
 const a=await applyLineDosePostback(f.db,f.event('dose_snooze'),at('08:01'),options);
 assert.equal(a.ok,true);
 await applyLineDosePostback(f.db,f.event('dose_snooze'),at('08:02'),options);
 const jobs=f.sql.prepare("SELECT * FROM notification_outbox WHERE generation=1").all();
 assert.equal(jobs.length,1);assert.equal(jobs[0].available_at,at('08:16'));
 assert.equal(await nextWake(f.db,'p1',at('08:02')),at('08:16'));
 await f.deliver(at('08:15'));assert.equal(f.calls.length,1);
 await f.deliver(at('08:16'));assert.equal(f.calls.length,2);
 assert.equal((await applyLineDosePostback(f.db,f.event('dose_snooze',jobs[0].id),at('08:17'),options)).ok,true);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE generation=2').get().n,1);
});
test('wrong account cannot snooze; acknowledgement cancels child and caregiver alert',async()=>{
 const f=await fixture(),options={snoozeEnabled:true};
 assert.equal((await applyLineDosePostback(f.db,f.event('dose_snooze',f.job.id,care),at('08:01'),options)).ok,false);
 await applyLineDosePostback(f.db,f.event('dose_snooze'),at('08:01'),options);
 assert.equal((await applyLineDosePostback(f.db,f.event('dose_taken'),at('08:02'))).ok,true);
 await f.deliver(at('08:30'));assert.equal(f.calls.length,1);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE status='sent' AND kind='caregiver_alert'").get().n,0);
});
test('caregiver alert sends once at 30 minutes and revoked membership prevents send',async()=>{
 const f=await fixture();await f.deliver(at('08:29'));assert.equal(f.calls.length,1);
 await f.deliver(at('08:30'));await f.deliver(at('08:31'));assert.equal(f.calls.length,2);assert.equal(f.calls[1].to,care);
 const g=await fixture();g.sql.prepare("UPDATE care_members SET revoked_at=? WHERE role='caregiver'").run(at('08:10'));
 await g.deliver(at('08:30'));assert.equal(g.calls.length,1);
});
test('expired or deactivated schedules cannot snooze',async()=>{
 const f=await fixture();f.sql.exec('UPDATE medication_schedules SET active=0');
 assert.equal((await applyLineDosePostback(f.db,f.event('dose_snooze'),at('08:01'),{snoozeEnabled:true})).ok,false);
});

test('production may notify linked caregivers outside owner pilot list only with explicit switch',async()=>{
 const f=await fixture();let calls=0;const now=at('08:30');
 const cfg={...env,CAREGIVER_DELIVERY_ENABLED:'true',LIVE_LINE_RECIPIENTS:JSON.stringify([owner])};
 assert.equal(await nextWake(f.db,'p1',at('08:10'),{recipients:[owner],caregiverEnabled:true}),at('08:30'));
 await deliverPatientOutbox(f.db,'p1',now,cfg,{clock:()=>now,fetcher:async()=>{calls++;return new Response(null,{status:200});}});
 assert.equal(calls,1);
});
test('outbox migration preserves historical rows and budget triggers',async()=>{
 const {readdirSync,readFileSync}=await import('node:fs');
 const migrations=readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')&&!x.startsWith('0011')).sort();
 const f=createTestDb({migrations});
 f.sql.exec(`INSERT INTO notification_outbox(id,patient_id,dose_id,schedule_version,recipient_actor_id,kind,status,available_at,expires_at,created_at) VALUES('old','p','d',1,'a','reminder','sent',1,999,0)`);
 f.sql.exec(readFileSync(new URL('../migrations/0011_phase3_snooze.sql',import.meta.url),'utf8'));
 assert.equal(f.sql.prepare("SELECT generation FROM notification_outbox WHERE id='old'").get().generation,0);
 f.sql.exec("UPDATE notification_outbox SET attempts=1,attempted_at=100 WHERE id='old'");
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM delivery_budget').get().n,2);
});
