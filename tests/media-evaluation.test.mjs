import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMediaPredictions} from '../src/media-evaluation.mjs';
import {extraction} from './helpers/media.mjs';
test('Thai transcript metrics count deletions including negation and never report private text',()=>{
  const r=evaluateMediaPredictions({version:1,cases:[{referenceTranscript:'ยังไม่ได้ทาน',predictedTranscript:'ทาน'}]});
  assert.ok(r.editDistance>0);assert.ok(r.codepointErrorRate>0);assert.equal(r.providerCalls,0);
  assert.doesNotMatch(JSON.stringify(r),/ยังไม่ได้|ทาน/);
  assert.equal(evaluateMediaPredictions({version:1,cases:[{referenceTranscript:'',predictedTranscript:'invented'}]}).codepointErrorRate,null);
});
test('field metrics separate unknowns and item alignment; no semantic dose matching is invented',()=>{
  const gold=JSON.parse(extraction()),pred=structuredClone(gold);gold.items[0].fields.dose={value:'ครึ่งเม็ด',evidence:'ครึ่งเม็ด'};
  pred.items[0].fields.dose={value:'หนึ่งเม็ด',evidence:'หนึ่งเม็ด'};
  const r=evaluateMediaPredictions({version:1,cases:[{referenceDraft:gold,predictedDraft:pred}]});
  assert.equal(r.fieldTotals.dose,1);assert.equal(r.fieldMatches.dose,0);assert.equal(r.fieldMatches.label,0);assert.equal(r.fieldUnknowns.label,1);
  pred.items.push(structuredClone(pred.items[0]));const mismatch=evaluateMediaPredictions({version:1,cases:[{referenceDraft:gold,predictedDraft:pred}]});
  assert.equal(mismatch.itemCountMismatches,1);assert.equal(mismatch.fieldMatches.label,0);
  assert.equal(evaluateMediaPredictions({version:1,cases:[{referenceDraft:gold,predictedDraft:{active:true}}]}).invalidDrafts,1);
});
test('evaluation caps workload and rejects malformed reference data',()=>{
  for(const input of [{},{version:1,cases:[]},{version:1,cases:[{referenceTranscript:'x'.repeat(1025),predictedTranscript:''}]},
    {version:1,cases:[{referenceDraft:{},predictedDraft:{}}]}])assert.throws(()=>evaluateMediaPredictions(input));
});

test('unknown reference fields never inflate field accuracy',()=>{
  const gold=JSON.parse(extraction());
  for(const field of Object.values(gold.items[0].fields)){field.value=null;field.evidence=null;}
  const r=evaluateMediaPredictions({version:1,cases:[{referenceDraft:gold,predictedDraft:gold}]});
  for(const key of Object.keys(r.fieldTotals)){
    assert.equal(r.fieldTotals[key],0);assert.equal(r.fieldMatches[key],0);assert.equal(r.fieldUnknowns[key],1);
  }
});
