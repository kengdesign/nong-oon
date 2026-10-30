// Separate worker/resources only. No public API, LINE login, or real care bindings.
import assets from './mock-assets.mjs';
import {handleCareApi,CONSENT_VERSION} from '../src/care-api.mjs';
import {handleMediaApi} from '../src/media-api.mjs';
import {grantMediaConsent,ingestMediaEvents,cleanupMedia} from '../src/media-store.mjs';
import {processMediaJob} from '../src/media-pipeline.mjs';
const actor='U'+'0'.repeat(32),runId='single-account-v1';
const check=(ok,code)=>{if(!ok)throw Error(code);};
async function rows(db,sql,args=[]){const r=await db.prepare(sql).bind(...args).all();check(r.success===true,'DB_FAILED');return r.results;}
export async function runRehearsal(bindings,{providerFetch=fetch,providerMode='live_google_vision'}={}){
 // Main DB/R2 bindings and LINE credentials are forbidden even if supplied accidentally.
 check(bindings.E2E_ENV==='isolated-single-account'&&bindings.E2E_DB&&bindings.E2E_R2&&!bindings.DB&&!bindings.MEDIA_R2&&!bindings.LINE_CHANNEL_ACCESS_TOKEN&&!bindings.LINE_CHANNEL_SECRET,'ISOLATION_REQUIRED');
 const db=bindings.E2E_DB,r2=bindings.E2E_R2;
 await rows(db,'CREATE TABLE IF NOT EXISTS single_account_e2e(id TEXT PRIMARY KEY,state TEXT NOT NULL,report_json TEXT)');
 const previous=await rows(db,'SELECT state,report_json FROM single_account_e2e WHERE id=?',[runId]);
 if(previous.length)return {state:previous[0].state,replayed:true};
 if(!bindings.GOOGLE_VISION_API_KEY)return {state:'blocked',code:'ISOLATED_VISION_SECRET_REQUIRED'};
 const claim=await rows(db,"INSERT INTO single_account_e2e VALUES(?,'started',NULL) ON CONFLICT DO NOTHING RETURNING id",[runId]);
 if(!claim.length)return {state:'already_started'}; // No automatic paid replays after a failure/crash.
 const now=Date.now();let providerCalls=0;
 const env={DB:db,MEDIA_R2:r2,APP_ENV:'staging',MEDIA_API_ENABLED:'true',MEDIA_PROCESSING_ENABLED:'true',MEDIA_PROVIDER_ENABLED:'true',MEDIA_PROVIDER_ID:'google-vision-v1',GOOGLE_VISION_API_KEY:bindings.GOOGLE_VISION_API_KEY,LINE_CHANNEL_ACCESS_TOKEN:'synthetic-download-adapter-only'};
 const request=async(path,method='GET',body)=>{
  const req=new Request('https://isolated-e2e.invalid'+path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
  const response=await (path.startsWith('/api/media/')?handleMediaApi:handleCareApi)(req,env,{actorId:actor,now:Date.now()});
  const data=response.headers.get('content-type')?.includes('application/json')?await response.json():null;
  return {status:response.status,data};
 };
 try{
  await rows(db,'INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)',[actor,actor,now]);
  const created=await request('/api/patients','POST',{displayName:'SYNTHETIC E2E',consent:true,consentVersion:CONSENT_VERSION});check(created.status===201,'PROFILE_FAILED');
  const patient=created.data.patient.id;
  await grantMediaConsent(db,{patientId:patient,actorId:actor,providerId:env.MEDIA_PROVIDER_ID,now});
  const base=`/api/media/patients/${patient}`;
  const samples=assets.filter(a=>['blister','bottle'].includes(a.layout));
  const byteMap=new Map(samples.map((a,i)=>[String(99000001+i),{asset:a,bytes:Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0))}]));
  const fetcher=async(url,init)=>{
   const m=/^https:\/\/api-data.line.me\/v2\/bot\/message\/(9900000[12])\/content$/.exec(String(url));
   if(m){const sample=byteMap.get(m[1]);return new Response(sample.bytes,{headers:{'content-type':'image/jpeg'}});}
   check(String(url)==='https://vision.googleapis.com/v1/images:annotate','UNEXPECTED_NETWORK_TARGET');
   providerCalls++;check(providerCalls<=2,'PROVIDER_BUDGET_EXCEEDED');return providerFetch(url,init);
  };
  for(const [messageId] of byteMap)await ingestMediaEvents(db,[{webhookEventId:'isolated_'+messageId,type:'message',timestamp:now,source:{type:'user',userId:actor},message:{type:'image',id:messageId}}],{now,providerId:env.MEDIA_PROVIDER_ID});
  const jobs=await rows(db,'SELECT id,message_id,object_key FROM media_jobs ORDER BY message_id');check(jobs.length===2,'INTAKE_COUNT_FAILED');
  for(let i=0;i<jobs.length;i++){
   const outcome=await processMediaJob(env,jobs[i].id,{fetcher});check(outcome.outcome==='awaiting_review','OCR_PIPELINE_FAILED');
   const view=await request(`${base}/jobs/${jobs[i].id}`);check(view.status===200,'REVIEW_NOT_AVAILABLE');
   const fields=view.data.draft.items[0].fields,sample=byteMap.get(jobs[i].message_id).asset;
   check(fields.label.value===sample.name&&fields.strength.value===sample.strength,'OCR_FIELDS_MISMATCH');
   check(fields.dose.value===null&&fields.times.value===null,'INVENTED_REGIMEN');
  }
  const date=new Date(now+7*3600000).toISOString().slice(0,10);
  const input=version=>({expectedReviewVersion:0,expectedScheduleVersion:version,sourceChecked:true,issuesResolved:true,useMode:'scheduled',strength:'5 mg',dose:'SYNTHETIC ONLY',schedule:{label:'SYNTHETIC E2E TEST',instructions:'TEST ONLY - DO NOT TAKE',times:['23:59'],weekdays:[0,1,2,3,4,5,6],startDate:date,endDate:date}});
  const schedules=()=>rows(db,'SELECT id FROM medication_schedules WHERE patient_id=?',[patient]);
  const firstPath=`${base}/jobs/${jobs[0].id}`;
  const saved=await request(firstPath+'/reviews/0','PUT',input(1));check(saved.status===200&&(await schedules()).length===0,'REVIEW_SAVE_FAILED');
  const confirmation={confirmationId:crypto.randomUUID(),expectedReviewVersion:saved.data.reviewVersion,expectedScheduleVersion:1,acknowledge:true};
  const first=await request(firstPath+'/reviews/0/confirm','POST',confirmation),repeat=await request(firstPath+'/reviews/0/confirm','POST',confirmation);
  check(first.status===200&&repeat.status===200&&repeat.data.replayed===true&&repeat.data.scheduleId===first.data.scheduleId&&(await schedules()).length===1,'CONFIRM_REPLAY_FAILED');
  const secondPath=`${base}/jobs/${jobs[1].id}`;
  const second=await request(secondPath+'/reviews/0','PUT',input(first.data.currentVersion));check(second.status===200,'SECOND_REVIEW_FAILED');
  check((await request(secondPath,'DELETE')).status===200&&(await request(secondPath,'DELETE')).status===200,'CANCEL_FAILED');
  const denied=await request(secondPath+'/reviews/0/confirm','POST',{...confirmation,confirmationId:crypto.randomUUID(),expectedReviewVersion:second.data.reviewVersion,expectedScheduleVersion:first.data.currentVersion});
  check(denied.status===404&&(await schedules()).length===1,'CANCEL_CONFIRM_NOT_BLOCKED');
  for(const j of jobs)check((await request(`${base}/jobs/${j.id}/source`)).status===404,'SOURCE_ACCESS_NOT_DENIED');
  await cleanupMedia(env,Date.now());
  for(const j of jobs)check(await r2.head(j.object_key)===null,'R2_OBJECT_REMAINS');
  check((await rows(db,'SELECT id FROM media_jobs WHERE draft_json IS NOT NULL OR message_id IS NOT NULL')).length===0,'D1_PAYLOAD_REMAINS');
  check((await rows(db,'SELECT job_id FROM media_reviews')).length===0,'D1_REVIEW_REMAINS');
  check((await request(`/api/patients/${patient}/consent`,'DELETE')).status===200,'TEST_PROFILE_TEARDOWN_FAILED');
  check((await rows(db,'SELECT id FROM medication_schedules WHERE active=1')).length===0,'ACTIVE_TEST_SCHEDULE_REMAINS');
  const report={state:'passed',scope:'isolated_backend_handlers',providerMode,providerCalls,images:2,profile:'synthetic_only',intake:'fixed_transport_adapter',ocrFields:'passed',manualCorrectionApi:'passed',confirmReplay:'passed',cancel:'passed',r2HeadAbsent:'passed',d1PayloadCleared:'passed',profileWithdrawn:'passed',lineWebhook:'not_tested',browserUi:'not_tested',metadataErased:false,mainStagingAcceptance:false,pilotReady:false};
  await rows(db,'UPDATE single_account_e2e SET state=?,report_json=? WHERE id=?',['passed',JSON.stringify(report),runId]);return report;
 }catch{
  const report={state:'failed',providerMode,providerCalls,pilotReady:false,mainStagingAcceptance:false};
  await rows(db,'UPDATE single_account_e2e SET state=?,report_json=? WHERE id=?',['failed',JSON.stringify(report),runId]);return report;
 }
}
export default {fetch(){return new Response('Not found',{status:404});},async scheduled(_event,env){await runRehearsal(env);}};
