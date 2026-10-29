import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {mediaFixture,mediaEvent,owner,png} from '../tests/helpers/media.mjs';
import {cleanupMedia,ingestMediaEvents,MEDIA_LEASE_MS} from '../src/media-store.mjs';

export async function runCleanupAcceptance({remote=false}={}){
  const f=await mediaFixture(),prefix=`acceptance/${randomUUID()}/`,keys=[];
  const directory=remote?mkdtempSync(join(tmpdir(),'nong-oon-cleanup-')):null;
  function cli(args){
    const argv=['--yes','wrangler@4.154.0',...args,'--remote','--config','acceptance-media/r2.jsonc'];
    let result;
    if(process.platform==='win32'){
      if(argv.some(a=>/["%!&|<>^\r\n]/.test(a)))throw Error('UNSAFE_CLI_ARGUMENT');
      result=spawnSync('cmd.exe',['/d','/s','/c','npx.cmd '+argv.map(a=>'"'+a+'"').join(' ')],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
    }else result=spawnSync('npx',argv,{encoding:'utf8',maxBuffer:1024*1024});
    return {status:result.status,text:(result.stdout??'')+(result.stderr??'')};
  }
  const r2=remote?{
    async put(key,bytes){const file=join(directory,'upload.bin');writeFileSync(file,bytes);const r=cli(['r2','object','put',`nong-oon-media-drill/${key}`,'--file',file]);if(r.status!==0)throw Error('R2_PUT_FAILED');},
    async delete(key){if(!key.startsWith(prefix))throw Error('FOREIGN_KEY_REJECTED');const r=cli(['r2','object','delete',`nong-oon-media-drill/${key}`]);if(r.status!==0)throw Error('R2_DELETE_FAILED');},
    async get(key){const file=join(directory,'download.bin');rmSync(file,{force:true});const r=cli(['r2','object','get',`nong-oon-media-drill/${key}`,'--file',file]);if(r.status===0)return {bytes:readFileSync(file)};
      if(/NoSuchKey|specified key does not exist|object does not exist|object not found/i.test(r.text))return null;throw Error('R2_ABSENCE_NOT_VERIFIED');}
  }:f.env.MEDIA_R2;
  const env={...f.env,MEDIA_R2:r2};
  const results=[];
  async function absent(key){assert.equal(await r2.get(key),null);}
  async function add(id){await ingestMediaEvents(f.db,[mediaEvent(f.now,id)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});const job=f.sql.prepare('SELECT * FROM media_jobs WHERE message_id=?').get(id);
    const key=prefix+id+'.bin';keys.push(key);f.sql.prepare('UPDATE media_jobs SET object_key=? WHERE id=?').run(key,job.id);await r2.put(key,png());return {...job,object_key:key};}
  try{
    const expired=await add('7001'),active=await add('7002');
    f.sql.prepare("UPDATE media_jobs SET expires_at=?,state='awaiting_review',draft_json=? WHERE id=?").run(f.now+1,'{}',expired.id);
    await cleanupMedia(env,f.now+2);
    const row=f.sql.prepare('SELECT state,draft_json,message_id FROM media_jobs WHERE id=?').get(expired.id);
    assert.deepEqual({...row},{state:'expired',draft_json:null,message_id:null});await absent(expired.object_key);assert.ok(await r2.get(active.object_key));
    results.push('expiry_erases_payload_and_object_active_preserved');
    const leased=await add('7003');f.sql.prepare("UPDATE media_jobs SET state='cancelled',lease_until=? WHERE id=?").run(f.now+MEDIA_LEASE_MS,leased.id);
    await cleanupMedia(env,f.now+1);assert.ok(await r2.get(leased.object_key));
    await cleanupMedia(env,f.now+MEDIA_LEASE_MS+1);await absent(leased.object_key);results.push('live_lease_wait_then_delete');
    // Consent revocation uses the application's live-job permission checks/triggers.
    f.sql.prepare('UPDATE media_consents SET revoked_at=? WHERE actor_id=?').run(f.now+2,owner);
    await cleanupMedia(env,f.now+MEDIA_LEASE_MS+2);await absent(active.object_key);results.push('consent_revocation_deletes_object');
    await r2.put(expired.object_key,png());
    await assert.rejects(cleanupMedia({...env,MEDIA_R2:{async delete(){throw Error('injected');}}},f.now+MEDIA_LEASE_MS+3));
    assert.ok(await r2.get(expired.object_key));await cleanupMedia(env,f.now+MEDIA_LEASE_MS+4);await absent(expired.object_key);
    await r2.put(expired.object_key,png());await cleanupMedia(env,f.now+MEDIA_LEASE_MS+5);await absent(expired.object_key);results.push('delete_failure_retry_and_late_write_sweep');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);
    return {state:'passed',checks:results,storage:remote?'real_R2_drill_bucket':'in_memory',database:'real_SQLite_D1_adapter',cleanup:'src/media-store.mjs cleanupMedia',liveD1CronVerified:false,metadataManifestsRetained:true,pilotReady:false};
  }finally{
    // Only this run's unique keys, never a bucket-wide delete.
    try{for(const key of keys)await r2.delete(key);}finally{f.close();if(directory)rmSync(directory,{recursive:true,force:true});}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await runCleanupAcceptance({remote:process.argv.includes('--remote-r2')}),null,2));}catch{console.error('CLEANUP_ACCEPTANCE_FAILED: do not mark pilot ready');process.exitCode=1;}
}
