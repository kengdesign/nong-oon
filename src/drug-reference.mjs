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

// Suggestions only: a similarity score is not a probability or verified identity.
const distance=(a,b)=>{
 let row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=0;i<a.length;i++){
  const next=[i+1];
  for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1)));
  row=next;
 }
 return row[b.length];
};
export function suggestDrugReference(lines,observedStrength){
 if(typeof observedStrength!=='string')return null;
 const tokens=lines.filter(l=>/^[A-Za-z][A-Za-z -]{4,49}(?:\s+\d{1,4})?[®™]?$/u.test(l)&&!isKnownManufacturer(l));
 const ranked=records.filter(r=>strength(r.strength)===strength(observedStrength)).map(r=>{
  let score=0,evidence=null;
  for(const line of tokens)for(const alias of r.aliases){
   const a=normal(alias),b=normal(line);
   // Printed numbers must agree; never repair a strength or release formulation.
   if((a.match(/\d+/gu)??[]).join(',')!==(b.match(/\d+/gu)??[]).join(','))continue;
   const s=1-distance(a,b)/Math.max(a.length,b.length);
   if(s>score){score=s;evidence=line;}
  }
  return {id:r.id,name:r.tradeName,score,evidence};
 }).sort((a,b)=>b.score-a.score);
 const best=ranked[0];
 if(!best||best.score<0.8||best.score-(ranked[1]?.score??0)<0.12)return null;
 return {...best,score:Math.round(best.score*1000)/1000,requiresConfirmation:true};
}
