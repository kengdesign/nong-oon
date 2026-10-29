import {cleanupMedia} from '../src/media-store.mjs';
const expired='acceptance/main-cleanup/expired.bin',active='acceptance/main-cleanup/active.bin';
export async function sweep(env){
  if(env.CLEANUP_ACCEPTANCE_ENABLED!=='true')return;
  const receipt=await env.DB.prepare('SELECT state FROM acceptance_cleanup_receipt WHERE id=1').first();if(receipt?.state!=='pending')return;
  // Never let the shared function operate on any unrelated jobs.
  const jobs=await env.DB.prepare('SELECT object_key FROM media_jobs').all();
  if(jobs.results?.length!==2||jobs.results.some(j=>![expired,active].includes(j.object_key)))throw Error('ISOLATION_CHECK_FAILED');
  await env.MEDIA_R2.put(expired,'SYNTHETIC ONLY');await env.MEDIA_R2.put(active,'SYNTHETIC ONLY');
  await cleanupMedia({...env,APP_ENV:'staging',MEDIA_API_ENABLED:'true'},Date.now());
  const row=await env.DB.prepare('SELECT state,draft_json,message_id FROM media_jobs WHERE object_key=?').bind(expired).first();
  if(row?.state!=='expired'||row.draft_json!==null||row.message_id!==null||await env.MEDIA_R2.head(expired)||!await env.MEDIA_R2.head(active))throw Error('CLEANUP_NOT_VERIFIED');
  // Remove the preserved synthetic control only after observing it survived the sweep.
  await env.MEDIA_R2.delete(active);
  await env.DB.prepare("UPDATE acceptance_cleanup_receipt SET state='passed' WHERE id=1").run();
}
export default {fetch(){return new Response('Not found',{status:404});},scheduled(_event,env){return sweep(env);}};
