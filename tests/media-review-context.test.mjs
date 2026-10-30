import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFromText} from '../src/media-extraction.mjs';
import {suggestDrugReference} from '../src/drug-reference.mjs';
import {validateDraft,assessDraft} from '../src/draft-contract.mjs';
const extract=(text,kind='printed_label')=>JSON.parse(draftFromText(text,kind));
test('fuzzy reference suggestion uses observed strength, stays review-only and keeps evidence',()=>{
 const d=extract('Bestratin 20\nRestatin 20\nSimvastatin 20 mg\nBerlin\nBestratin 20\nRestatin 20\nSimvastatin 20 mg');
 const item=d.items[0];assert.equal(item.fields.label.value,null);
 assert.equal(item.fields.strength.value,'20 mg');
 assert.ok(item.notes.some(n=>n.kind==='name_candidate'&&n.text.includes('BESTATIN 20')));
 assert.equal(assessDraft(d).activationAllowed,false);
 assert.equal(suggestDrugReference(['Bestratin 20'],null),null);
 assert.equal(suggestDrugReference(['Bestratin 20'],'10 mg'),null);
 assert.equal(suggestDrugReference(['UNKNOWN 20'],'20 mg'),null);
 assert.equal(suggestDrugReference(['Berlin'],'20 mg'),null);
});
test('catalog tie, weak match, unknown strength and release-form mismatch do not yield a candidate',()=>{
 for(const [lines,strength] of [[['NORVASC','ZYRTEC'],'10 mg'],[['abcde'],'20 mg'],[['Bestatin 20'],'999 mg'],[['GLUCOPHAGE XR 1000'],'500 mg']])assert.equal(suggestDrugReference(lines,strength),null);
});
test('herbal text becomes bounded notes without unrelated personal header or invented strength',()=>{
 const d=extract('ชื่อ นายทดสอบ ข้อมูลส่วนตัว\nHN: PRIVATE-ID\nใบมะขามแขกแคปซูล แทน SEI 20 แคปซูล\nรับประทานครั้งละ 2 แคปซูล วันละ 1 ครั้ง');
 const item=d.items[0];assert.equal(item.fields.label.value,'ใบมะขามแขกแคปซูล');assert.equal(item.fields.strength.value,null);
 assert.deepEqual(item.notes,[{kind:'herb',text:'ใบมะขามแขกแคปซูล',evidence:'ใบมะขามแขกแคปซูล'}]);
 assert.doesNotMatch(JSON.stringify(item.notes),/PRIVATE-ID|นายทดสอบ|20/);
});
test('Thai speech retains symptom and regimen spelling without inventing name or clock times',()=>{
 const d=extract('อยากแก้ท้องฟูกรับทานครั้งละสองแคปซูล วันละหนึ่งครั้งก่อนนอน','voice');
 const item=d.items[0];assert.equal(item.fields.instructions.value,'รับทานครั้งละสองแคปซูล วันละหนึ่งครั้งก่อนนอน');
 assert.deepEqual(item.notes,[{kind:'symptom',text:'อยากแก้ท้องฟูก',evidence:'อยากแก้ท้องฟูก'}]);
 for(const key of ['label','strength','dose','times'])assert.equal(item.fields[key].value,null);
 assert.equal(assessDraft(d).activationAllowed,false);
});
test('notes reject hidden authority, unsupported kinds, control characters and pill inference',()=>{
 const d=extract('ไม่มีข้อมูล');
 for(const notes of [[{kind:'herb',text:'x',evidence:'x',confirmed:true}],[{kind:'diagnosis',text:'x',evidence:'x'}],[{kind:'herb',text:'x\ny',evidence:'x'}],Array.from({length:9},()=>({kind:'herb',text:'x',evidence:'x'}))]){
  d.items[0].notes=notes;assert.equal(validateDraft(d).ok,false);
 }
 d.items[0].notes=[{kind:'herb',text:'x',evidence:'x'}];d.sourceKind='pill_photo';assert.equal(validateDraft(d).ok,false);
});
