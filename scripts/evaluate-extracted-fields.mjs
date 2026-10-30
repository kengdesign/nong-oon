import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {draftFromText} from '../src/media-extraction.mjs';
import {FIELD_NAMES,referenceHash,parseLabelledReference,extractedFields,scoreFields} from '../src/field-accuracy.mjs';
const root=process.argv[2]??'acceptance-media/private/quality-corpus',annotate=process.argv.includes('--annotate');
const read=p=>{if(statSync(p).size>65536)throw Error('INPUT_TOO_LARGE');return readFileSync(p,'utf8').replace(/^\uFEFF/u,'');};
const prompt=annotate?createInterface({input:process.stdin,output:process.stdout}):null,groups={};
try{
 for(const group of ['blister','bottle','sachet','voice']){
  try{
   const folder=join(root,group),reference=read(join(folder,'reference.txt')),goldPath=join(folder,'field-gold.json');
   if(!reference.trim()||reference.length>8192)throw Error('INVALID_REFERENCE');
   let gold;
   if(existsSync(goldPath))gold=JSON.parse(read(goldPath));
   if(annotate&&(!gold||gold.referenceSha256!==referenceHash(reference))){
    const labelled=parseLabelledReference(reference),fields={};
    console.log(`\n${group}: reference.txt (private, shown locally only)\n${reference}\n`);
    console.log('Enter gold from the SOURCE/reference, not prediction. - = explicitly absent; ? = unknown/unscored. Enter accepts labelled default only.');
    for(const key of FIELD_NAMES){
     const has=Object.hasOwn(labelled,key),preset=has?(labelled[key]??'-'):undefined;
     let answer;
     do{answer=(await prompt.question(`${key}${has?' ['+preset+']':''}: `)).trim();if(!answer&&has)answer=preset;}while(!answer||answer.length>500);
     if(answer!=='?')fields[key]=answer==='-'?null:answer;
    }
    // Saving gold occurs only after independent operator entry, before extraction.
    gold={humanReviewed:true,independentlyAnnotated:true,referenceSha256:referenceHash(reference),fields};
    writeFileSync(goldPath,JSON.stringify(gold,null,2));
   }
   if(!gold){groups[group]={state:'needs_annotation',code:'INDEPENDENT_FIELD_GOLD_REQUIRED'};continue;}
   const sourceKind=group==='voice'?'voice':'printed_label';
   const draft=JSON.parse(draftFromText(read(join(folder,'prediction.txt')),sourceKind));
   const score=scoreFields(draft,gold,reference);
   writeFileSync(join(folder,'extraction-reviewed-pipeline.json'),JSON.stringify(draft,null,2));
   writeFileSync(join(folder,'extracted-fields.private.json'),JSON.stringify({fields:extractedFields(draft),notes:draft.items[0].notes??[],issues:draft.items[0].issues},null,2));
   groups[group]={state:'scored',...score};
  }catch{groups[group]={state:'blocked',code:'INVALID_MISSING_OR_STALE_FIELD_INPUT'};}
 }
}finally{prompt?.close();}
const report={scope:'independent_human_field_accuracy',providerCalls:0,groups,productionReady:false};
writeFileSync(join(root,'field-accuracy-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(Object.values(groups).some(g=>g.state!=='scored'))process.exitCode=2;
