import {createHash} from 'node:crypto';
import {validateDraft} from './draft-contract.mjs';
export const FIELD_NAMES=['drug_name','strength','instructions'];
export const referenceHash=text=>createHash('sha256').update(text).digest('hex');
const aliases={drug_name:'drug_name',label:'drug_name','ชื่อยา':'drug_name',strength:'strength','ความแรง':'strength',instructions:'instructions','วิธีใช้':'instructions'};
const normal=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim().toLowerCase();
// Parse explicit human-authored labels only. Never infer gold from free text,
// the predicted draft, fuzzy matching or the medication reference catalog.
export function parseLabelledReference(text){
 if(typeof text!=='string'||text.length>8192)throw Error('INVALID_REFERENCE');
 const clean=text.replace(/^\uFEFF/u,'').trim();let entries;
 if(clean.startsWith('{')){
  let obj;try{obj=JSON.parse(clean);}catch{throw Error('INVALID_REFERENCE');}
  if(!obj||Array.isArray(obj))throw Error('INVALID_REFERENCE');entries=Object.entries(obj);
 }else entries=clean.split(/\r?\n/u).map(line=>line.match(/^\s*(drug_name|label|strength|instructions|ชื่อยา|ความแรง|วิธีใช้)\s*[:：]\s*(.*?)\s*$/u)).filter(Boolean).map(m=>[m[1],m[2]]);
 const fields={};
 for(const [key,value] of entries){
  if(!Object.hasOwn(aliases,key))continue;
  const name=aliases[key];if(Object.hasOwn(fields,name))throw Error('DUPLICATE_REFERENCE_FIELD');
  if(value!==null&&(typeof value!=='string'||!value.trim()||value.length>500))throw Error('INVALID_REFERENCE_FIELD');
  fields[name]=value===null?null:value.trim();
 }
 return fields;
}
export function extractedFields(draft){
 if(!validateDraft(draft).ok||draft.items.length!==1||!['voice','printed_label'].includes(draft.sourceKind))throw Error('INVALID_PREDICTION');
 const item=draft.items[0];
 return {drug_name:item.fields.label.value,strength:item.fields.strength.value,instructions:item.fields.instructions.value};
}
export function scoreFields(draft,gold,reference){
 if(!gold||gold.humanReviewed!==true||gold.independentlyAnnotated!==true||gold.referenceSha256!==referenceHash(reference)||
   !gold.fields||typeof gold.fields!=='object'||Array.isArray(gold.fields)||Object.keys(gold.fields).some(k=>!FIELD_NAMES.includes(k)))throw Error('UNREVIEWED_OR_STALE_FIELD_GOLD');
 const predicted=extractedFields(draft),fields={};let known=0,matched=0,positiveKnown=0,positiveMatched=0,falsePositives=0;
 for(const key of FIELD_NAMES){
  if(!Object.hasOwn(gold.fields,key)){fields[key]={state:'not_annotated',accuracyPercent:null};continue;}
  const expected=gold.fields[key];if(expected!==null&&(typeof expected!=='string'||!expected.trim()||expected.length>500))throw Error('INVALID_FIELD_GOLD');
  const actual=predicted[key],match=expected===null?actual===null:typeof actual==='string'&&normal(actual)===normal(expected);
  known++;matched+=Number(match);
  if(expected!==null){positiveKnown++;positiveMatched+=Number(match);}else if(actual!==null)falsePositives++;
  fields[key]={state:match?'matched':actual===null?'missing':'mismatch',expectedAbsent:expected===null,accuracyPercent:match?100:0};
 }
 const percentage=(a,b)=>b?Math.round(10000*a/b)/100:null;
 return {fields,knownFields:known,matchedFields:matched,coveragePercent:percentage(known,3),fieldAccuracyPercent:percentage(matched,known),
  positiveFieldAccuracyPercent:percentage(positiveMatched,positiveKnown),falsePositives,
  above80:known===3&&positiveKnown>0?matched/known>0.8:null,providerCalls:0,productionReady:false};
}
