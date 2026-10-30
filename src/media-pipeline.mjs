import { mediaEnvironment } from './app-environment.mjs';
import {createMediaInfer} from './media-providers.mjs';
import { all,batch,stmt,checked,MediaError,mediaId,claimMediaJob,mediaLeaseValid,saveMediaDraft,dispatchMediaJobs,cleanupMedia } from './media-store.mjs';
const MAX_BYTES=5*1024*1024;
const fail=code=>{throw new MediaError(code,422);};
function sniff(bytes,kind,type){
  const ascii=(from,to)=>String.fromCharCode(...bytes.slice(from,to));
  if(kind==='printed_label')return (type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||
    (type==='image/png'&&bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')||
    (type==='image/webp'&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP');
  return (['audio/mp4','audio/x-m4a'].includes(type)&&ascii(4,8)==='ftyp')||
    (type==='audio/ogg'&&ascii(0,4)==='OggS')||
    (type==='audio/wav'&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE')||
    (type==='audio/mpeg'&&(ascii(0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224)));
}
export async function readLineMedia(messageId,kind,token,{fetcher=fetch}={}){
  if(!/^\d{1,128}$/.test(messageId??'')||!['voice','printed_label'].includes(kind)||typeof token!=='string'||!token.trim())fail('MEDIA_NOT_CONFIGURED');
  let response;
  try{response=await fetcher(`https://api-data.line.me/v2/bot/message/${messageId}/content`,{
    headers:{authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(10_000)});}catch{fail('MEDIA_DOWNLOAD_RETRY');}
  if(response.status!==200){await response.body?.cancel();fail(response.status===202||response.status>=500?'MEDIA_DOWNLOAD_RETRY':'MEDIA_DOWNLOAD_REJECTED');}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES)){await response.body?.cancel();fail('MEDIA_TOO_LARGE');}
  const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!response.body)fail('MEDIA_EMPTY');
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>MAX_BYTES){await reader.cancel();fail('MEDIA_TOO_LARGE');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  if(size<12||!sniff(bytes,kind,type))fail('MEDIA_FORMAT_REJECTED');
  return {bytes,type};
}

// infer is a server-installed adapter (tests inject a deterministic fake).
// Provider calls additionally require an explicit provider gate and bindings.
export async function processMediaJob(env,jobId,{clock=Date.now,fetcher=fetch,infer}={}){
  if(!mediaEnvironment(env)||env.MEDIA_PROCESSING_ENABLED!=='true'||env.MEDIA_API_ENABLED!=='true')return {outcome:'disabled'};
  if(!mediaId(jobId))return {outcome:'invalid'};
  infer??=createMediaInfer(env,{fetcher});
  if(typeof infer!=='function')return {outcome:'provider_not_ready'};
  const job=await claimMediaJob(env.DB,jobId,clock(),env.MEDIA_PROVIDER_ID);
  if(!job)return {outcome:'not_claimed'};
  try{
    if(!await mediaLeaseValid(env.DB,job,clock()))return {outcome:'revoked'};
    const media=await readLineMedia(job.message_id,job.source_kind,env.LINE_CHANNEL_ACCESS_TOKEN,{fetcher});
    if(!await mediaLeaseValid(env.DB,job,clock()))return {outcome:'revoked'};
    await env.MEDIA_R2.put(job.object_key,media.bytes,{httpMetadata:{contentType:media.type,cacheControl:'private, no-store'}});
    if(!await mediaLeaseValid(env.DB,job,clock()))return {outcome:'revoked'};
    checked(await stmt(env.DB,'UPDATE media_jobs SET content_type=? WHERE id=? AND lease_token=?',[media.type,job.id,job.lease_token]).run());
    const output=await infer({bytes:media.bytes,contentType:media.type,sourceKind:job.source_kind,
      providerId:job.provider_id,signal:AbortSignal.timeout(30_000)});
    if(!await mediaLeaseValid(env.DB,job,clock()))return {outcome:'revoked'};
    return {outcome:await saveMediaDraft(env.DB,job,output,clock())?'awaiting_review':'revoked'};
  }catch(error){
    const code=error instanceof MediaError?error.code:'MEDIA_PROCESSING_FAILED';
    const retry=code==='MEDIA_DOWNLOAD_RETRY'&&job.attempts<3;
    await all(env.DB,`UPDATE media_jobs SET state=?,last_code=?,draft_json=NULL,lease_token=NULL,lease_until=NULL,
      dispatch_at=?,updated_at=? WHERE id=? AND lease_token=? AND state='processing' RETURNING id`,
      [retry?'queued':'failed',code,clock()+60_000,clock(),job.id,job.lease_token]);
    return {outcome:retry?'retry':'failed',code};
  }finally{
    // No further R2 writes can originate from this invocation after it settles.
    checked(await stmt(env.DB,'UPDATE media_jobs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',[job.id,job.lease_token]).run());
  }
}
export async function handleMediaQueue(batchMessages,env,options={}){
  for(const message of batchMessages.messages){
    if(!message.body||Object.keys(message.body).join(',')!=='jobId'||!mediaId(message.body.jobId)){message.ack();continue;}
    try{
      const r=await processMediaJob(env,message.body.jobId,options);
      if(['disabled','provider_not_ready','retry'].includes(r.outcome))message.retry({delaySeconds:60});else message.ack();
    }catch{message.retry({delaySeconds:60});}
  }
}
export async function recoverMedia(env,now){
  if(env.MEDIA_API_ENABLED!=='true'||!mediaEnvironment(env))return {disabled:true};
  await batch(env.DB,[stmt(env.DB,`UPDATE media_jobs SET state='failed',last_code='MEDIA_ATTEMPTS_EXHAUSTED',draft_json=NULL,message_id=NULL,
    updated_at=? WHERE state IN ('queued','processing') AND attempts>=3 AND (lease_until IS NULL OR lease_until<=?)`,[now,now])]);
  const cleanup=await cleanupMedia(env,now);const dispatch=await dispatchMediaJobs(env,now);
  return {...cleanup,...dispatch};
}
