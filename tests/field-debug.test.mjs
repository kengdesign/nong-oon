import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFromText} from '../src/media-extraction.mjs';
import {scoreFields,referenceHash} from '../src/field-accuracy.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const extract=(s,k='printed_label')=>JSON.parse(draftFromText(s,k));
test('literal herbal names are labels; indications, multiple herbs and explicit conflicts do not identify a single medicine',()=>{
 const d=extract('ใบมะขามแขกแคปซูล แทน SEI 20 แคปซูล');assert.equal(d.items[0].fields.label.value,'ใบมะขามแขกแคปซูล');assert.equal(d.items[0].fields.strength.value,null);
 for(const text of ['ยาแก้ท้องผูก','ใบมะขามแขกแคปซูล\nรากทดสอบผง','ชื่อยา: A\nชื่อยา: B\nใบมะขามแขกแคปซูล'])assert.equal(extract(text).items[0].fields.label.value,null);
});
test('voice instruction-only score is explicit and cannot hide full-field mismatches',()=>{
 const text='รับทานครั้งละสองแคปซูลก่อนนอน',d=extract(text,'voice');
 const gold={humanReviewed:true,independentlyAnnotated:true,referenceSha256:referenceHash(text),fields:{drug_name:'SYNTHETIC',strength:'20 mg',instructions:text}};
 const r=scoreFields(d,gold,text,{taskFields:['instructions']});assert.equal(r.taskAccuracyPercent,100);assert.equal(r.fieldAccuracyPercent,33.33);assert.equal(r.above80,false);assert.equal(r.productionReady,false);
 assert.throws(()=>scoreFields(d,gold,text,{taskFields:['extra']}));
});
test('private debug compares each field, escapes HTML, preserves reference, gold and baseline, and redacts console',()=>{
 const root=mkdtempSync(join(tmpdir(),'field-debug-'));
 try{
  const text='ชื่อยา: <script>alert(1)</script>\nความแรง: 20 mg\nวิธีใช้: ทดสอบ';
  for(const group of ['blister','bottle','sachet','voice']){
   const folder=join(root,group);mkdirSync(folder);const kind=group==='voice'?'voice':'printed_label';
   const gold={humanReviewed:true,independentlyAnnotated:true,referenceSha256:referenceHash(text),fields:{drug_name:'<script>alert(1)</script>',strength:'20 mg',instructions:'ทดสอบ'}};
   writeFileSync(join(folder,'reference.txt'),text);writeFileSync(join(folder,'prediction.txt'),text);writeFileSync(join(folder,'field-gold.json'),JSON.stringify(gold));
   writeFileSync(join(folder,'extraction-reviewed-pipeline.json'),JSON.stringify(extract(text,kind)));
  }
  const paths=['reference.txt','field-gold.json','extraction-reviewed-pipeline.json'];const before=paths.map(p=>readFileSync(join(root,'voice',p),'utf8'));
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/debug-extracted-fields.mjs',import.meta.url)),root],{encoding:'utf8'});
  assert.equal(run.status,0);assert.doesNotMatch(run.stdout,/alert|20 mg|ทดสอบ/);
  const report=JSON.parse(run.stdout);assert.equal(report.providerCalls,0);assert.equal(report.referenceModified,false);
  assert.deepEqual(paths.map(p=>readFileSync(join(root,'voice',p),'utf8')),before);
  const html=readFileSync(join(root,'field-comparison.private.html'),'utf8');assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
  const detail=JSON.parse(readFileSync(join(root,'voice','field-comparison.private.json'),'utf8'));assert.equal(detail.rows.length,3);assert.equal(detail.rows[0].reason,'EXACT_MATCH');
 }finally{rmSync(root,{recursive:true,force:true});}
});
