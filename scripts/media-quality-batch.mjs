import {readFileSync,statSync} from 'node:fs';
import {assessSample} from '../acceptance-media/assessment.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
// Local private inputs only. No network or mutation. Gold must be independently supplied.
try {
 const path=process.argv[2];
 if(!path||statSync(path).size>1024*1024)throw Error();
 const corpus=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
 if(!Array.isArray(corpus.cases)||corpus.cases.length<1||corpus.cases.length>100)throw Error();
 const groups={};
 for(const c of corpus.cases){
  if(!['blister','bottle','sachet','voice'].includes(c.layout))throw Error();
  if(c.sourceKind!==(c.layout==='voice'?'voice':'printed_label'))throw Error();
  if(typeof c.predictedTranscript!=='string'||Array.from(c.predictedTranscript).length>1024)throw Error();
  const result=assessSample({...c,predictedDraft:JSON.parse(draftFromText(c.predictedTranscript,c.sourceKind))});
  (groups[c.layout]??=[]).push(result);
 }
 console.log(JSON.stringify({route:'offline_batch',providerCalls:0,groups,pilotReady:false},null,2));
} catch {
 console.log(JSON.stringify({state:'blocked',code:'INVALID_QUALITY_CORPUS',providerCalls:0,pilotReady:false}));process.exitCode=1;
}
