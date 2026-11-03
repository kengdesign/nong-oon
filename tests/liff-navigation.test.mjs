import test from 'node:test';
import assert from 'node:assert/strict';
import {liffUrl, DEFAULT_LIFF_ID, navigationFromUrl} from '../public/liff-client.mjs';
import {notificationText} from '../src/delivery.mjs';
test('LIFF routes are allowlisted and carry no medication or identity',()=>{
 for(const tab of ['today','schedules','history','settings','help']) {
  const url=liffUrl(DEFAULT_LIFF_ID,tab);
  assert.equal(new URL(url).hostname,'liff.line.me');
  assert.equal(new URL(url).searchParams.get('tab'),tab);
 }
 assert.throws(()=>liffUrl(DEFAULT_LIFF_ID,'https://evil.example'));
 assert.deepEqual(navigationFromUrl('https://nongoon.com/?tab=history'),{tab:'today',showHistory:true});
 assert.equal(navigationFromUrl('https://nongoon.com/?tab=schedules').tab,'meds');
 assert.equal(navigationFromUrl('https://nongoon.com/?tab=settings').tab,'settings');
 assert.equal(navigationFromUrl('https://nongoon.com/?tab=help').tab,'help');
 assert.equal(navigationFromUrl('https://nongoon.com/?tab=__proto__').tab,'today');
});
test('configured notifications use LIFF while preserving legacy staging URL',()=>{
 for(const kind of ['reminder','caregiver_alert']) {
  const text=notificationText(kind,'https://nongoon.com',DEFAULT_LIFF_ID);
  assert.ok(text.endsWith(liffUrl(DEFAULT_LIFF_ID,'today')));
  assert.ok(!text.includes('https://nongoon.com'));
 }
 assert.ok(notificationText('reminder','https://staging.example').endsWith('https://staging.example/'));
});
