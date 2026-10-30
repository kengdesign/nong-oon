// Actual staging API workflow. Intake must already have occurred through LINE.
// Never seed identities/sessions, bypass Access, or turn delivery on.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const ORIGIN='https://staging.nongoon.com';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function requireValue(ok,code){if(!ok)throw Error(code);}
export async function runWorkflow({manifest,request,checkpoint=()=>{}}){
 requireValue(manifest?.syntheticOnly===true&&id(manifest.patientId)&&Array.isArray(manifest.jobs)&&manifest.jobs.length===2&&manifest.jobs.every(id)&&new Set(manifest.jobs).size===2,'ISOLATED_SYNTHETIC_MANIFEST_REQUIRED');
 const api=async(path,method='GET',body)=>{
  const r=await request(path,method,body);
  requireValue(r.status>=200&&r.status<300,'API_REQUEST_REJECTED');return r.data;
 };
 const health=await api('/health');requireValue(health.status==='staging'&&health.deliveryEnabled===false,'DELIVERY_NOT_CONFIRMED_OFF');
 const session=await api('/api/session');requireValue(session.authenticated===true,'TEST_ACCOUNT_LOGIN_REQUIRED');
 const patients=await api('/api/patients');
 requireValue(patients.patients?.some(p=>p.id===manifest.patientId&&p.role==='owner'&&p.displayName==='SYNTHETIC E2E'),'ISOLATED_TEST_PROFILE_REQUIRED');
 const care=`/api/patients/${manifest.patientId}`,base=`/api/media/patients/${manifest.patientId}`;
 requireValue((await api(base+'/consent')).consented===true,'TEST_MEDIA_CONSENT_REQUIRED');
 const schedules=()=>api(care+'/schedules');
 const initial=await schedules();requireValue(Array.isArray(initial.schedules)&&initial.schedules.length===0,'EMPTY_TEST_PROFILE_REQUIRED');
 // Validate both inputs before the first mutation. Never operate on the real Keng draft.
 for(const job of manifest.jobs){
  const v=await api(base+'/jobs/'+job);
  requireValue(v.sourceKind==='printed_label'&&v.draft?.items?.length===1&&v.reviews?.length===0&&/^TEST(?:BLISTER|BOTTLE|SACHET)$/.test(v.draft.items[0].fields.label.value??''),'SYNTHETIC_IMAGE_INTAKE_REQUIRED');
  requireValue((await request(base+'/jobs/'+job+'/source')).status===200,'SOURCE_NOT_AVAILABLE');
 }
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const input=v=>({expectedReviewVersion:0,expectedScheduleVersion:v.currentVersion,sourceChecked:true,issuesResolved:true,useMode:'scheduled',strength:'5 mg',dose:'SYNTHETIC ONLY',schedule:{label:'SYNTHETIC E2E TEST',instructions:'TEST ONLY - NOT MEDICATION',times:['23:59'],weekdays:[0,1,2,3,4,5,6],startDate:date,endDate:date}});
 const path=job=>base+'/jobs/'+job;
 const view=await api(path(manifest.jobs[0]));
 const review=await api(path(manifest.jobs[0])+'/reviews/0','PUT',input(view));
 requireValue((await schedules()).schedules.length===0,'REVIEW_CREATED_SCHEDULE');checkpoint('review_saved');
 const confirm={confirmationId:randomUUID(),expectedReviewVersion:review.reviewVersion,expectedScheduleVersion:review.expectedScheduleVersion,acknowledge:true};
 // Record a non-secret checkpoint before confirmation; never auto-retry after transport uncertainty.
 checkpoint('confirmation_starting');
 const first=await api(path(manifest.jobs[0])+'/reviews/0/confirm','POST',confirm);
 const again=await api(path(manifest.jobs[0])+'/reviews/0/confirm','POST',confirm);
 requireValue(again.replayed===true&&again.scheduleId===first.scheduleId&&(await schedules()).schedules.length===1,'DUPLICATE_CONFIRMATION_FAILED');checkpoint('confirmation_replay_passed');
 const secondView=await api(path(manifest.jobs[1]));
 const cancelledReview=await api(path(manifest.jobs[1])+'/reviews/0','PUT',input(secondView));
 await api(path(manifest.jobs[1]),'DELETE');await api(path(manifest.jobs[1]),'DELETE');
 const denied=await request(path(manifest.jobs[1])+'/reviews/0/confirm','POST',{confirmationId:randomUUID(),expectedReviewVersion:cancelledReview.reviewVersion,expectedScheduleVersion:cancelledReview.expectedScheduleVersion,acknowledge:true});
 requireValue(denied.status===404&&denied.data?.error==='MEDIA_DRAFT_UNAVAILABLE','CANCEL_CONFIRMATION_NOT_BLOCKED');
 requireValue((await schedules()).schedules.length===1,'CANCELLATION_CHANGED_SCHEDULES');
 for(const job of manifest.jobs)requireValue((await request(path(job)+'/source')).status===404,'TERMINAL_SOURCE_STILL_ACCESSIBLE');
 requireValue((await api('/health')).deliveryEnabled===false,'DELIVERY_CHANGED');
 return {workflow:'passed',intake:'preexisting_synthetic_LINE_jobs',confirmationReplay:'passed',cancellation:'passed',sourceAccessDenied:'passed',physicalR2Deletion:'not_run',d1PayloadClearing:'not_run',syntheticScheduleTeardown:'not_run',endToEndPassed:false,pilotReady:false};
}
export function createClient({cookie='',accessId='',accessSecret='',fetcher=fetch}={}){
 let csrf='';
 return async(path,method='GET',body)=>{
  requireValue(typeof path==='string'&&/^\/(health|api\/)/.test(path)&&!path.includes('..')&&!path.includes('?'),'INVALID_TARGET');
  const headers={accept:'application/json',...(cookie?{cookie}:{}),...(accessId&&accessSecret?{'CF-Access-Client-Id':accessId,'CF-Access-Client-Secret':accessSecret}:{})};
  if(method!=='GET')Object.assign(headers,{'content-type':'application/json','x-csrf-token':csrf,origin:ORIGIN});
  const r=await fetcher(ORIGIN+path,{method,headers,redirect:'manual',signal:AbortSignal.timeout(20000),...(body===undefined?{}:{body:JSON.stringify(body)})});
  requireValue(!(r.status>=300&&r.status<400),'AUTH_REDIRECT_BLOCKED');
  if(path.endsWith('/source'))return {status:r.status};
  requireValue(r.headers.get('content-type')?.includes('application/json'),'NON_JSON_AUTH_OR_ROUTE_RESPONSE');
  const data=await r.json();if(path==='/api/session')csrf=data.csrf??'';
  return {status:r.status,data};
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const manifest=JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
  const request=createClient({cookie:process.env.NONG_OON_TEST_COOKIE,accessId:process.env.CF_ACCESS_CLIENT_ID,accessSecret:process.env.CF_ACCESS_CLIENT_SECRET});
  console.log(JSON.stringify(await runWorkflow({manifest,request,checkpoint:step=>console.log(JSON.stringify({step}))})));
 }catch(e){const codes=['ISOLATED_SYNTHETIC_MANIFEST_REQUIRED','ISOLATED_TEST_PROFILE_REQUIRED','TEST_ACCOUNT_LOGIN_REQUIRED','AUTH_REDIRECT_BLOCKED','NON_JSON_AUTH_OR_ROUTE_RESPONSE','EMPTY_TEST_PROFILE_REQUIRED','SYNTHETIC_IMAGE_INTAKE_REQUIRED','DELIVERY_NOT_CONFIRMED_OFF'];console.log(JSON.stringify({workflow:'blocked_or_failed',code:codes.includes(e.message)?e.message:'E2E_FAILED_REVIEW_CHECKPOINTS',endToEndPassed:false,pilotReady:false}));process.exitCode=1;}
}
