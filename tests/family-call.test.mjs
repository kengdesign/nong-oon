import test from 'node:test';
import assert from 'node:assert/strict';
import {nextContact} from '../public/family-call.mjs';
const contacts=[{priority:1,phone:'111'},{priority:2,phone:'222'},{priority:3,phone:'333'}];
test('family suggestions follow explicit taps without wrapping or inferring results',()=>{
 const at=1000;
 assert.equal(nextContact(contacts,null,at),null);
 assert.equal(nextContact(contacts,{priority:1,phone:'111',at},at+1),contacts[1]);
 assert.equal(nextContact(contacts,{priority:2,phone:'222',at},at+1),contacts[2]);
 assert.equal(nextContact(contacts,{priority:3,phone:'333',at},at+1),null);
 assert.equal(nextContact(contacts,{priority:1,phone:'old',at},at+1),null);
 assert.equal(nextContact(contacts,{priority:1,phone:'111',at},at+1800000),null);
});
