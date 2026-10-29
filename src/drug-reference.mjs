// Small curated reference seed, NOT a comprehensive drug database or classifier.
// Exact reviewed name AND strength only. Manufacturer alone never identifies a drug.
// Public source retrieved 2026-10-29; underlying Thai FDA snapshot 2025-06-30.
const reference=Object.freeze({tradeName:'BESTATIN 20',ingredient:'Simvastatin',strength:'20 mg',
  manufacturer:'เบอร์ลินฟาร์มาซูติคอลอินดัสตรี้',category:'ยาลดไขมัน กลุ่ม statin',registration:'1A 3/44(NG)',
  source:'https://ndi.fda.moph.go.th/drug_info/index?name=simvastatin',checkedAt:'2026-10-29'});
export function lookupDrugReference(fields){
  const name=fields?.label?.value,strength=fields?.strength?.value;
  if(typeof name!=='string'||typeof strength!=='string')return null;
  return /^BESTATIN\s*20$/iu.test(name.trim())&&/^20\s*mg$/iu.test(strength.trim())?{...reference}:null;
}
