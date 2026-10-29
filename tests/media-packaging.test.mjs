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
test('mixed-case repeated packaging and reverse reading order retain literal evidence',()=>{
  for(const text of ['Samplebrand 20 mg','Samplebrand 20\nExampleingredient 20 mg\nSamplebrand 20\nExampleingredient 20 mg','Exampleingredient 20 mg\nSamplebrand20\nExampleingredient 20 mg\nSamplebrand20']){
    const {fields}=parse(text);assert.ok(fields.label.value?.startsWith('Samplebrand'));assert.equal(fields.strength.value,'20 mg');assert.equal(fields.dose.value,null);
  }
  // One name bordered by two strength lines is not two independent repetitions.
  assert.equal(parse('20 mg\nSamplebrand\n20 mg').fields.label.value,null);
});
test('public reference seed needs repeated literal name AND ingredient-strength, never Berlin',()=>{
 const text='Bestatin 20\nSimvastatin 20 mg\nBerlin\nBestatin 20\nSimvastatin 20 mg\nBerlin';
 const item=parse(text);assert.equal(item.fields.label.value,'Bestatin 20');assert.equal(item.fields.strength.value,'20 mg');assert.equal(item.fields.dose.value,null);
 for(const value of ['Berlin\n20 mg\nBerlin\n20 mg','Bestatin 20\nBerlin'])assert.equal(parse(value).fields.label.value,null);
});

test('reference evidence cannot override conflicting explicit labels or another repeated product',()=>{
 const evidence='Bestatin 20\nSimvastatin 20 mg\nBerlin\nBestatin 20\nSimvastatin 20 mg\nBerlin';
 assert.equal(parse('ชื่อยา: A\nชื่อยา: B\n'+evidence).fields.label.value,null);
 assert.equal(parse(evidence+'\nOTHERBRAND\nIngredient 40 mg\nOTHERBRAND\nIngredient 40 mg').fields.label.value,null);
 assert.notEqual(parse('Bestatln 20\nSimvastatin 20 mg').fields.label.value,'Bestatin 20');
});
