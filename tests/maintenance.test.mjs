import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/webhook.mjs';
import { handleScheduled, RETENTION_CRON } from '../src/maintenance.mjs';

const event={cron:RETENTION_CRON,scheduledTime:20};
const config={APP_ENV:'staging',RETENTION_ENABLED:'true'};
test('Worker scheduled entry deletes at most 100 expired rows per event using real SQL', async () => {
  assert.equal(worker.scheduled,handleScheduled);
  const sqlite=new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../migrations/0001_webhook_inbox.sql',import.meta.url),'utf8'));
    const insert=sqlite.prepare('INSERT INTO webhook_inbox VALUES (?,?,?,?,?,?,?)');
    for(let n=0;n<105;n++) insert.run('qa_'+n,'follow',0,null,null,0,20);
    insert.run('qa_future','follow',0,null,null,0,21);
    let calls=0;
    const DB={prepare(sql){return {bind(...args){return {async run(){
      calls++;return {success:true,meta:{changes:sqlite.prepare(sql).run(...args).changes}};
    }};}};}};
    const env={...config,DB};
    assert.deepEqual(await worker.scheduled(event,env),{deleted:100});
    assert.equal(calls,1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM webhook_inbox').get().n,6);
    assert.deepEqual(await worker.scheduled(event,env),{deleted:5});
    assert.equal(calls,2);
    assert.deepEqual(await worker.scheduled(event,env),{deleted:0});
    assert.equal(sqlite.prepare('SELECT event_id FROM webhook_inbox').get().event_id,'qa_future');
  } finally {sqlite.close();}
});
test('maintenance stays inert outside staging and when opt-in flag is absent or false', async () => {
  const DB={prepare(){assert.fail('must not touch DB');}};
  for(const env of [{},{...config,APP_ENV:'unknown'},{...config,RETENTION_ENABLED:'false'},{...config,RETENTION_ENABLED:undefined}])
    assert.deepEqual(await handleScheduled(event,{...env,DB}),{skipped:true});
});
test('invalid schedule events are rejected before SQL', async () => {
  const DB={prepare(){assert.fail('must not touch DB');}};
  for(const invalid of [null,{...event,cron:'* * * * *'},{...event,scheduledTime:-1},{...event,scheduledTime:1.5},{...event,scheduledTime:undefined}])
    await assert.rejects(handleScheduled(invalid,{...config,DB}),/INVALID_MAINTENANCE_EVENT/);
});
test('scheduled failures are sanitized and never retried within the invocation', async () => {
  let calls=0;
  const DB={prepare(){return {bind(){return {async run(){calls++;throw Error('private SQL contents');}};}};}};
  await assert.rejects(handleScheduled(event,{...config,DB}),error=>error.message==='RETENTION_RUN_FAILED');
  assert.equal(calls,1);
});
