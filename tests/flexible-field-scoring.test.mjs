import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreFlexibleFields,compareInstructions} from '../src/flexible-field-scoring.mjs';
import {referenceHash} from '../src/field-accuracy.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
const ref='synthetic';
const run=(text,fields,options={})=>scoreFlexibleFields(JSON.parse(draftFromText(text,'printed_label')),{humanReviewed:true,independentlyAnnotated:true,referenceSha256:referenceHash(ref),fields},ref,{layout:'bottle',...options});
test('approved Centrum title expansion passes flexible but preserves strict mismatch and review requirement',()=>{
 const r=run('Centrum Active Dietary Supplement',{drug_name:'Centrum'});
 assert.equal(r.flexibleAccuracyPercent,100);assert.equal(r.strictFieldAccuracyPercent,0);assert.equal(r.reviewRequired,true);assert.equal(r.productionReady,false);
 for(const name of ['Centrum Silver','Centrum Active XR','NotCentrum Active'])assert.equal(run('ชื่อยา: '+name,{drug_name:'Centrum'}).flexibleAccuracyPercent,0);
});
test('absent-by-design requires explicit source policy and excludes rather than awards credit',()=>{
 const fields={drug_name:'Example',instructions:'invented'};
 const original=JSON.stringify(fields);
 assert.equal(run('ชื่อยา: Example',fields,{layout:'blister'}).flexibleAccuracyPercent,50);
 const r=run('ชื่อยา: Example',fields,{layout:'blister',blisterInstructionsAbsent:true});
 assert.equal(r.flexibleAccuracyPercent,100);assert.equal(r.fields.instructions.accuracyPercent,null);assert.equal(r.strictFieldAccuracyPercent,50);assert.equal(JSON.stringify(fields),original);
 const falsePositive=run('ชื่อยา: Example\nวิธีใช้: invented',fields,{layout:'blister',blisterInstructionsAbsent:true});
 assert.equal(falsePositive.fields.instructions.accuracyPercent,0);
});
test('bounded instruction equivalence accepts Thai numbers and synonyms but rejects changed dose, frequency, negation, route or timing',()=>{
 assert.equal(compareInstructions('รับประทานครั้งละสองแคปซูล วันละหนึ่งครั้ง','รับทานครั้งละ2แคปซูลวันละ1ครั้ง').match,true);
 for(const actual of ['รับประทานครั้งละ3แคปซูลวันละ1ครั้ง','รับประทานครั้งละ2แคปซูลวันละ2ครั้ง','ห้ามรับประทานครั้งละ2แคปซูลวันละ1ครั้ง','ใช้ภายนอกครั้งละ2แคปซูลวันละ1ครั้ง'])assert.equal(compareInstructions('รับประทานครั้งละ2แคปซูลวันละ1ครั้ง',actual).match,false);
 assert.equal(compareInstructions('รับประทานก่อนอาหาร','รับประทานหลังอาหาร').match,false);
 assert.deepEqual(compareInstructions('รับประทานครั้งละ2แคปซูลวันละ1ครั้ง','รับทานครั้งละสองแคปซูลวันละหนึ่งครั้งก่อนนอน'),{match:true,reason:'REFERENCE_COVERED_WITH_ADDITIONAL_TIMING',requiresReview:true});
});
test('all unknown or absent fields cannot produce a numerical pass; stale gold is rejected',()=>{
 const r=run('unknown',{drug_name:null,strength:null,instructions:null});assert.equal(r.flexibleAccuracyPercent,null);assert.equal(r.above80,null);
 assert.throws(()=>scoreFlexibleFields(JSON.parse(draftFromText('unknown','voice')),{humanReviewed:true,independentlyAnnotated:true,referenceSha256:'bad',fields:{}},ref,{layout:'voice'}));
});
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
test('four-layout CLI preserves gold and source and prints only aggregate values',()=>{
 const root=mkdtempSync(join(tmpdir(),'flexible-fields-'));
 try{
  for(const group of ['blister','bottle','sachet','voice']){
   const folder=join(root,group);mkdirSync(folder);
   const text='ชื่อยา: PRIVATE_SYNTHETIC\nความแรง: 20 mg';
   const gold={humanReviewed:true,independentlyAnnotated:true,referenceSha256:referenceHash(text),fields:{drug_name:'PRIVATE_SYNTHETIC',strength:'20 mg',instructions:null}};
   writeFileSync(join(folder,'reference.txt'),text);writeFileSync(join(folder,'prediction.txt'),text);writeFileSync(join(folder,'field-gold.json'),JSON.stringify(gold));
  }
  const goldBefore=readFileSync(join(root,'blister','field-gold.json'),'utf8');
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/evaluate-flexible-fields.mjs',import.meta.url)),root,'--blister-instructions-absent'],{encoding:'utf8'});
  assert.equal(run.status,0);assert.doesNotMatch(run.stdout,/PRIVATE_SYNTHETIC|20 mg/);
  const report=JSON.parse(run.stdout);assert.equal(report.providerCalls,0);assert.equal(report.productionReady,false);
  for(const result of Object.values(report.groups))assert.equal(result.flexibleAccuracyPercent,100);
  assert.equal(readFileSync(join(root,'blister','field-gold.json'),'utf8'),goldBefore);
 }finally{rmSync(root,{recursive:true,force:true});}
});
