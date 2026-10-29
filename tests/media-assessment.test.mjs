import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSample} from '../acceptance-media/assessment.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
const text='ชื่อยา: SYNTHETIC';
const empty=()=>JSON.parse(draftFromText('synthetic','printed_label'));
const input={sourceKind:'printed_label',reference:text,predictedTranscript:text,predictedDraft:empty()};
test('unknown or partial scope cannot report transcript accuracy or pass',()=>{
  for(const review of [undefined,{scope:'unknown',humanReviewed:true},{scope:'partial',humanReviewed:true},{scope:'full',humanReviewed:false}]){
    const r=assessSample({...input,review});assert.equal(r.metrics,null);assert.equal(r.transcriptionScreen,'not_evaluated');assert.equal(r.screen,'needs_review');assert.equal(r.pilotReady,false);
  }
});
test('independent human gold catches missing extraction despite exact transcript',()=>{
  const gold=empty();gold.items[0].fields.label={value:'SYNTHETIC',evidence:'SYNTHETIC'};
  const r=assessSample({...input,review:{scope:'full',humanReviewed:true,referenceDraft:gold}});
  assert.equal(r.transcriptionScreen,'passed');assert.equal(r.fieldScreen,'needs_review');assert.equal(r.knownFields,1);assert.equal(r.knownMatches,0);
  const passed=assessSample({...input,predictedDraft:gold,review:{scope:'full',humanReviewed:true,referenceDraft:gold}});
  assert.equal(passed.screen,'passed');assert.equal(passed.pilotReady,false);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|ชื่อยา/);
});
test('transcript-only evidence cannot certify field extraction',()=>{
  const r=assessSample({...input,review:{scope:'full',humanReviewed:true}});
  assert.equal(r.metrics.codepointErrorRate,0);assert.equal(r.fieldScreen,'not_evaluated');assert.equal(r.screen,'needs_review');
});
test('wrong source or invalid independent gold rejects without exposing input',()=>{
  assert.throws(()=>assessSample({...input,review:{scope:'full',humanReviewed:true,referenceDraft:{secret:'SYNTHETIC'}}}),/INVALID_REFERENCE_DRAFT/);
  assert.throws(()=>assessSample({...input,review:{scope:'region'}}),/INVALID_REFERENCE_SCOPE/);
});
test('partial scope can evaluate fields independently without a misleading CER',()=>{
  const r=assessSample({...input,review:{scope:'partial',humanReviewed:true,referenceDraft:empty()}});
  assert.equal(r.metrics.codepointErrorRate,null);assert.equal(r.metrics.transcripts,0);assert.equal(r.screen,'needs_review');
});
