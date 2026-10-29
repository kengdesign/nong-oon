import {MediaError} from './media-store.mjs';
import {draftFromText} from './media-extraction.mjs';
const fail=code=>{throw new MediaError(code,422);};
const combined='cloudflare-whisper-google-vision-v1';
// Vision includes per-symbol geometry; a short label can exceed 256 KiB.
export const MAX_VISION_RESPONSE_BYTES=1024*1024;
const MODEL='@cf/openai/whisper-large-v3-turbo';
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function providerReady(env){
  if(env.MEDIA_PROVIDER_ENABLED!=='true')return false;
  if(env.MEDIA_PROVIDER_ID==='workers-ai-whisper-v1')return typeof env.AI?.run==='function';
  if(env.MEDIA_PROVIDER_ID==='google-vision-v1')return typeof env.GOOGLE_VISION_API_KEY==='string'&&env.GOOGLE_VISION_API_KEY.trim().length>0;
  return env.MEDIA_PROVIDER_ID===combined&&typeof env.AI?.run==='function'&&typeof env.GOOGLE_VISION_API_KEY==='string'&&env.GOOGLE_VISION_API_KEY.trim().length>0;
}
async function limitedJson(response){
  if(!response.ok){await response.body?.cancel();fail('MEDIA_PROVIDER_REJECTED');}
  if(!response.body)fail('MEDIA_PROVIDER_OUTPUT_REJECTED');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>MAX_VISION_RESPONSE_BYTES){await reader.cancel();fail('MEDIA_PROVIDER_OUTPUT_REJECTED');}chunks.push(r.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('MEDIA_PROVIDER_OUTPUT_REJECTED');}
}
function textOutput(text){if(typeof text!=='string'||!text.trim()||text.length>8000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))fail('MEDIA_PROVIDER_OUTPUT_REJECTED');return text.trim();}
export function createMediaInfer(env,{fetcher=fetch,onTranscript}={}){
  if(!providerReady(env))return undefined;
  return async({bytes,contentType,sourceKind,providerId,signal})=>{
    try{
      if(providerId!==env.MEDIA_PROVIDER_ID||!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>5*1024*1024)fail('MEDIA_PROVIDER_INPUT_REJECTED');
      signal?.throwIfAborted();let text;
      if(sourceKind==='voice'){
        if(!['workers-ai-whisper-v1',combined].includes(providerId)||!contentType.startsWith('audio/'))fail('MEDIA_PROVIDER_SOURCE_UNSUPPORTED');
        // Binding calls cannot reliably be cancelled. Await settlement before allowing lease cleanup.
        const result=await env.AI.run(MODEL,{audio:base64(bytes),task:'transcribe',language:'th',vad_filter:true,condition_on_previous_text:false});
        signal?.throwIfAborted();
        const duration=result?.transcription_info?.duration;
        if(typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||duration>60)fail('MEDIA_AUDIO_DURATION_REJECTED');
        text=textOutput(result.text);
      }else if(sourceKind==='printed_label'){
        if(!['google-vision-v1',combined].includes(providerId)||!['image/png','image/jpeg','image/webp'].includes(contentType))fail('MEDIA_PROVIDER_SOURCE_UNSUPPORTED');
        const response=await fetcher('https://vision.googleapis.com/v1/images:annotate',{
          method:'POST',redirect:'manual',signal,headers:{'content-type':'application/json','x-goog-api-key':env.GOOGLE_VISION_API_KEY},
          body:JSON.stringify({requests:[{image:{content:base64(bytes)},features:[{type:'DOCUMENT_TEXT_DETECTION'}],imageContext:{languageHints:['th','en']}}]})});
        const result=await limitedJson(response);
        if(!Array.isArray(result.responses)||result.responses.length!==1||result.responses[0].error)fail('MEDIA_PROVIDER_OUTPUT_REJECTED');
        text=textOutput(result.responses[0].fullTextAnnotation?.text);
      }else fail('MEDIA_PROVIDER_SOURCE_UNSUPPORTED');
      // Acceptance observes only validated, bounded text; never clone an unbounded response.
      const draft=draftFromText(text,sourceKind);
      if(onTranscript)onTranscript(text);
      return draft;
    }catch(error){if(error instanceof MediaError)throw error;fail('MEDIA_PROVIDER_FAILED');}
  };
}
