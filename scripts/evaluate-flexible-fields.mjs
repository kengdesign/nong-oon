import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {draftFromText} from '../src/media-extraction.mjs';
import {scoreFlexibleFields} from '../src/flexible-field-scoring.mjs';
const root=process.argv[2]??'acceptance-media/private/quality-corpus';
const read=p=>{if(statSync(p).size>65536)throw Error('INPUT_TOO_LARGE');return readFileSync(p,'utf8').replace(/^\uFEFF/u,'');};
const groups={};
for(const layout of ['blister','bottle','sachet','voice']){
 try{
  const folder=join(root,layout),reference=read(join(folder,'reference.txt')),gold=JSON.parse(read(join(folder,'field-gold.json')));
  const draft=JSON.parse(draftFromText(read(join(folder,'prediction.txt')),layout==='voice'?'voice':'printed_label'));
  groups[layout]={state:'scored',...scoreFlexibleFields(draft,gold,reference,{layout,blisterInstructionsAbsent:process.argv.includes('--blister-instructions-absent')})};
 }catch{groups[layout]={state:'blocked',code:'MISSING_INVALID_OR_STALE_INPUT'};}
}
const report={scope:'versioned_flexible_reference_coverage',groups,providerCalls:0,productionReady:false,
 productionBlockers:['REVISED_SCORING_POLICY_IS_NOT_NEW_EXTRACTION_ACCURACY','INDEPENDENT_HOLDOUT_AND_STAGING_ACCEPTANCE_REQUIRED']};
writeFileSync(join(root,'flexible-field-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(Object.values(groups).some(g=>g.state==='blocked'))process.exitCode=2;
