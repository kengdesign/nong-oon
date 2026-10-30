import records from './drug-reference-data.mjs';
// Exact curated aliases AND literal strength. Never fuzzy repair, salt conversion,
// dose calculation or a claim of current registration/authenticity.
const normal=s=>s.normalize('NFC').replace(/[®™]/gu,'').trim().replace(/\s+/gu,' ').toUpperCase();
const strength=s=>normal(s).replace(/\s/gu,'');
export const DRUG_REFERENCE_COUNT=records.length;
export function lookupDrugReference(fields){
 const name=fields?.label?.value,value=fields?.strength?.value;
 if(typeof name!=='string'||typeof value!=='string'||name.length>120||value.length>120)return null;
 const found=records.filter(r=>r.aliases.some(a=>normal(a)===normal(name))&&strength(r.strength)===strength(value));
 if(found.length!==1)return null;
 const {aliases,...r}=found[0];return {...r,matchedBy:'literal_name_and_strength',verification:'reference_only'};
}
export const isKnownManufacturer=text=>typeof text==='string'&&/^(?:Berlin(?: Pharmaceutical(?: Industry)?)?|Olic|Merck(?: Sante Sas)?|Viatris(?: Pharmaceuticals Llc)?)$/iu.test(text.trim());
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function printedReferenceEvidence(lines){
 const found=[];
 for(const r of records){
  const names=lines.filter(l=>r.aliases.some(a=>normal(a)===normal(l)));
  const unit=r.strength.split(/\s+/u).map(escape).join('\\s*');
  const pattern=new RegExp('^\\(?\\s*'+r.ingredient.split(/\s+/u).map(escape).join('\\s+')+'\\s+('+unit+')\\s*\\)?$','iu');
  const strengths=lines.filter(l=>pattern.test(l));
  if(names.length>=2&&strengths.length>=2)found.push({label:{value:names[0].replace(/[®™]/gu,'').trim(),evidence:names[0]},strength:{value:strengths[0].match(pattern)[1],evidence:strengths[0]}});
 }
 return found.length===1?found[0]:null;
}
