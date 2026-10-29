import { validateSchedule } from './care-api.mjs';
import { parseDraft } from './draft-contract.mjs';
import { all,batch,stmt,ownerSQL,ownerArgs,liveJobSQL,requireMediaOwner,reject,mediaId,mediaNow } from './media-store.mjs';
const REVIEW_TTL=15*60_000;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const revision=v=>Number.isSafeInteger(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER;
const index=v=>Number.isInteger(v)&&v>=0&&v<20;
const short=v=>typeof v==='string'&&v.length>0&&v.length<=120&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);

export async function cancelMediaJob(db,{jobId,patientId,actorId,now}){
  if(!mediaId(jobId)||!mediaNow(now))reject('INVALID_MEDIA_INPUT');
  await requireMediaOwner(db,patientId,actorId);
  // Keep lease and object manifest: an in-flight put must still be swept after
  // its lease expires. Confirmed schedules and replay receipts are untouched.
  const guard=`id=? AND patient_id=? AND actor_id=? AND ${ownerSQL}`;
  const args=[jobId,patientId,actorId,...ownerArgs(patientId,actorId)];
  const result=await batch(db,[
    stmt(db,`UPDATE media_jobs SET state='cancelled',draft_json=NULL,message_id=NULL,last_code='USER_CANCELLED',updated_at=?
      WHERE ${guard} AND state IN ('queued','processing','awaiting_review','cancelled') RETURNING id`,[now,...args]),
    stmt(db,`DELETE FROM media_reviews WHERE job_id IN (SELECT id FROM media_jobs WHERE ${guard} AND state='cancelled')`,args),
  ]);
  if(result[0].results?.length!==1)reject('MEDIA_DRAFT_UNAVAILABLE',404);
  return {cancelled:true,cleanupPending:true};
}

// Explicit owner retry only. Never overwrite edited/confirmed reviews or reset
// attempts, quotas, source deduplication or the original 24-hour expiry.
export async function retryMediaJob(db,context){
  await readMediaJob(db,context);
  const {jobId,patientId,actorId,now,providerId}=context;
  const rows=await all(db,`UPDATE media_jobs SET state='queued',draft_json=NULL,last_code=NULL,dispatch_at=0,updated_at=?
    WHERE id=? AND patient_id=? AND actor_id=? AND provider_id=? AND state='awaiting_review'
      AND expires_at>? AND attempts<3 AND message_id IS NOT NULL AND unsent_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM media_reviews WHERE job_id=media_jobs.id)
      AND ${liveJobSQL} RETURNING id`,[now,jobId,patientId,actorId,providerId,now,now]);
  if(rows.length!==1)reject('MEDIA_RETRY_UNAVAILABLE',409);
  return {queued:true};
}

export async function readMediaJob(db,{jobId,patientId,actorId,now,providerId}){
  if(!mediaId(jobId)||!mediaNow(now))reject('INVALID_MEDIA_INPUT');
  const currentVersion=await requireMediaOwner(db,patientId,actorId);
  const rows=await all(db,`SELECT * FROM media_jobs WHERE id=? AND patient_id=? AND actor_id=? AND provider_id=?
    AND state='awaiting_review' AND expires_at>? AND unsent_at IS NULL AND ${liveJobSQL}`,[jobId,patientId,actorId,providerId,now,now]);
  if(rows.length!==1)reject('MEDIA_DRAFT_UNAVAILABLE',404);
  const parsed=parseDraft(rows[0].draft_json);if(!parsed.ok)reject('MEDIA_DRAFT_INVALID',409);
  const reviews=await all(db,'SELECT item_index,version,expires_at,confirmed_at,snapshot_json FROM media_reviews WHERE job_id=? ORDER BY item_index',[jobId]);
  return {row:rows[0],draft:parsed.draft,currentVersion,reviews};
}
function reviewSnapshot(input,now){
  if(!exact(input,['expectedReviewVersion','expectedScheduleVersion','sourceChecked','issuesResolved','useMode','strength','dose','schedule'])||
    !revision(input.expectedReviewVersion)||!revision(input.expectedScheduleVersion)||input.expectedScheduleVersion<1||
    input.sourceChecked!==true||input.issuesResolved!==true||input.useMode!=='scheduled'||!short(input.strength)||!short(input.dose)||
    !exact(input.schedule,['label','instructions','times','weekdays','startDate','endDate']))reject('MEDIA_REVIEW_INCOMPLETE');
  const instructions=`${input.schedule.instructions}\nความแรง: ${input.strength}\nจำนวนต่อครั้ง: ${input.dose}`;
  let schedule;
  try{schedule=validateSchedule({...input.schedule,instructions,active:true,expectedVersion:input.expectedScheduleVersion},now);}
  catch{reject('MEDIA_REVIEW_INVALID_SCHEDULE');}
  // Preserve explicit user-reviewed values; never compute dose/strength arithmetic.
  return {schedule,strength:input.strength,dose:input.dose,instructions:input.schedule.instructions,sourceChecked:true,issuesResolved:true};
}
export async function saveMediaReview(db,{jobId,patientId,actorId,itemIndex,input,now,providerId}){
  if(!index(itemIndex))reject('INVALID_MEDIA_ITEM');
  const view=await readMediaJob(db,{jobId,patientId,actorId,now,providerId});
  if(!view.draft.items[itemIndex])reject('INVALID_MEDIA_ITEM');
  // PRN and pill-only paths are deliberately not converted to fixed schedules.
  if(view.draft.items[itemIndex].fields.useMode.value==='as_needed'||view.draft.sourceKind==='pill_photo')reject('MEDIA_REGIMEN_UNSUPPORTED',422);
  const snapshot=reviewSnapshot(input,now);
  if(input.expectedScheduleVersion!==view.currentVersion)reject('MEDIA_SCHEDULE_CHANGED',409);
  const existing=view.reviews.find(r=>r.item_index===itemIndex);
  if(existing?.confirmed_at!==null&&existing?.confirmed_at!==undefined)reject('MEDIA_ALREADY_CONFIRMED',409);
  if((existing?.version??0)!==input.expectedReviewVersion)reject('MEDIA_REVIEW_CHANGED',409);
  const expiresAt=Math.min(view.row.expires_at,now+REVIEW_TTL),version=input.expectedReviewVersion+1;
  const guard=`EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND patient_id=? AND actor_id=? AND provider_id=?
    AND state='awaiting_review' AND expires_at>? AND unsent_at IS NULL AND ${liveJobSQL})`;
  const r=await all(db,`INSERT INTO media_reviews(job_id,item_index,version,snapshot_json,expires_at)
    SELECT ?,?,?,?,? WHERE ${guard} AND EXISTS(SELECT 1 FROM care_schedules WHERE patient_id=? AND current_version=?)
    ON CONFLICT(job_id,item_index) DO UPDATE SET version=excluded.version,snapshot_json=excluded.snapshot_json,expires_at=excluded.expires_at
    WHERE media_reviews.version=? AND media_reviews.confirmed_at IS NULL RETURNING version`,
    [jobId,itemIndex,version,JSON.stringify(snapshot),expiresAt,jobId,patientId,actorId,providerId,now,now,patientId,view.currentVersion,input.expectedReviewVersion]);
  if(r.length!==1)reject('MEDIA_REVIEW_CHANGED',409);
  return {reviewVersion:version,expectedScheduleVersion:view.currentVersion,expiresAt,snapshot};
}
export async function confirmMediaReview(db,{jobId,patientId,actorId,itemIndex,input,now,providerId}){
  if(!index(itemIndex)||!exact(input,['confirmationId','expectedReviewVersion','expectedScheduleVersion','acknowledge'])||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.confirmationId??'')||input.acknowledge!==true||
    !revision(input.expectedReviewVersion)||input.expectedReviewVersion<1||!revision(input.expectedScheduleVersion)||input.expectedScheduleVersion<1||!mediaNow(now))reject('MEDIA_CONFIRMATION_REQUIRED');
  await requireMediaOwner(db,patientId,actorId);
  const receipt=await all(db,'SELECT * FROM media_receipts WHERE confirmation_id=?',[input.confirmationId]);
  if(receipt.length){const r=receipt[0];
    if(r.job_id!==jobId||r.item_index!==itemIndex||r.actor_id!==actorId||r.patient_id!==patientId||r.review_version!==input.expectedReviewVersion||r.base_version!==input.expectedScheduleVersion)
      reject('MEDIA_CONFIRMATION_CONFLICT',409);
    return {scheduleId:r.schedule_id,replayed:true};
  }
  const view=await readMediaJob(db,{jobId,patientId,actorId,now,providerId});
  const review=view.reviews.find(r=>r.item_index===itemIndex);
  if(!review||review.confirmed_at!==null||review.version!==input.expectedReviewVersion||review.expires_at<=now)reject('MEDIA_REVIEW_CHANGED',409);
  if(view.currentVersion!==input.expectedScheduleVersion)reject('MEDIA_SCHEDULE_CHANGED',409);
  const snapshot=JSON.parse(review.snapshot_json),s=validateSchedule(snapshot.schedule,now);
  if(s.expectedVersion!==input.expectedScheduleVersion||snapshot.sourceChecked!==true||snapshot.issuesResolved!==true)reject('MEDIA_REVIEW_CHANGED',409);
  const scheduleId=crypto.randomUUID(),mutation=crypto.randomUUID(),nextVersion=view.currentVersion+1;
  if(!Number.isSafeInteger(nextVersion))reject('MEDIA_SCHEDULE_CHANGED',409);
  const validReview=`EXISTS(SELECT 1 FROM media_reviews r JOIN media_jobs ON media_jobs.id=r.job_id
    WHERE r.job_id=? AND r.item_index=? AND r.version=? AND r.confirmed_at IS NULL AND r.expires_at>?
      AND media_jobs.patient_id=? AND media_jobs.actor_id=? AND media_jobs.provider_id=? AND media_jobs.state='awaiting_review'
      AND media_jobs.expires_at>? AND media_jobs.unsent_at IS NULL AND ${liveJobSQL})`;
  const validArgs=[jobId,itemIndex,review.version,now,patientId,actorId,providerId,now,now];
  const committed='EXISTS(SELECT 1 FROM care_schedules WHERE patient_id=? AND mutation_id=?)',args=[patientId,mutation];
  const result=await batch(db,[
    stmt(db,`UPDATE care_schedules SET current_version=?,mutation_id=? WHERE patient_id=? AND current_version=?
      AND ${ownerSQL} AND ${validReview} AND (SELECT COUNT(*) FROM medication_schedules WHERE patient_id=?)<100
      AND (SELECT COUNT(*) FROM medication_schedules WHERE patient_id=? AND active=1)<20
      AND NOT EXISTS(SELECT 1 FROM medication_schedules WHERE patient_id=? AND active=1 AND label=? AND times_json=?)
      RETURNING current_version`,[nextVersion,mutation,patientId,view.currentVersion,...ownerArgs(patientId,actorId),...validArgs,
        patientId,patientId,patientId,s.label,JSON.stringify(s.times)]),
    stmt(db,`INSERT INTO medication_schedules(id,patient_id,label,instructions,times_json,weekdays_json,start_date,end_date,active,version,updated_at)
      SELECT ?,?,?,?,?,?,?,?,1,?,? WHERE ${committed}`,[scheduleId,patientId,s.label,s.instructions,JSON.stringify(s.times),JSON.stringify(s.weekdays),s.startDate,s.endDate,nextVersion,now,...args]),
    stmt(db,`UPDATE medication_schedules SET version=? WHERE patient_id=? AND ${committed}`,[nextVersion,patientId,...args]),
    stmt(db,`INSERT INTO care_audit(event_id,patient_id,actor_id,action,resource_id,version,created_at)
      SELECT ?,?,?,'media_schedule_confirmed',?,?,? WHERE ${committed}`,[mutation,patientId,actorId,scheduleId,nextVersion,now,...args]),
    stmt(db,`INSERT INTO media_receipts SELECT ?,?,?,?,?,?,?,?,? WHERE ${committed}`,
      [input.confirmationId,jobId,itemIndex,actorId,patientId,review.version,view.currentVersion,scheduleId,now,...args]),
    stmt(db,`UPDATE media_reviews SET confirmed_at=?,schedule_id=? WHERE job_id=? AND item_index=? AND ${committed}`,[now,scheduleId,jobId,itemIndex,...args]),
    stmt(db,`UPDATE media_jobs SET state='confirmed',draft_json=NULL,message_id=NULL,updated_at=? WHERE id=? AND ${committed}
      AND (SELECT COUNT(*) FROM media_reviews WHERE job_id=? AND confirmed_at IS NOT NULL)=json_array_length(draft_json,'$.items')`,[now,jobId,...args,jobId]),
  ]);
  if(result[0].results?.length!==1)reject('MEDIA_CONFIRMATION_CONFLICT',409);
  return {scheduleId,currentVersion:nextVersion,replayed:false};
}
