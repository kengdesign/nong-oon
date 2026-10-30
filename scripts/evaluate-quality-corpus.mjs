import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {assessSample} from '../acceptance-media/assessment.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
const root='acceptance-media/private/quality-corpus';
const read=p=>{if(statSync(p).size>65536)throw Error();return readFileSync(p,'utf8').replace(/^\uFEFF/,'');};
const groups={};
for(const layout of ['blister','bottle','sachet','voice']){
 try{
  const folder=`${root}/${layout}`,reference=read(`${folder}/reference.txt`),predictedTranscript=read(`${folder}/prediction.txt`),review=JSON.parse(read(`${folder}/review.json`));
  if(!reference.trim()||!predictedTranscript.trim()||review.humanReviewed!==true||review.scope!=='full')throw Error();
  const sourceKind=layout==='voice'?'voice':'printed_label';
  groups[layout]={state:'evaluated',...assessSample({reference,predictedTranscript,review,sourceKind,predictedDraft:JSON.parse(draftFromText(predictedTranscript,sourceKind))})};
 }catch{groups[layout]={state:'blocked',code:'MISSING_OR_UNREVIEWED_INPUT'};}
}
const report={scope:'offline_human_gold_corpus',providerCalls:0,liveProviderVerified:false,groups,pilotReady:false};
writeFileSync(`${root}/aggregate-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(Object.values(groups).some(g=>g.state==='blocked'))process.exitCode=2;
