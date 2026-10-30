import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreExtraction} from '../src/extraction-scoring.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
const draft=text=>JSON.parse(draftFromText(text,'printed_label'));
const input=()=>({draft:draft('ชื่อยา: SYNTHETIC\nความแรง: 20 mg'),reference:'SYNTHETIC 20 mg',review:{humanReviewed:true,scope:'partial'}});
test('exact extracted text scores 100 and longer output remains bounded without provider calls',()=>{
 const r=scoreExtraction(input());assert.equal(r.textMatchPercent,100);assert.equal(r.textMatchAbove80,true);
 assert.equal(r.fieldAccuracyPercent,null);assert.equal(r.productionReady,false);assert.equal(r.providerCalls,0);
 assert.equal(scoreExtraction({...input(),reference:'x'}).textMatchPercent>=0,true);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|20 mg/);
});
test('unknown fields, absent annotation and unreviewed text never become verified accuracy',()=>{
 const r=scoreExtraction({draft:draft('unknown'),reference:'some text'});
 assert.equal(r.textMatchPercent,0);assert.equal(r.referenceReviewed,false);assert.equal(r.referenceScope,'unknown');
 assert.equal(r.fieldAccuracyAbove80,null);assert.equal(r.productionReady,false);
});
test('independent field annotation penalizes omitted fields and excludes unknown gold',()=>{
 const referenceDraft=draft('ชื่อยา: SYNTHETIC\nความแรง: 20 mg\nวิธีใช้: ทดสอบ');
 const r=scoreExtraction({...input(),referenceFields:{humanReviewed:true,independentlyAnnotated:true,draft:referenceDraft}});
 assert.equal(r.knownFields,3);assert.equal(r.matchedFields,2);assert.equal(r.fieldAccuracyPercent,66.67);
 assert.equal(r.fieldAccuracyAbove80,false);assert.equal(r.productionReady,false);
});
test('80 percent exactly does not pass the strictly greater-than threshold',()=>{
 const d=draft('ชื่อยา: abcde');const r=scoreExtraction({draft:d,reference:'abcdf'});
 assert.equal(r.textMatchPercent,80);assert.equal(r.textMatchAbove80,false);
});
test('catalog name suggestions never count as extracted names or field matches',()=>{
 const d=draft('Bestratin 20\nRestatin 20\nSimvastatin 20 mg\nBestratin 20\nRestatin 20\nSimvastatin 20 mg');
 assert.ok(d.items[0].notes.some(n=>n.kind==='name_candidate'));
 const gold=draft('ชื่อยา: BESTATIN 20\nความแรง: 20 mg');
 const r=scoreExtraction({draft:d,reference:'20 mg',referenceFields:{humanReviewed:true,independentlyAnnotated:true,draft:gold}});
 assert.equal(r.textMatchPercent,100);assert.equal(r.fieldAccuracyPercent,50);assert.equal(r.fields.label.matched,0);
});
test('NFC and whitespace normalization are explicit; malformed gold and oversized inputs fail closed',()=>{
 const d=draft('ชื่อยา: Café');assert.equal(scoreExtraction({draft:d,reference:'  Cafe\u0301  '}).textMatchPercent,100);
 for(const referenceFields of [{},{humanReviewed:false},{humanReviewed:true,independentlyAnnotated:true,draft:{}}])assert.throws(()=>scoreExtraction({...input(),referenceFields}));
 assert.throws(()=>scoreExtraction({...input(),reference:'x'.repeat(4097)}));
});

import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('CLI scores all four private layouts and writes aggregate-only report without changing references',()=>{
 const root=mkdtempSync(join(tmpdir(),'nongoon-score-'));
 try{
  for(const group of ['blister','bottle','sachet','voice']){
   const folder=join(root,group);mkdirSync(folder);
   const d=JSON.parse(draftFromText('ชื่อยา: PRIVATE_SYNTHETIC',group==='voice'?'voice':'printed_label'));
   writeFileSync(join(folder,'reference.txt'),'PRIVATE_SYNTHETIC');
   writeFileSync(join(folder,'extraction-reviewed-pipeline.json'),JSON.stringify(d));
  }
  const run=spawnSync(process.execPath,[new URL('../scripts/score-captured-extraction.mjs',import.meta.url).pathname,root],{encoding:'utf8'});
  assert.equal(run.status,0);assert.doesNotMatch(run.stdout,/PRIVATE_SYNTHETIC/);
  const report=JSON.parse(readFileSync(join(root,'extraction-score-report.json'),'utf8'));
  for(const group of Object.keys(report.groups)){
   assert.equal(report.groups[group].textMatchPercent,100);assert.equal(report.groups[group].fieldAccuracyPercent,null);
   assert.equal(readFileSync(join(root,group,'reference.txt'),'utf8'),'PRIVATE_SYNTHETIC');
  }
  assert.equal(report.productionReady,false);assert.equal(report.providerCalls,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('CLI records blocked groups with no raw exception, path or data leakage',()=>{
 const root=mkdtempSync(join(tmpdir(),'nongoon-score-'));
 try{
  const run=spawnSync(process.execPath,[new URL('../scripts/score-captured-extraction.mjs',import.meta.url).pathname,root],{encoding:'utf8'});
  assert.equal(run.status,2);const report=JSON.parse(run.stdout);
  assert.ok(Object.values(report.groups).every(g=>g.state==='blocked'));
  assert.doesNotMatch(run.stdout,/ENOENT|SyntaxError|nongoon-score-/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
