import {extractedFields,scoreFields,FIELD_NAMES,referenceHash} from './field-accuracy.mjs';
const normal=s=>s.normalize('NFC').toLowerCase().replace(/\s+/gu,' ').trim();
const instructions=s=>{
 const numbers={'หนึ่ง':'1','สอง':'2','สาม':'3','สี่':'4','ห้า':'5','หก':'6','เจ็ด':'7','แปด':'8','เก้า':'9','สิบ':'10'};
 return normal(s).replace(/[๐-๙]/gu,c=>String(c.charCodeAt(0)-0x0e50))
  .replace(/(?:ครั้งละ|วันละ)(หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)(?=เม็ด|แคปซูล|ครั้ง|มิลลิลิตร|\s)/gu,(m,n)=>m.replace(n,numbers[n]))
  .replace(/รับประทาน|รับทาน|ทาน/gu,'กิน').replace(/\s+/gu,'');
};
export function compareInstructions(expected,predicted){
 const a=instructions(expected),b=instructions(predicted);
 if(a===b)return {match:true,reason:'BOUNDED_INSTRUCTION_EQUIVALENCE',requiresReview:false};
 const times=s=>s.match(/ก่อนนอน|ก่อนอาหาร(?:เช้า|กลางวัน|เย็น)?|หลังอาหาร(?:เช้า|กลางวัน|เย็น)?|พร้อมอาหาร(?:เช้า|กลางวัน|เย็น)?/gu)??[];
 const ta=times(a),tb=times(b);
 // Additional timing is reference coverage only, never full semantic equivalence.
 if(!ta.length&&tb.length===1&&b.replace(/ก่อนนอน|ก่อนอาหาร(?:เช้า|กลางวัน|เย็น)?|หลังอาหาร(?:เช้า|กลางวัน|เย็น)?|พร้อมอาหาร(?:เช้า|กลางวัน|เย็น)?/gu,'')===a)
  return {match:true,reason:'REFERENCE_COVERED_WITH_ADDITIONAL_TIMING',requiresReview:true};
 return {match:false,reason:'INSTRUCTION_DIFFERENCE_REQUIRES_REVIEW',requiresReview:true};
}
export function scoreFlexibleFields(draft,gold,reference,{layout,blisterInstructionsAbsent=false}={}){
 if(!['blister','bottle','sachet','voice'].includes(layout))throw Error('INVALID_LAYOUT');
 // Strict validation and strict results are kept as a separate baseline.
 const strict=scoreFields(draft,gold,reference),predicted=extractedFields(draft),fields={};
 let evaluated=0,matches=0,reviewRequired=false;
 for(const key of FIELD_NAMES){
  const actual=predicted[key],expected=gold.fields[key];let match=false,reason,skip=false,requiresReview=false;
  if(key==='instructions'&&layout==='blister'&&blisterInstructionsAbsent){
   skip=actual===null;reason=skip?'EXPECTED_ABSENT_BY_OPERATOR_SOURCE_REVIEW':'UNEXPECTED_INSTRUCTION_EXTRACTION';
  }else if(!Object.hasOwn(gold.fields,key)){skip=true;reason='NO_REFERENCE_FIELD';}
  else if(expected===null){skip=actual===null;reason=skip?'EXPECTED_ABSENT':'UNEXPECTED_EXTRACTION';}
  else if(actual===null)reason='NOT_FOUND';
  else if(normal(expected)===normal(actual)){match=true;reason='EXACT_NORMALIZED_MATCH';}
  // Explicitly requested product-title expansion, not arbitrary drug substring matching.
  else if(key==='drug_name'&&normal(expected)==='centrum'&&normal(actual)==='centrum active'){
   match=true;reason='APPROVED_PARTIAL_PRODUCT_TITLE';requiresReview=true;
  }else if(key==='instructions')({match,reason,requiresReview}=compareInstructions(expected,actual));
  else reason='FIELD_MISMATCH';
  if(!skip){evaluated++;matches+=Number(match);}reviewRequired ||= requiresReview;
  fields[key]={state:skip?'excluded':match?'matched':'mismatch',reason,accuracyPercent:skip?null:match?100:0,requiresReview};
 }
 const accuracy=evaluated?Math.round(10000*matches/evaluated)/100:null;
 return {strictFieldAccuracyPercent:strict.fieldAccuracyPercent,strictFields:strict.fields,fields,
  flexibleAccuracyPercent:accuracy,evaluatedFields:evaluated,matchedFields:matches,excludedFields:3-evaluated,
  above80:evaluated?matches/evaluated>0.8:null,reviewRequired,
  policy:{version:1,layout,blisterInstructionsAbsent,referenceSha256:referenceHash(reference),nameExpansion:'centrum -> centrum active only',instructionComparison:'bounded rules; added timing requires review'},
  providerCalls:0,productionReady:false};
}
