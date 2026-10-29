import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaInfer,providerReady,MAX_VISION_RESPONSE_BYTES} from '../src/media-providers.mjs';
import {draftFromText,recognizeVoiceCommand} from '../src/media-extraction.mjs';
import {parseDraft} from '../src/draft-contract.mjs';
import {mediaFixture,mediaEvent,png} from './helpers/media.mjs';
import {ingestMediaEvents} from '../src/media-store.mjs';
import {processMediaJob} from '../src/media-pipeline.mjs';
const input={bytes:png(),contentType:'image/png',sourceKind:'printed_label',providerId:'google-vision-v1',signal:AbortSignal.timeout(1000)};
const env={MEDIA_PROVIDER_ENABLED:'true',MEDIA_PROVIDER_ID:'google-vision-v1',GOOGLE_VISION_API_KEY:'synthetic-only'};
test('provider gates reject missing resources without network calls',()=>{
  for(const e of [{},env&&{...env,MEDIA_PROVIDER_ENABLED:'false'},{...env,GOOGLE_VISION_API_KEY:''},{...env,MEDIA_PROVIDER_ID:'unknown'}])assert.equal(createMediaInfer(e),undefined);
  assert.equal(providerReady({...env,MEDIA_PROVIDER_ID:'cloudflare-whisper-google-vision-v1'}),false);
});
test('OCR uses fixed endpoint, credential header and bounded untrusted output',async()=>{
  let calls=0;
  const infer=createMediaInfer(env,{fetcher:async(url,options)=>{
    calls++;assert.equal(url,'https://vision.googleapis.com/v1/images:annotate');assert.equal(options.redirect,'manual');
    assert.equal(options.headers['x-goog-api-key'],'synthetic-only');assert.equal(JSON.parse(options.body).requests[0].features[0].type,'DOCUMENT_TEXT_DETECTION');
    return Response.json({responses:[{fullTextAnnotation:{text:'ชื่อยา: SAMPLE\nความแรง: 5 mg\nจำนวนต่อครั้ง: 1 เม็ด\nเวลา: 08:00,18:00'}}]});}});
  const parsed=parseDraft(await infer(input));assert.equal(parsed.ok,true);assert.equal(parsed.draft.items[0].fields.dose.value,'1 เม็ด');assert.equal(calls,1);
  for(const response of [new Response('secret',{status:302}),Response.json({responses:[{error:{message:'secret'}}]}),new Response('x'.repeat(262145)),Response.json({responses:[{fullTextAnnotation:{text:'x'.repeat(8001)}}]})]){
    await assert.rejects(createMediaInfer(env,{fetcher:async()=>response})(input),e=>/^MEDIA_PROVIDER_/.test(e.message)&&!e.message.includes('secret'));
  }
  await assert.rejects(infer({...input,providerId:'workers-ai-whisper-v1'}),/MEDIA_PROVIDER_INPUT_REJECTED/);
});
test('voice binding uses Thai transcription, validates duration and redacts exceptions',async()=>{
  const e={MEDIA_PROVIDER_ENABLED:'true',MEDIA_PROVIDER_ID:'workers-ai-whisper-v1',AI:{async run(model,body){
    assert.equal(model,'@cf/openai/whisper-large-v3-turbo');assert.equal(body.language,'th');assert.equal(body.task,'transcribe');assert.equal(body.condition_on_previous_text,false);
    return {text:'ชื่อยา: SAMPLE',transcription_info:{duration:12}};}}};
  const audio={...input,contentType:'audio/mp4',sourceKind:'voice',providerId:e.MEDIA_PROVIDER_ID};
  assert.equal(parseDraft(await createMediaInfer(e)(audio)).draft.sourceKind,'voice');
  for(const duration of [undefined,0,61,NaN])await assert.rejects(createMediaInfer({...e,AI:{run:async()=>({text:'SAMPLE',transcription_info:{duration}})}})(audio),/MEDIA_AUDIO_DURATION_REJECTED/);
  await assert.rejects(createMediaInfer({...e,AI:{run:async()=>{throw Error('secret');}}})(audio),e=>e.message==='MEDIA_PROVIDER_FAILED');
  const controller=new AbortController();controller.abort();await assert.rejects(createMediaInfer(e)({...audio,signal:controller.signal}),/MEDIA_PROVIDER_FAILED/);
});
test('explicit extraction keeps unknowns, rejects conflicts and never infers pill dosage',()=>{
  let d=JSON.parse(draftFromText('กินหลังอาหารเช้า 1 เม็ด','voice'));assert.equal(d.items[0].fields.times.value,null);assert.equal(d.items[0].fields.dose.value,null);
  d=JSON.parse(draftFromText('ชื่อยา: A\nชื่อยา: B\nเวลา: 29:00\nวันที่เริ่ม: 2026-02-30','printed_label'));
  assert.equal(d.items[0].fields.label.value,null);assert.equal(d.items[0].fields.startDate.value,null);assert.ok(d.items[0].issues.includes('conflicting'));
  d=JSON.parse(draftFromText('เวลา: 08:00\nวิธีใช้: PRN เมื่อมีอาการ','printed_label'));assert.equal(d.items[0].fields.times.value,null);assert.equal(d.items[0].fields.useMode.value,'as_needed');
  assert.throws(()=>draftFromText('SAMPLE','pill_photo'));
});
test('voice command recognition is exact and cannot authorize a mutation',()=>{
  for(const text of ['ดูตารางวันนี้','ดูยาที่เหลือ','กินยาแล้ว','ยังไม่ได้กินยา','อย่าบันทึกว่ากินยาแล้ว','กินยาแล้วและหยุดยา','']){
    const r=recognizeVoiceCommand(text);assert.equal(r.assessment.mutationAllowed,false);
  }
  assert.equal(recognizeVoiceCommand('กินยาแล้ว').assessment.action,'clarify');
  assert.equal(recognizeVoiceCommand('อย่าบันทึกว่ากินยาแล้ว').command.intent,'unknown');
});
test('default queue pipeline invokes configured OCR and produces only an inactive draft',async()=>{
  const f=await mediaFixture();Object.assign(f.env,env);
  await ingestMediaEvents(f.db,[mediaEvent(f.now)],{now:f.now,providerId:env.MEDIA_PROVIDER_ID});
  const id=f.sql.prepare('SELECT id FROM media_jobs').get().id;
  const r=await processMediaJob(f.env,id,{clock:()=>f.now,fetcher:async(url)=>url.startsWith('https://api-data.line.me/')?new Response(png(),{headers:{'content-type':'image/png'}}):Response.json({responses:[{fullTextAnnotation:{text:'ชื่อยา: SAMPLE'}}]})});
  assert.equal(r.outcome,'awaiting_review');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n,0);f.close();
});

test('Vision response bound accepts exact limit and cancels oversized streams',async()=>{
  const text='ชื่อยา: SAMPLE';
  const body=JSON.stringify({responses:[{fullTextAnnotation:{text}}],padding:''});
  const exact=body.replace('"padding":""','"padding":"'+'x'.repeat(MAX_VISION_RESPONSE_BYTES-Buffer.byteLength(body))+'"');
  assert.equal(Buffer.byteLength(exact),MAX_VISION_RESPONSE_BYTES);
  assert.equal(parseDraft(await createMediaInfer(env,{fetcher:async()=>new Response(exact)})(input)).ok,true);
  let cancelled=false,observed=false;
  const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}});
  await assert.rejects(createMediaInfer(env,{fetcher:async()=>new Response(stream),onTranscript(){observed=true;}})(input),/MEDIA_PROVIDER_OUTPUT_REJECTED/);
  assert.equal(cancelled,true);assert.equal(observed,false);
});

test('image OCR text remains in protected draft payload for review, not inferred regimen',async()=>{
 const text='SYNTHETIC OCR ONLY\nSamplebrand 20 mg';
 const result=JSON.parse(await createMediaInfer(env,{fetcher:async()=>Response.json({responses:[{fullTextAnnotation:{text}}]})})(input));
 assert.equal(result.sourceText,text);assert.equal(parseDraft(JSON.stringify(result)).ok,true);
 assert.equal(result.items[0].fields.dose.value,null);assert.equal(result.items[0].fields.times.value,null);
});
