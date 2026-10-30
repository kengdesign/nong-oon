import {createMediaInfer} from '../src/media-providers.mjs';
import {assessSample} from './assessment.mjs';
// Raw output is opt-in on the private acceptance service only, never production.
export async function measureSample(env,input,{fetcher=fetch}={}){
  if(!input||!['image','voice'].includes(input.kind)||typeof input.reference!=='string'||!input.reference.trim()||Array.from(input.reference).length>1024||typeof input.base64!=='string'||input.base64.length>7000000)throw Error('INVALID_SAMPLE');
  let bytes;try{bytes=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0));}catch{throw Error('INVALID_SAMPLE');}
  const sourceKind=input.kind==='image'?'printed_label':'voice';
  const providerId=input.kind==='image'?'google-vision-v1':'workers-ai-whisper-v1';
  let transcript='';
  const configured={...env,MEDIA_PROVIDER_ENABLED:'true',MEDIA_PROVIDER_ID:providerId};
  const infer=createMediaInfer(configured,{fetcher,onTranscript:text=>{transcript=text;}});if(!infer)throw Error('PROVIDER_NOT_CONFIGURED');
  const predicted=JSON.parse(await infer({bytes,contentType:input.contentType,sourceKind,providerId,signal:AbortSignal.timeout(60000)}));
  return {kind:input.kind,providerCalls:1,...assessSample({reference:input.reference,predictedTranscript:transcript,predictedDraft:predicted,sourceKind,review:input.review}),...(env.QUALITY_PRIVATE_CAPTURE==='true'&&input.captureTranscript===true?{privateTranscript:transcript,privateDraft:predicted}:{})};
}
