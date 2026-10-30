import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import records from '../src/drug-reference-data.mjs';
import {lookupDrugReference} from '../src/drug-reference.mjs';
test('curated catalog matches source data and rejects unknown strengths',()=>{
 assert.deepEqual(records,JSON.parse(readFileSync(new URL('../data/drug-references.json',import.meta.url))).records);
 assert.ok(records.length>=12);
 for(const record of records){
  assert.match(record.source,/^https:\/\/ndi\.fda\.moph\.go\.th\//);
  assert.equal(record.registrationStatus,'not_verified_current');
  const fields={label:{value:record.aliases[0]},strength:{value:record.strength}};
  assert.equal(lookupDrugReference(fields)?.registration,record.registration);
  assert.equal(lookupDrugReference({...fields,strength:{value:'999999 mg'}}),null);
 }
});
