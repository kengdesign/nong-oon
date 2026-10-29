import { MEDIA_CONSENT_VERSION, MEDIA_TTL_MS } from './media-policy.mjs';
import { parseDraft } from './draft-contract.mjs';
export const MEDIA_LEASE_MS=120_000;
export const mediaId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export const mediaNow=v=>Number.isSafeInteger(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER-MEDIA_TTL_MS*31;
export const PROVIDERS=Object.freeze({'workers-ai-whisper-v1':'Cloudflare Workers AI','google-vision-v1':'Google Cloud Vision','cloudflare-whisper-google-vision-v1':'Cloudflare Workers AI (เสียง) และ Google Cloud Vision (ภาพ)'});
export class MediaError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
export const reject=(code,status=400)=>{throw new MediaError(code,status);};
export const stmt=(db,sql,args=[])=>db.prepare(sql).bind(...args);
export const checked=r=>{if(r?.success!==true)throw new MediaError('MEDIA_STORAGE_UNAVAILABLE',503);return r;};
export async function all(db,sql,args=[]){const r=checked(await stmt(db,sql,args).all());if(!Array.isArray(r.results))reject('MEDIA_STORAGE_UNAVAILABLE',503);return r.results;}
export async function batch(db,statements){const r=await db.batch(statements);if(!Array.isArray(r)||r.length!==statements.length)reject('MEDIA_STORAGE_UNAVAILABLE',503);r.forEach(checked);return r;}
export const ownerSQL=`EXISTS(SELECT 1 FROM patients p JOIN care_members m ON m.patient_id=p.id
  JOIN accounts a ON a.actor_id=m.actor_id WHERE p.id=? AND p.owner_actor_id=? AND m.actor_id=?
  AND m.role='owner' AND p.revoked_at IS NULL AND m.revoked_at IS NULL AND a.blocked_at IS NULL)`;
export const ownerArgs=(p,a)=>[p,a,a];
export async function requireMediaOwner(db,patientId,actorId){
  if(!mediaId(patientId)||!mediaId(actorId))reject('MEDIA_NOT_FOUND',404);
  const r=await all(db,`SELECT current_version FROM care_schedules WHERE patient_id=? AND ${ownerSQL}`,[patientId,...ownerArgs(patientId,actorId)]);
  if(r.length!==1)reject('MEDIA_NOT_FOUND',404);return r[0].current_version;
}
export const liveJobSQL=`EXISTS(SELECT 1 FROM media_consents c JOIN patients p ON p.id=c.patient_id
  JOIN care_members m ON m.patient_id=p.id AND m.actor_id=c.actor_id JOIN accounts a ON a.actor_id=c.actor_id
  WHERE c.patient_id=media_jobs.patient_id AND c.actor_id=media_jobs.actor_id AND c.generation=media_jobs.consent_generation
  AND c.provider_id=media_jobs.provider_id AND c.version='${MEDIA_CONSENT_VERSION}' AND c.revoked_at IS NULL
  AND c.expires_at>? AND c.granted_at<=media_jobs.source_at AND p.revoked_at IS NULL
  AND p.owner_actor_id=c.actor_id AND m.role='owner' AND m.revoked_at IS NULL AND a.blocked_at IS NULL)`;

export async function grantMediaConsent(db,{patientId,actorId,providerId,now}){
  if(!mediaNow(now)||!PROVIDERS[providerId])reject('MEDIA_PROVIDER_NOT_CONFIGURED',503);
  await requireMediaOwner(db,patientId,actorId);const generation=crypto.randomUUID();
  const r=await all(db,`INSERT INTO media_consents(patient_id,actor_id,generation,version,provider_id,granted_at,expires_at,revoked_at)
    SELECT ?,?,?,?,?,?,?,NULL WHERE ${ownerSQL}
    ON CONFLICT(patient_id,actor_id) DO UPDATE SET generation=excluded.generation,version=excluded.version,
      provider_id=excluded.provider_id,granted_at=excluded.granted_at,expires_at=excluded.expires_at,revoked_at=NULL RETURNING generation`,
    [patientId,actorId,generation,MEDIA_CONSENT_VERSION,providerId,now,now+30*MEDIA_TTL_MS,...ownerArgs(patientId,actorId)]);
  if(r.length!==1)reject('MEDIA_FORBIDDEN',403);return {version:MEDIA_CONSENT_VERSION,provider:PROVIDERS[providerId],expiresAt:now+30*MEDIA_TTL_MS};
}
export async function sourceHash(actorId,messageId){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${actorId}\n${messageId}`)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
// Called only with events already verified by the LINE webhook. No client upload accepts message IDs.
export async function ingestMediaEvents(db,events,{now,providerId}){
  if(!mediaNow(now)||!PROVIDERS[providerId]||!Array.isArray(events)||events.length>20)reject('INVALID_MEDIA_EVENTS');
  // Validate the entire batch before any write; ignore unsupported/group messages.
  const selected=[];
  for(const e of events){
    if(e?.source?.type!=='user'||!/^U[0-9a-f]{32}$/.test(e.source.userId??''))continue;
    if(e.type==='unsend'){
      if(typeof e.unsend?.messageId!=='string'||!/^\d{1,128}$/.test(e.unsend.messageId))reject('INVALID_MEDIA_EVENT');
      selected.push({event:e,messageId:e.unsend.messageId,unsent:true});
    }else if(e.type==='message'&&['image','audio'].includes(e.message?.type)){
      if(typeof e.message.id!=='string'||!/^\d{1,128}$/.test(e.message.id)||!mediaNow(e.timestamp)||e.timestamp>now||now-e.timestamp>=MEDIA_TTL_MS||
        (e.message.type==='audio'&&(!Number.isInteger(e.message.duration)||e.message.duration<1||e.message.duration>60_000)))reject('INVALID_MEDIA_EVENT');
      selected.push({event:e,messageId:e.message.id,unsent:false});
    }
  }
  const statements=[];
  // Unsend first, including a same-batch out-of-order original event.
  for(const item of selected.sort((a,b)=>Number(b.unsent)-Number(a.unsent))){
    const e=item.event;const actors=await all(db,'SELECT actor_id FROM accounts WHERE line_user_id=?',[e.source.userId]);
    if(actors.length!==1)continue;const actorId=actors[0].actor_id;const hash=await sourceHash(actorId,item.messageId);
    if(item.unsent){
      statements.push(stmt(db,'INSERT INTO media_unsent VALUES(?,?) ON CONFLICT(source_hash) DO UPDATE SET expires_at=MAX(expires_at,excluded.expires_at)',[hash,now+MEDIA_TTL_MS]));
      statements.push(stmt(db,`UPDATE media_jobs SET unsent_at=?,state=CASE WHEN state='confirmed' THEN state ELSE 'cancelled' END,
        draft_json=NULL,message_id=NULL,last_code='SOURCE_UNSENT',updated_at=? WHERE source_hash=?`,[now,now,hash]));
      statements.push(stmt(db,'DELETE FROM media_reviews WHERE job_id IN (SELECT id FROM media_jobs WHERE source_hash=?)',[hash]));
    }else{
      const id=crypto.randomUUID();
      statements.push(stmt(db,`INSERT INTO media_jobs(id,patient_id,actor_id,consent_generation,provider_id,source_hash,message_id,
        source_kind,source_at,expires_at,state,object_key,created_at,updated_at)
        SELECT ?,c.patient_id,c.actor_id,c.generation,c.provider_id,?,?,?, ?,MIN(?,c.expires_at),'queued',?,?,?
        FROM media_consents c JOIN patients p ON p.id=c.patient_id JOIN accounts a ON a.actor_id=c.actor_id
          JOIN care_members m ON m.patient_id=c.patient_id AND m.actor_id=c.actor_id
        WHERE c.actor_id=? AND c.provider_id=? AND c.version=? AND c.revoked_at IS NULL AND c.granted_at<=?
          AND c.expires_at>? AND p.revoked_at IS NULL AND p.owner_actor_id=c.actor_id AND a.blocked_at IS NULL
          AND m.role='owner' AND m.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM media_unsent WHERE source_hash=?)
        ON CONFLICT(source_hash) DO NOTHING`,[id,hash,item.messageId,e.message.type==='audio'?'voice':'printed_label',
        e.timestamp,e.timestamp+MEDIA_TTL_MS,`phase2/${id}`,now,now,actorId,providerId,MEDIA_CONSENT_VERSION,e.timestamp,now,hash]));
    }
  }
  if(statements.length)await batch(db,statements);
  return {handled:selected.length};
}

export async function dispatchMediaJobs(env,now){
  if(env.MEDIA_PROCESSING_ENABLED!=='true'||env.APP_ENV!=='staging')return {dispatched:0};
  const rows=await all(env.DB,`SELECT id FROM media_jobs WHERE (state='queued' OR (state='processing' AND lease_until<=?))
    AND dispatch_at<=? AND expires_at>? AND attempts<3 AND provider_id=? AND ${liveJobSQL} ORDER BY created_at LIMIT 10`,[now,now,now,env.MEDIA_PROVIDER_ID,now]);
  let dispatched=0;
  for(const row of rows){
    await env.MEDIA_QUEUE.send({jobId:row.id});
    checked(await stmt(env.DB,'UPDATE media_jobs SET dispatch_at=? WHERE id=?',[now+60_000,row.id]).run());dispatched++;
  }
  return {dispatched};
}
export async function claimMediaJob(db,id,now,providerId){
  if(!mediaId(id)||!mediaNow(now)||!PROVIDERS[providerId])reject('INVALID_MEDIA_JOB');
  const token=crypto.randomUUID();
  const r=await all(db,`UPDATE media_jobs SET state='processing',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
    WHERE id=? AND provider_id=? AND expires_at>? AND attempts<3 AND unsent_at IS NULL
    AND (state='queued' OR (state='processing' AND lease_until<=?)) AND ${liveJobSQL} RETURNING *`,[token,now+MEDIA_LEASE_MS,now,id,providerId,now,now,now]);
  return r[0]??null;
}
export async function mediaLeaseValid(db,job,now){
  return (await all(db,`SELECT id FROM media_jobs WHERE id=? AND lease_token=? AND state='processing' AND lease_until>?
    AND expires_at>? AND unsent_at IS NULL AND ${liveJobSQL}`,[job.id,job.lease_token,now,now,now])).length===1;
}
export async function saveMediaDraft(db,job,input,now){
  const parsed=parseDraft(input);if(!parsed.ok||parsed.draft.sourceKind!==job.source_kind)reject('INVALID_EXTRACTION');
  const r=await all(db,`UPDATE media_jobs SET state='awaiting_review',draft_json=?,lease_token=NULL,lease_until=NULL,updated_at=?,last_code=NULL
    WHERE id=? AND lease_token=? AND state='processing' AND lease_until>? AND expires_at>? AND unsent_at IS NULL AND ${liveJobSQL} RETURNING id`,
    [JSON.stringify(parsed.draft),now,job.id,job.lease_token,now,now,now]);
  return r.length===1;
}

export async function cleanupMedia(env,now){
  if(env.APP_ENV!=='staging'||env.MEDIA_API_ENABLED!=='true'||!mediaNow(now))return {deleted:0};
  await batch(env.DB,[stmt(env.DB,`UPDATE media_jobs SET state=CASE WHEN state IN ('confirmed','cancelled','failed') THEN state ELSE 'expired' END,
    draft_json=NULL,message_id=NULL,updated_at=? WHERE (state IN ('queued','processing','awaiting_review') OR draft_json IS NOT NULL OR message_id IS NOT NULL)
    AND (expires_at<=? OR NOT ${liveJobSQL})`,[now,now,now]),
    stmt(env.DB,`DELETE FROM media_reviews WHERE job_id IN (SELECT id FROM media_jobs WHERE state IN ('confirmed','cancelled','expired','failed') OR expires_at<=?)`,[now])]);
  const rows=await all(env.DB,`SELECT id,object_key FROM media_jobs WHERE (state IN ('confirmed','cancelled','expired','failed') OR expires_at<=?)
    AND (lease_until IS NULL OR lease_until<=?) ORDER BY updated_at,id LIMIT 20`,[now,now]);
  let failed=false;
  for(const row of rows){
    // Repeat deletion on later sweeps: a delayed external put cannot silently
    // orphan the random object key. Do not drop manifests before a rollout policy exists.
    try{
      await env.MEDIA_R2.delete(row.object_key);
      checked(await stmt(env.DB,'UPDATE media_jobs SET updated_at=? WHERE id=?',[now,row.id]).run());
    }catch{
      // A broken object must not prevent other eligible objects being erased.
      // Retain its manifest and surface only a fixed, private-data-free code.
      failed=true;
    }
  }
  if(failed)reject('MEDIA_CLEANUP_INCOMPLETE',503);
  return {deleted:rows.length};
}
