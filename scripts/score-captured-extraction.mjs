import {readFileSync,statSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {scoreExtraction} from '../src/extraction-scoring.mjs';
const root=process.argv[2]??'acceptance-media/private/quality-corpus';
const read=path=>{if(statSync(path).size>65536)throw Error('INPUT_TOO_LARGE');return readFileSync(path,'utf8').replace(/^\uFEFF/,'');};
const groups={};
for(const group of ['blister','bottle','sachet','voice']){
 try{
  const folder=join(root,group),draft=JSON.parse(read(join(folder,'extraction-reviewed-pipeline.json')));
  if(draft.sourceKind!==(group==='voice'?'voice':'printed_label'))throw Error('SOURCE_KIND_MISMATCH');
  const reviewPath=join(folder,'review.json'),fieldsPath=join(folder,'reference-fields.json');
  const score=scoreExtraction({draft,reference:read(join(folder,'reference.txt')),
   review:existsSync(reviewPath)?JSON.parse(read(reviewPath)):undefined,
   referenceFields:existsSync(fieldsPath)?JSON.parse(read(fieldsPath)):undefined});
  groups[group]={state:'scored',...score};
 }catch{groups[group]={state:'blocked',code:'MISSING_INVALID_OR_UNREVIEWED_INPUT'};}
}
const report={scope:'offline_extracted_text_and_independent_field_scores',providerCalls:0,
 threshold:{operator:'>',percent:80},groups,
 productionReady:false,productionBlockers:['TEXT_SIMILARITY_IS_NOT_FIELD_ACCURACY','INDEPENDENT_HOLDOUT_AND_END_TO_END_ACCEPTANCE_REQUIRED']};
try{writeFileSync(join(root,'extraction-score-report.json'),JSON.stringify(report,null,2));}
catch{console.error('REPORT_WRITE_FAILED');process.exit(2);}
console.log(JSON.stringify(report,null,2));
if(Object.values(groups).some(g=>g.state==='blocked'))process.exitCode=2;
