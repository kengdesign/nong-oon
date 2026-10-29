import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFromText} from '../src/media-extraction.mjs';

test('label spacing preserves evidence and does not interpret patient-name lines',()=>{
  const fields=JSON.parse(draftFromText('ชื่อยา  ： TEST ONLY\nจำนวนต่อครั้ง : 2 แคปซูล\nชื่อ : SYNTHETIC PERSON','printed_label')).items[0].fields;
  assert.equal(fields.label.value,'TEST ONLY');
  assert.equal(fields.label.evidence,'ชื่อยา  ： TEST ONLY');
  assert.equal(fields.dose.value,'2 แคปซูล');
  assert.equal(fields.times.value,null);
});
test('different spacing cannot hide conflicting explicit fields',()=>{
  const item=JSON.parse(draftFromText('ชื่อยา: A\nชื่อยา ： B','printed_label')).items[0];
  assert.equal(item.fields.label.value,null);
  assert.ok(item.issues.includes('conflicting'));
});
test('natural directions are verbatim review excerpts, never inferred schedules',()=>{
  const item=JSON.parse(draftFromText('ชื่อ : SYNTHETIC PERSON\nรับประทานครั้งละ 2 แคปซูล วันละ 1 ครั้ง\nก่อนนอน','printed_label')).items[0];
  assert.equal(item.fields.instructions.value,'รับประทานครั้งละ 2 แคปซูล วันละ 1 ครั้ง');
  assert.equal(item.fields.instructions.evidence,item.fields.instructions.value);
  for(const key of ['label','dose','times','weekdays','useMode'])assert.equal(item.fields[key].value,null);
  assert.ok(item.issues.includes('unreadable'));
});
test('multiple directions and labelled disagreement require clarification',()=>{
  for(const text of ['รับประทานครั้งละ 1 เม็ด\nรับประทานครั้งละ 2 เม็ด','วิธีใช้: TEST ONLY\nรับประทานครั้งละ 1 เม็ด']){
    const item=JSON.parse(draftFromText(text,'voice')).items[0];
    assert.equal(item.fields.instructions.value,null);
    assert.ok(item.issues.includes('conflicting'));
  }
});
test('natural PRN instructions never activate fixed clock times',()=>{
  const item=JSON.parse(draftFromText('เวลา: 08:00\nรับประทาน เมื่อมีอาการ','voice')).items[0];
  assert.equal(item.fields.times.value,null);
  assert.equal(item.fields.useMode.value,'as_needed');
  assert.ok(item.issues.includes('unsupported_regimen'));
});
