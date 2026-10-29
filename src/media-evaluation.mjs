import {parseDraft} from './draft-contract.mjs';
const keys=['label','strength','dose','instructions','times','weekdays','startDate','endDate','useMode'];
const boundedText=v=>typeof v==='string'&&Array.from(v).length<=1024;
function distance(a,b){let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+Number(a[i-1]!==b[j-1]));previous=row;}
  return previous[b.length];
}
// Offline P2-06/07 measurements supplied by an operator; never calls a provider.
// No raw text, field values or case IDs are returned. Comparisons are exact,
// aligned by item position. Medical equivalence is intentionally not inferred.
export function evaluateMediaPredictions(input){
  if(!input||input.version!==1||!Array.isArray(input.cases)||input.cases.length<1||input.cases.length>100)throw Error('INVALID_EVALUATION');
  const totals={cases:input.cases.length,transcripts:0,referenceCodepoints:0,editDistance:0,invalidDrafts:0,itemCountMismatches:0,
    fieldUnknowns:Object.fromEntries(keys.map(k=>[k,0])),fieldMatches:Object.fromEntries(keys.map(k=>[k,0])),fieldTotals:Object.fromEntries(keys.map(k=>[k,0]))};
  let textBudget=0;
  for(const example of input.cases){
    if(Object.hasOwn(example,'referenceTranscript')||Object.hasOwn(example,'predictedTranscript')){
      if(!boundedText(example.referenceTranscript)||!boundedText(example.predictedTranscript))throw Error('INVALID_EVALUATION');
      const a=Array.from(example.referenceTranscript.normalize('NFC')),b=Array.from(example.predictedTranscript.normalize('NFC'));
      textBudget+=a.length+b.length;if(textBudget>65_536)throw Error('EVALUATION_TOO_LARGE');
      totals.transcripts++;totals.referenceCodepoints+=a.length;totals.editDistance+=distance(a,b);
    }
    if(Object.hasOwn(example,'referenceDraft')||Object.hasOwn(example,'predictedDraft')){
      const gold=parseDraft(JSON.stringify(example.referenceDraft));if(!gold.ok)throw Error('INVALID_REFERENCE_DRAFT');
      const prediction=parseDraft(JSON.stringify(example.predictedDraft));if(!prediction.ok)totals.invalidDrafts++;
      if(prediction.ok&&prediction.draft.items.length!==gold.draft.items.length)totals.itemCountMismatches++;
      const aligned=prediction.ok&&prediction.draft.items.length===gold.draft.items.length&&prediction.draft.sourceKind===gold.draft.sourceKind;
      for(let i=0;i<gold.draft.items.length;i++)for(const key of keys){
        if(gold.draft.items[i].fields[key].value===null){totals.fieldUnknowns[key]++;continue;}
        totals.fieldTotals[key]++;if(aligned&&JSON.stringify(gold.draft.items[i].fields[key].value)===JSON.stringify(prediction.draft.items[i].fields[key].value))totals.fieldMatches[key]++;
      }
    }
    if(!Object.hasOwn(example,'referenceTranscript')&&!Object.hasOwn(example,'referenceDraft'))throw Error('INVALID_EVALUATION');
  }
  return {...totals,codepointErrorRate:totals.referenceCodepoints?totals.editDistance/totals.referenceCodepoints:null,
    metric:'NFC Unicode codepoints, not Thai word accuracy',providerCalls:0};
}
