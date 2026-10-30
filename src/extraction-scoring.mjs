import {DRAFT_FIELDS,validateDraft} from './draft-contract.mjs';
import {evaluateMediaPredictions} from './media-evaluation.mjs';
const normalize=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
const rounded=n=>Math.round(n*100)/100;
function distance(a,b){
 let row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=0;i<a.length;i++){
  const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+Number(a[i]!==b[j])));
  row=next;
 }
 return row[b.length];
}
// This is text similarity, not calibrated OCR/STT or clinical field accuracy.
// Only source-derived fields/context are scored; fuzzy catalog candidates are excluded.
export function scoreExtraction({draft,reference,review,referenceFields}){
 if(!validateDraft(draft).ok||!['printed_label','voice'].includes(draft.sourceKind)||
   typeof reference!=='string'||!reference.trim()||Array.from(reference).length>4096)throw Error('INVALID_SCORING_INPUT');
 const fragments=[];
 for(const item of draft.items){
  for(const note of item.notes??[])if(note.kind==='symptom')fragments.push(note.text);
  for(const key of ['label','strength','dose','instructions'])if(typeof item.fields[key].value==='string')fragments.push(item.fields[key].value);
  for(const note of item.notes??[])if(note.kind==='herb')fragments.push(note.text);
 }
 const extracted=normalize(fragments.join(' ')),gold=normalize(reference);
 const a=Array.from(gold),b=Array.from(extracted);
 if(b.length>4096)throw Error('SCORING_INPUT_TOO_LARGE');
 const edits=distance(a,b),textMatchPercent=rounded(100*(1-edits/Math.max(a.length,b.length)));
 const referenceReviewed=review?.humanReviewed===true;
 const referenceScope=['full','partial'].includes(review?.scope)?review.scope:'unknown';
 const result={textMatchPercent,textMatchAbove80:textMatchPercent>80,
  metric:'NFC_whitespace_normalized_codepoint_similarity_max_length',referenceCodepoints:a.length,extractedCodepoints:b.length,
  editDistance:edits,referenceReviewed,referenceScope,fieldAccuracyPercent:null,knownFields:0,matchedFields:0,
  fieldAccuracyAbove80:null,fieldReferenceReviewed:false,providerCalls:0,productionReady:false};
 if(referenceFields!==undefined){
  // Independent human annotation only; never derive gold with the tested extractor.
  if(!referenceFields||referenceFields.humanReviewed!==true||referenceFields.independentlyAnnotated!==true||
    !referenceFields.draft||referenceFields.draft.sourceKind!==draft.sourceKind)throw Error('INVALID_FIELD_REFERENCE');
  const evaluation=evaluateMediaPredictions({version:1,cases:[{referenceDraft:referenceFields.draft,predictedDraft:draft}]});
  const total=DRAFT_FIELDS.reduce((n,k)=>n+evaluation.fieldTotals[k],0);
  const matches=DRAFT_FIELDS.reduce((n,k)=>n+evaluation.fieldMatches[k],0);
  Object.assign(result,{knownFields:total,matchedFields:matches,fieldReferenceReviewed:true,
   fieldAccuracyPercent:total?rounded(100*matches/total):null,fieldAccuracyAbove80:total?matches/total>0.8:null,
   fields:Object.fromEntries(DRAFT_FIELDS.map(k=>[k,{known:evaluation.fieldTotals[k],matched:evaluation.fieldMatches[k]}]))});
 }
 return result;
}
