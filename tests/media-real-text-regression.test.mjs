import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFromText} from '../src/media-extraction.mjs';
const fields=(text,kind='printed_label')=>JSON.parse(draftFromText(text,kind)).items[0].fields;
test('supplement title is separate from net weight and manufacturer',()=>{
 const f=fields('HALEON\nCentrum\nCentrum Active Dietary Supplement\nComplete From AtoZinc\nน้ำหนักสุทธิ 33.51 กรัม');
 assert.equal(f.label.value,'Centrum Active');assert.equal(f.strength.value,null);
});
test('uncertain blister spelling is not repaired using reference or manufacturer',()=>{
 const f=fields('Bestatin 20\nRestatin 20\nSimvastatin 20 mg\nBerlin\nBestatin 20\nRestatin 20\nSimvastatin 20 mg');
 assert.equal(f.label.value,null);assert.equal(f.strength.value,'20 mg');
});
test('package count and indications are not ingredient strength or identity',()=>{
 const f=fields('ยาแก้ท้องผูก\nใบมะขามแขกแคปซูล แทน SEI 20 แคปซูล\nรับประทานครั้งละ 2 แคปซูล วันละ 1 ครั้ง\nก่อนนอน');
 assert.equal(f.label.value,null);assert.equal(f.strength.value,null);
});
test('misrecognized speech is not silently corrected into drug identity',()=>{
 const f=fields('อยากแก้ท้องฟูกรับทานครั้งละสองแคปซูล วันละหนึ่งครั้งก่อนนอน','voice');
 assert.equal(f.label.value,null);assert.equal(f.strength.value,null);
});
