import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {mediaFixture,mediaEvent,owner} from '../tests/helpers/media.mjs';
mkdirSync('acceptance-media/private',{recursive:true});
const f=await mediaFixture();
try{
  for(const id of ['8101','8102'])await (await import('../src/media-store.mjs')).ingestMediaEvents(f.db,[mediaEvent(f.now,id)],{now:f.now,providerId:f.env.MEDIA_PROVIDER_ID});
  f.sql.prepare('UPDATE media_consents SET granted_at=?').run(f.now-20000);
  f.sql.prepare("UPDATE media_jobs SET source_at=?,expires_at=?,state='awaiting_review',draft_json='{}',object_key='acceptance/main-cleanup/expired.bin' WHERE message_id='8101'").run(f.now-10000,f.now-5000);
  f.sql.prepare("UPDATE media_jobs SET object_key='acceptance/main-cleanup/active.bin' WHERE message_id='8102'").run();
  const quote=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
  let sql=readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort().map(n=>readFileSync('migrations/'+n,'utf8')).join('\n');
  for(const table of f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name)){
    if(!f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    for(const row of f.sql.prepare('SELECT * FROM '+table).all())sql+='\nINSERT OR IGNORE INTO '+table+'('+Object.keys(row).join(',')+') VALUES('+Object.values(row).map(quote).join(',')+');';
  }
  sql+='\nCREATE TABLE acceptance_cleanup_receipt (id INTEGER PRIMARY KEY,state TEXT NOT NULL);\nINSERT INTO acceptance_cleanup_receipt VALUES(1,\'pending\');\n';
  writeFileSync('acceptance-media/private/main-cleanup.sql',sql);
  writeFileSync('acceptance-media/private/main-cleanup.jsonc',JSON.stringify({name:'nong-oon-cleanup-acceptance',main:'../cleanup-worker.mjs',account_id:'c5f673e7bdf271485603029e19f42f49',compatibility_date:'2026-10-25',workers_dev:false,preview_urls:false,observability:{enabled:false},triggers:{crons:['* * * * *']},vars:{CLEANUP_ACCEPTANCE_ENABLED:'true'},d1_databases:[{binding:'DB',database_name:'nong-oon-media-drill',database_id:'f8d6fd36-0d75-45f9-9164-e2ed2225b9b0'}],r2_buckets:[{binding:'MEDIA_R2',bucket_name:'nong-oon-media-drill'}]},null,2));
  console.log('PREPARED: isolated drill DB only; no care DB or LINE bindings');
}finally{f.close();}
