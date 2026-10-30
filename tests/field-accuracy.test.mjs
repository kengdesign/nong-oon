import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFromText} from '../src/media-extraction.mjs';
import {parseLabelledReference,scoreFields,referenceHash,extractedFields} from '../src/field-accuracy.mjs';
const ref='ชื่อยา: Example\nความแรง: 20 mg\nวิธีใช้: หลังอาหาร';
const draft=()=>JSON.parse(draftFromText(ref,'printed_label'));
const gold=()=>({humanReviewed:true,independentlyAnnotated:true,referenceSha256:referenceHash(ref),fields:parseLabelledReference(ref)});
test('field score compares independent labelled gold, emits numeric per-field scores without raw content',()=>{
 const r=scoreFields(draft(),gold(),ref);assert.equal(r.fieldAccuracyPercent,100);assert.equal(r.above80,true);
 assert.equal(r.fields.instructions.accuracyPercent,100);assert.equal(r.productionReady,false);
 assert.doesNotMatch(JSON.stringify(r),/Example|20 mg|หลังอาหาร/);
});
test('missing field is wrong, absent gold is separate from positive field accuracy',()=>{
 const d=draft();d.items[0].fields.label={value:null,evidence:null};const r=scoreFields(d,gold(),ref);
 assert.equal(r.fieldAccuracyPercent,66.67);assert.equal(r.fields.drug_name.state,'missing');assert.equal(r.above80,false);
 const g=gold();g.fields.drug_name=null;const a=scoreFields(d,g,ref);assert.equal(a.positiveFieldAccuracyPercent,100);assert.equal(a.fields.drug_name.expectedAbsent,true);
 g.fields.strength=null;assert.equal(scoreFields(d,g,ref).falsePositives,1);
});
test('unlabelled reference never manufactures gold; duplicate labels fail; explicit JSON null supported',()=>{
 assert.deepEqual(parseLabelledReference('Example 20 mg หลังอาหาร'),{});
 assert.deepEqual(parseLabelledReference('{"drug_name":"Example","strength":null}'),{drug_name:'Example',strength:null});
 assert.throws(()=>parseLabelledReference('ชื่อยา: A\nlabel: B'));
});
test('unreviewed/stale gold blocked and unknown keys never inflate coverage',()=>{
 assert.throws(()=>scoreFields(draft(),{...gold(),humanReviewed:false},ref));
 assert.throws(()=>scoreFields(draft(),gold(),ref+' changed'));
 const g=gold();delete g.fields.strength;assert.equal(scoreFields(draft(),g,ref).above80,null);
 assert.equal(scoreFields(draft(),g,ref).coveragePercent,66.67);
 g.fields.extra='x';assert.throws(()=>scoreFields(draft(),g,ref));
});
test('fuzzy candidate remains a separate note and cannot score as a confirmed name',()=>{
 const d=JSON.parse(draftFromText('Bestatin 20\nRestatin 20\nSimvastatin 20 mg\nBestatin 20\nRestatin 20\nSimvastatin 20 mg','printed_label'));
 assert.equal(extractedFields(d).drug_name,null);assert.ok(d.items[0].notes.some(n=>n.kind==='name_candidate'));
 const g=gold();g.fields={drug_name:'BESTATIN 20'};assert.equal(scoreFields(d,g,ref).fieldAccuracyPercent,0);
});
test('a separate literal meal/bedtime line stays with instructions without inventing clock times',()=>{
 const d=JSON.parse(draftFromText('รับประทานครั้งละ 2 แคปซูล วันละ 1 ครั้ง\nก่อนนอน','printed_label'));
 assert.equal(extractedFields(d).instructions,'รับประทานครั้งละ 2 แคปซูล วันละ 1 ครั้ง ก่อนนอน');
 assert.equal(d.items[0].fields.times.value,null);
});
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
test('four-group CLI replays cached files, keeps references intact and reports no private values',()=>{
 const root=mkdtempSync(join(tmpdir(),'nongoon-fields-'));
 try{
  for(const group of ['blister','bottle','sachet','voice']){
   const folder=join(root,group);mkdirSync(folder);
   writeFileSync(join(folder,'reference.txt'),ref);writeFileSync(join(folder,'prediction.txt'),ref);
   writeFileSync(join(folder,'field-gold.json'),JSON.stringify(gold()));
  }
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/evaluate-extracted-fields.mjs',import.meta.url)),root],{encoding:'utf8'});
  assert.equal(run.status,0);assert.doesNotMatch(run.stdout,/Example|20 mg|หลังอาหาร/);
  const report=JSON.parse(readFileSync(join(root,'field-accuracy-report.json'),'utf8'));
  assert.equal(report.providerCalls,0);assert.equal(report.productionReady,false);
  for(const group of Object.keys(report.groups)){
   assert.equal(report.groups[group].fieldAccuracyPercent,100);
   assert.equal(readFileSync(join(root,group,'reference.txt'),'utf8'),ref);
  }
  writeFileSync(join(root,'voice','reference.txt'),ref+' changed');
  const stale=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/evaluate-extracted-fields.mjs',import.meta.url)),root],{encoding:'utf8'});
  assert.equal(stale.status,2);assert.equal(JSON.parse(stale.stdout).groups.voice.state,'blocked');
 }finally{rmSync(root,{recursive:true,force:true});}
});
