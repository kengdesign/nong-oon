import {parseDraft} from '../src/draft-contract.mjs';
import {evaluateMediaPredictions} from '../src/media-evaluation.mjs';
// Independent human gold, never a gold draft produced by the extraction under test.
export function assessSample({reference,predictedTranscript,predictedDraft,sourceKind,review}){
  const scope=review?.scope??'unknown';
  if(!['full','partial','unknown'].includes(scope))throw Error('INVALID_REFERENCE_SCOPE');
  const reviewed=review?.humanReviewed===true;
  const transcriptAvailable=reviewed&&scope==='full';
  let gold;
  if(review?.referenceDraft!==undefined){
    const parsed=parseDraft(JSON.stringify(review.referenceDraft));
    if(!parsed.ok||parsed.draft.sourceKind!==sourceKind)throw Error('INVALID_REFERENCE_DRAFT');
    if(reviewed)gold=parsed.draft;
  }
  const example={};
  if(transcriptAvailable)Object.assign(example,{referenceTranscript:reference,predictedTranscript});
  if(gold)Object.assign(example,{referenceDraft:gold,predictedDraft});
  const metrics=Object.keys(example).length?evaluateMediaPredictions({version:1,cases:[example]}):null;
  const knownFields=metrics?Object.values(metrics.fieldTotals).reduce((a,b)=>a+b,0):0;
  const knownMatches=metrics?Object.values(metrics.fieldMatches).reduce((a,b)=>a+b,0):0;
  const fieldEvaluationAvailable=knownFields>0;
  const transcriptionScreen=!transcriptAvailable?'not_evaluated':metrics.codepointErrorRate!==null&&metrics.codepointErrorRate<=0.05?'passed':'needs_review';
  const fieldScreen=!fieldEvaluationAvailable?'not_evaluated':knownMatches===knownFields&&metrics.invalidDrafts===0&&metrics.itemCountMismatches===0?'passed':'needs_review';
  return {metrics,referenceScope:scope,referenceReviewed:reviewed,transcriptEvaluationAvailable:transcriptAvailable,
    knownFields,knownMatches,fieldEvaluationAvailable,transcriptionScreen,fieldScreen,
    screen:transcriptionScreen==='passed'&&fieldScreen==='passed'?'passed':'needs_review',pilotReady:false};
}
