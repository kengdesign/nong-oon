import {readFileSync,statSync} from 'node:fs';
import {assessSample} from '../acceptance-media/assessment.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
// Private local input only. No fetch, provider, DB, R2, LINE or raw output.
try{
  const path=process.argv[2];if(!path||statSync(path).size>65536)throw Error();
  const input=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
  if(!['printed_label','voice'].includes(input.sourceKind)||typeof input.reference!=='string'||typeof input.predictedTranscript!=='string'||input.reference.length>1024||input.predictedTranscript.length>1024)throw Error();
  const result=assessSample({...input,predictedDraft:JSON.parse(draftFromText(input.predictedTranscript,input.sourceKind))});
  console.log(JSON.stringify({route:'offline_only',providerCalls:0,...result},null,2));
}catch{console.log(JSON.stringify({state:'blocked',code:'INVALID_OFFLINE_ASSESSMENT',providerCalls:0,pilotReady:false}));process.exitCode=1;}
