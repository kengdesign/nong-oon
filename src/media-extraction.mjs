import {isKnownManufacturer,printedReferenceEvidence} from './drug-reference.mjs';
import {DRAFT_FIELDS,validateDraft,assessCommand} from './draft-contract.mjs';
// Bounded explicit fields and verbatim instruction excerpts, never dosage inference.
const labels={label:'ชื่อยา',strength:'ความแรง',dose:'จำนวนต่อครั้ง',instructions:'วิธีใช้',times:'เวลา',weekdays:'วัน',startDate:'วันที่เริ่ม',endDate:'วันที่สิ้นสุด',useMode:'ลักษณะการใช้'};
export function draftFromText(text,sourceKind){
  if(typeof text!=='string'||text.length>8000||!['voice','printed_label'].includes(sourceKind))throw Error('MEDIA_TEXT_REJECTED');
  const fields=Object.fromEntries(DRAFT_FIELDS.map(k=>[k,{value:null,evidence:null}])),issues=new Set();
  const lines=text.normalize('NFC').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  for(const [key,label] of Object.entries(labels)){
    const pattern=new RegExp('^'+label+'\\s*[:：]\\s*(.*)$');
    const found=lines.filter(l=>pattern.test(l));
    if(found.length!==1){if(found.length>1)issues.add('conflicting');continue;}
    const line=found[0],raw=line.match(pattern)[1].trim();if(!raw||line.length>500)continue;
    let value=raw;
    if(key==='times')value=raw.split(',').map(s=>s.trim());
    if(key==='weekdays')value=raw.split(',').map(s=>/^\s*[0-6]\s*$/.test(s)?Number(s):NaN);
    if(key==='useMode')value=raw==='ตามเวลา'?'scheduled':raw==='เมื่อมีอาการ'?'as_needed':null;
    if(value===null)continue;
    const candidate={...fields,[key]:{value,evidence:line}},draft={schemaVersion:1,sourceKind,items:[{fields:candidate,issues:[]}]};
    if(validateDraft(draft).ok)fields[key]=candidate[key];else issues.add('ambiguous');
  }
  // Printed packaging only: literal brand + strength on the same line, or a
  // repeated printed brand directly beside a strength/ingredient line. No
  // medicine dictionary, spelling repair, patient-name or regimen inference.
  if(sourceKind==='printed_label'){
    const brand=/^[A-Z][A-Za-z0-9-]{2,39}(?:\s+\d{1,4})?(?:[®™])?$/u;
    const strength=/^(?:[A-Za-z][A-Za-z -]{1,60}\s+)?(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|มก\.))$/iu;
    const pairs=[];
    for(let i=0;i<lines.length;i++){
      const inline=lines[i].match(/^([A-Z][A-Za-z0-9-]{2,39}(?:[®™])?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|มก\.))$/u);
      if(inline&&!isKnownManufacturer(inline[1]))pairs.push({label:inline[1],strength:inline[2],labelEvidence:lines[i],strengthEvidence:lines[i]});
      if(brand.test(lines[i])&&!isKnownManufacturer(lines[i])){
        for(const neighbor of [lines[i-1],lines[i+1]]){
          const matched=neighbor?.match(strength);
          if(matched)pairs.push({label:lines[i],strength:matched[1],labelEvidence:lines[i],strengthEvidence:neighbor,repeated:true,index:i});
        }
      }
    }
    const repeated=pairs.filter(p=>p.repeated&&new Set(pairs.filter(q=>q.label===p.label&&q.strength===p.strength).map(q=>q.index)).size>=2);
    // An ingredient-strength neighbor is evidence for strength, not a second brand.
    const accepted=[...repeated,...pairs.filter(p=>!p.repeated&&!repeated.some(q=>q.strengthEvidence===p.labelEvidence))];
    const reference=printedReferenceEvidence(lines);
    if(reference){
      // A repeated exact registry name plus repeated ingredient/strength is
      // stronger than isolated unlabelled OCR tokens. Competing repeated pairs
      // still conflict; never override explicit labelled fields below.
      if(!accepted.some(p=>p.repeated&&p.label.toUpperCase()!==reference.label.value.toUpperCase())){
        if(accepted.some(p=>p.label.toUpperCase()!==reference.label.value.toUpperCase()))issues.add('possible_duplicate');
        accepted.splice(0,accepted.length);
      }
      accepted.push({label:reference.label.value,strength:reference.strength.value,labelEvidence:reference.label.evidence,strengthEvidence:reference.strength.evidence});issues.add('ambiguous');
    }
    for(const key of ['label','strength']){
      const candidates=[...new Set(accepted.map(p=>p[key]))];
      const explicit=lines.some(l=>new RegExp('^'+labels[key]+'\\s*[:：]').test(l));
      if(candidates.length>1||(fields[key].value!==null&&candidates.length===1&&fields[key].value!==candidates[0])){
        fields[key]={value:null,evidence:null};issues.add('conflicting');
      }else if(!explicit&&candidates.length===1){
        const p=accepted.find(p=>p[key]===candidates[0]);
        fields[key]={value:p[key],evidence:p[key+'Evidence']};
      }
    }
  }
  // Preserve one explicit natural instruction line for human review. Do not split
  // it into doses, frequencies or clock times; patient names are not drug labels.
  const instructionLines=lines.filter(line=>/^(?:รับประทาน|ใช้ภายนอก)(?:\s|ครั้งละ|วันละ|ก่อน|หลัง|เฉพาะ)/u.test(line));
  if(instructionLines.length>1){
    fields.instructions={value:null,evidence:null};issues.add('conflicting');
  }else if(instructionLines.length===1){
    const line=instructionLines[0];
    if(fields.instructions.value!==null&&fields.instructions.value!==line){
      fields.instructions={value:null,evidence:null};issues.add('conflicting');
    }else if(!issues.has('conflicting')&&line.length<=500){
      const candidate={value:line,evidence:line};
      const draft={schemaVersion:1,sourceKind,items:[{fields:{...fields,instructions:candidate},issues:[]}]};
      if(validateDraft(draft).ok)fields.instructions=candidate;
    }
  }
  // PRN language anywhere prevents fixed-time activation, including conflicting labels.
  if(/เมื่อมีอาการ|ตามอาการ|\bPRN\b/iu.test(text)){
    fields.useMode={value:'as_needed',evidence:lines.find(l=>/เมื่อมีอาการ|ตามอาการ|\bPRN\b/iu.test(l))?.slice(0,500)??'PRN'};
    fields.times={value:null,evidence:null};issues.add('unsupported_regimen');
  }
  if(DRAFT_FIELDS.some(k=>fields[k].value===null))issues.add('unreadable');
  const draft={schemaVersion:1,sourceKind,items:[{fields,issues:[...issues]}]};
  if(!validateDraft(draft).ok)throw Error('MEDIA_EXTRACTION_REJECTED');
  return JSON.stringify(draft);
}
// P2-08 recognition foundation. Exact whole utterances; no target guessing or writes.
export function recognizeVoiceCommand(text){
  const clean=typeof text==='string'&&text.length<=500?text.normalize('NFC').trim():'';
  const intent=({'ดูตารางวันนี้':'view_today','ดูยาที่เหลือ':'view_remaining','กินยาแล้ว':'report_taken','ยังไม่ได้กินยา':'report_not_taken'})[clean]??'unknown';
  const command={schemaVersion:1,intent,targetLabel:null,ambiguous:['report_taken','report_not_taken'].includes(intent)};
  return {command,assessment:assessCommand(command,{resolvedTargets:0})};
}
