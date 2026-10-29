import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFromText} from '../src/media-extraction.mjs';
const parse=(s,kind='printed_label')=>JSON.parse(draftFromText(s,kind)).items[0];
test('literal packaging pair keeps evidence and never supplies missing regimen',()=>{
  for(const text of ['SAMPLEBRAND 20 mg','SAMPLEBRAND\nExampleingredient 20 mg\nSAMPLEBRAND\nExampleingredient 20 mg']){
    const {fields}=parse(text);assert.equal(fields.label.value,'SAMPLEBRAND');assert.equal(fields.strength.value,'20 mg');
    assert.ok(text.includes(fields.strength.evidence));
    for(const key of ['dose','times','instructions','weekdays','startDate','useMode'])assert.equal(fields[key].value,null);
  }
});
test('unassociated, voice, conflicting and multiple product packaging stays unknown',()=>{
  for(const [text,kind] of [['SAMPLEBRAND\n20 mg','printed_label'],['SAMPLEBRAND 20 mg','voice'],['ชื่อยา: A\nชื่อยา: B\nSAMPLEBRAND 20 mg','printed_label']])assert.equal(parse(text,kind).fields.label.value,null);
  for(const text of ['SAMPLEBRAND 20 mg\nOTHERBRAND 10 mg','SAMPLEBRAND 20 mg\nSAMPLEBRAND 40 mg']){
    const item=parse(text);assert.equal(item.fields.strength.value,null);assert.ok(item.issues.includes('conflicting'));
  }
});
