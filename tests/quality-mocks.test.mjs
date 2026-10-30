import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../acceptance-media/mock-assets.mjs';
import {draftFromText} from '../src/media-extraction.mjs';
test('synthetic mock transcripts retain literal fields and never invent regimens',()=>{
 for(const a of assets.filter(a=>!a.negative)){
  assert.equal(Buffer.from(a.base64,'base64').readUInt16BE(),0xffd8);
  const draft=JSON.parse(draftFromText(a.reference,'printed_label'));
  assert.equal(draft.items[0].fields.label.value,a.name);
  assert.equal(draft.items[0].fields.strength.value,a.strength);
  for(const key of ['dose','times','weekdays','startDate'])assert.equal(draft.items[0].fields[key].value,null);
 }
 assert.equal(assets.filter(a=>a.negative).length,1);
});
