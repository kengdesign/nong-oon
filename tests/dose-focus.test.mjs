import test from 'node:test';
import assert from 'node:assert/strict';
import { actionableDoses } from '../public/dose-focus.mjs';
test('focus includes only current eligible pending records and presents most recent first',()=>{
 const base={doseId:'a',status:'pending',scheduleVersion:2,dueAt:100,expiresAt:300};
 const doses=[base,{...base,doseId:'b',dueAt:150},{...base,doseId:'future',dueAt:201},{...base,doseId:'expired',expiresAt:200},{...base,doseId:'stale',scheduleVersion:1},{...base,doseId:'done',status:'reported_taken'},{...base,doseId:'invalid',expiresAt:undefined}];
 assert.deepEqual(actionableDoses(doses,2,200).map(d=>d.doseId),['b','a']);
 assert.equal(doses[0],base);
});
test('due boundary opens once and expiry boundary excludes the record',()=>{
 const dose={doseId:'a',status:'pending',scheduleVersion:1,dueAt:100,expiresAt:200};
 assert.equal(actionableDoses([dose],1,99).length,0);
 assert.equal(actionableDoses([dose],1,100).length,1);
 assert.equal(actionableDoses([dose],1,200).length,0);
});
