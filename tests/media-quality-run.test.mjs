import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
test('image retry archives failure, preserves voice and blocks successful replay',async()=>{
  const root=mkdtempSync(join(tmpdir(),'oon-quality-')),folder=join(root,'acceptance-media/private');
  mkdirSync(folder,{recursive:true});writeFileSync(join(root,'acceptance-media/.dev.vars'),'ACCEPTANCE_TOKEN="abc123"');
  writeFileSync(join(folder,'image.jpg'),'123456789012');writeFileSync(join(folder,'image.txt'),'synthetic');
  const failed={state:'failed',code:'SAMPLE_OR_PROVIDER_REJECTED'};
  writeFileSync(join(folder,'image.attempt.json'),JSON.stringify(failed));
  const voice='{"kind":"voice","screen":"needs_review"}';writeFileSync(join(folder,'voice.attempt.json'),voice);
  writeFileSync(join(folder,'aggregate-report.json'),'old report');
  let calls=0;const server=createServer((req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer abc123');let body='';req.on('data',c=>body+=c);req.on('end',()=>{assert.equal(JSON.parse(body).kind,'image');res.setHeader('content-type','application/json');res.end(JSON.stringify({kind:'image',screen:'passed',pilotReady:false}));});});
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(8798,'127.0.0.1',ok);});
  const run=()=>new Promise(ok=>{const p=spawn(process.execPath,[resolve('scripts/media-quality-run.mjs'),'--kind','image','--retry-failed'],{cwd:root,stdio:'ignore'});p.on('exit',ok);});
  try{
    assert.equal(await run(),0);assert.equal(calls,1);assert.equal(readFileSync(join(folder,'voice.attempt.json'),'utf8'),voice);
    const archived=readdirSync(folder).filter(n=>n.startsWith('image.attempt.json.')&&n.endsWith('.previous.json'));
    assert.equal(archived.length,1);assert.deepEqual(JSON.parse(readFileSync(join(folder,archived[0]))),failed);
    assert.ok(readdirSync(folder).some(n=>n.startsWith('aggregate-report.')&&n.endsWith('.previous.json')));
    assert.equal(await run(),1);assert.equal(calls,1);
  }finally{await new Promise(ok=>server.close(ok));rmSync(root,{recursive:true,force:true});}
});
