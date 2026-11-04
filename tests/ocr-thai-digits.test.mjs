import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFromText} from '../src/media-extraction.mjs';
test('Thai digits in explicitly labelled dates/times normalize without inferring a regimen',()=>{
 const draft=JSON.parse(draftFromText('เวลา: ๐๘:๓๐,๒๐:๐๐\nวัน: ๑,๒\nวันที่เริ่ม: ๒๐๒๖-๑๑-๐๓','printed_label'));
 const f=draft.items[0].fields;assert.deepEqual(f.times.value,['08:30','20:00']);assert.deepEqual(f.weekdays.value,[1,2]);assert.equal(f.startDate.value,'2026-11-03');assert.equal(f.times.evidence,'เวลา: ๐๘:๓๐,๒๐:๐๐');
 const unknown=JSON.parse(draftFromText('หลังอาหารเช้า ๑ เม็ด','printed_label'));assert.equal(unknown.items[0].fields.times.value,null);
});
