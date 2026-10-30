import {readFileSync,statSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {draftFromText} from '../src/media-extraction.mjs';
import {extractedFields,scoreFields,FIELD_NAMES} from '../src/field-accuracy.mjs';
const root=process.argv[2]??'acceptance-media/private/quality-corpus';
const read=p=>{if(statSync(p).size>65536)throw Error('INPUT_TOO_LARGE');return readFileSync(p,'utf8').replace(/^\uFEFF/u,'');};
const escape=s=>String(s).replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normal=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim().toLowerCase();
const distance=(a,b)=>{let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+Number(a[i]!==b[j])));row=next;}return row[b.length];};
const groups={},sections=[];
for(const group of ['blister','bottle','sachet','voice']){
 try{
  const folder=join(root,group),reference=read(join(folder,'reference.txt')),transcript=read(join(folder,'prediction.txt'));
  const gold=JSON.parse(read(join(folder,'field-gold.json'))),kind=group==='voice'?'voice':'printed_label';
  const path=join(folder,'extraction-reviewed-pipeline.json');
  const previous=existsSync(path)?JSON.parse(read(path)):null,current=JSON.parse(draftFromText(transcript,kind));
  const taskFields=kind==='voice'?['instructions']:FIELD_NAMES;
  const score=scoreFields(current,gold,reference,{taskFields});
  const before=previous?scoreFields(previous,gold,reference,{taskFields}):null;
  const predicted=extractedFields(current),old=previous?extractedFields(previous):{};
  const rows=FIELD_NAMES.map(field=>{
   const annotated=Object.hasOwn(gold.fields,field),expected=gold.fields[field],actual=predicted[field];
   const state=score.fields[field].state;
   let reason=!annotated?'NO_REFERENCE_FIELD':expected===null?(actual===null?'EXPECTED_ABSENT':'UNEXPECTED_EXTRACTION'):actual===null?'NOT_FOUND':state==='matched'?'EXACT_MATCH':'TEXT_DIFFERENCE';
   // Similarity is only a diagnostic hint; never turn it into a correct score.
   if(annotated&&typeof expected==='string'&&typeof actual==='string'&&state==='mismatch'){
    const a=Array.from(normal(expected)),b=Array.from(normal(actual));
    if(1-distance(a,b)/Math.max(a.length,b.length)>=0.8)reason='POSSIBLE_SPELLING_OR_FORMAT_DIFFERENCE';
   }
   const sourceCheck=typeof expected==='string'&&!normal(transcript).includes(normal(expected))?'REFERENCE_NOT_LITERAL_IN_TRANSCRIPT_CHECK_SOURCE':'';
   return {field,reference:annotated?expected:'[NOT ANNOTATED]',previous:old[field]??null,predicted:actual,reason,sourceCheck,score:score.fields[field].accuracyPercent};
  });
  const privateReport={group,taskFields,rows,notes:current.items[0].notes??[],score,before};
  writeFileSync(join(folder,'field-comparison.private.json'),JSON.stringify(privateReport,null,2));
  writeFileSync(join(folder,'extraction-debug-candidate.private.json'),JSON.stringify(current,null,2));
  sections.push(`<h2>${escape(group)}</h2><p>Task fields: ${escape(taskFields.join(', '))}</p><table><thead><tr><th>Field</th><th>Reference</th><th>Previous</th><th>Predicted now</th><th>Reason / source check</th><th>%</th></tr></thead><tbody>${rows.map(r=>`<tr>${[r.field,r.reference===null?'[EXPLICITLY ABSENT]':r.reference,r.previous??'[MISSING]',r.predicted??'[MISSING]',r.reason+' '+r.sourceCheck,r.score??'[NOT SCORED]'].map(v=>`<td><pre>${escape(v)}</pre></td>`).join('')}</tr>`).join('')}</tbody></table>`);
  groups[group]={state:'scored',...score,previousFieldAccuracyPercent:before?.fieldAccuracyPercent??null,previousTaskAccuracyPercent:before?.taskAccuracyPercent??null,
   reasons:Object.fromEntries(rows.map(r=>[r.field,{reason:r.reason,sourceCheck:r.sourceCheck}]))};
 }catch{groups[group]={state:'blocked',code:'MISSING_INVALID_OR_STALE_DEBUG_INPUT'};}
}
const report={scope:'field_debug_cached_transcripts',providerCalls:0,referenceModified:false,groups,productionReady:false};
writeFileSync(join(root,'field-debug-report.json'),JSON.stringify(report,null,2));
writeFileSync(join(root,'field-comparison.private.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Private field comparison</title><style>body{font:16px system-ui;margin:24px;color:#17233a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd;padding:10px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0}th{background:#eef3f8}</style><h1>Private field comparison</h1><p>Local only. Reference and previous predictions are unchanged. Text differences need source review. Voice instruction-only scores are separate from full-field scores.</p>${sections.join('')}</html>`);
console.log(JSON.stringify(report,null,2));
if(Object.values(groups).some(g=>g.state==='blocked'))process.exitCode=2;
