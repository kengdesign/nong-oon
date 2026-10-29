import {createMediaInfer} from '../src/media-providers.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
import {evaluateMediaPredictions} from '../src/media-evaluation.mjs';
// One provider call per sample; capture output only in memory, never return it.
export async function measureSample(env,input,{fetcher=fetch}={}){
  if(!input||!['image','voice'].includes(input.kind)||typeof input.reference!=='string'||!input.reference.trim()||Array.from(input.reference).length>1024||typeof input.base64!=='string'||input.base64.length>7000000)throw Error('INVALID_SAMPLE');
  let bytes;try{bytes=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0));}catch{throw Error('INVALID_SAMPLE');}
  const sourceKind=input.kind==='image'?'printed_label':'voice';
  const providerId=input.kind==='image'?'google-vision-v1':'workers-ai-whisper-v1';
  let transcript='';
  const configured={...env,MEDIA_PROVIDER_ENABLED:'true',MEDIA_PROVIDER_ID:providerId};
  const infer=createMediaInfer(configured,{fetcher,onTranscript:text=>{transcript=text;}});if(!infer)throw Error('PROVIDER_NOT_CONFIGURED');
  const predicted=JSON.parse(await infer({bytes,contentType:input.contentType,sourceKind,providerId,signal:AbortSignal.timeout(60000)}));
  const referenceDraft=JSON.parse(draftFromText(input.reference,sourceKind));
  const metrics=evaluateMediaPredictions({version:1,cases:[{referenceTranscript:input.reference,predictedTranscript:transcript,referenceDraft,predictedDraft:predicted}]});
  const known=Object.entries(referenceDraft.items[0].fields).filter(([,v])=>v.value!==null).map(([k])=>k);
  const knownMatches=known.filter(k=>JSON.stringify(referenceDraft.items[0].fields[k].value)===JSON.stringify(predicted.items[0].fields[k].value)).length;
  // Explicit engineering screen only; never an automatic pilot approval.
  return {kind:input.kind,providerCalls:1,metrics:{...metrics,providerCalls:1},knownFields:known.length,knownMatches,fieldEvaluationAvailable:known.length>0,
    screen:metrics.codepointErrorRate<=0.05&&known.length>0&&knownMatches===known.length?'passed':'needs_review',pilotReady:false};
}
