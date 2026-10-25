import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDose, transitionDose } from '../src/domain.mjs';
const make = () => createDose({ patientId: 'synthetic-p1', doseId: 'd1', scheduleVersion: 1, dueAt: 1000, expiresAt: 2000 });
const command = (type = 'report_taken') => ({ type, patientId: 'synthetic-p1', doseId: 'd1', scheduleVersion: 1 });
const context = (extra = {}) => ({ actorId: 'synthetic-user', authorizedPatientIds: ['synthetic-p1'], allowedActions: ['report_taken', 'report_not_taken', 'cancel'], currentScheduleVersion: 1, now: 1100, ...extra });
const rejects = (code, fn) => assert.throws(fn, (e) => e.code === code);
test('records explicit report without mutating pending state', () => {
  const d = make(); const result = transitionDose(d, command(), context());
  assert.equal(result.status, 'reported_taken'); assert.equal(result.reportedAt, 1100); assert.equal(d.status, 'pending');
});
test('duplicate taken is idempotent and keeps timestamp after expiry', () => {
  const d = transitionDose(make(), command(), context());
  assert.equal(transitionDose(d, command(), context({ now: 3000 })), d);
});
test('authorization cannot be bypassed by duplicate command', () => {
  const d = transitionDose(make(), command(), context());
  rejects('FORBIDDEN', () => transitionDose(d, command(), context({ authorizedPatientIds: [] })));
});
test('patient and dose must both match', () => {
  for (const patch of [{ patientId: 'other' }, { doseId: 'other' }]) rejects('DOSE_MISMATCH', () => transitionDose(make(), { ...command(), ...patch }, context()));
});
test('stale button or changed schedule cannot update dose', () => {
  rejects('STALE_SCHEDULE', () => transitionDose(make(), { ...command(), scheduleVersion: 2 }, context()));
  rejects('STALE_SCHEDULE', () => transitionDose(make(), command(), context({ currentScheduleVersion: 2 })));
});
test('expiry is exclusive and early reports rejected', () => {
  rejects('EXPIRED', () => transitionDose(make(), command(), context({ now: 2000 })));
  rejects('NOT_DUE', () => transitionDose(make(), command(), context({ now: 999 })));
});
test('not-taken report is separate and cannot silently become taken', () => {
  const d = transitionDose(make(), command('report_not_taken'), context());
  assert.equal(d.status, 'reported_not_taken');
  rejects('ALREADY_REPORTED', () => transitionDose(d, command(), context()));
});
test('cancelled dose rejects confirmation and cancellation replay is idempotent', () => {
  const d = transitionDose(make(), command('cancel'), context());
  assert.equal(transitionDose(d, command('cancel'), context()), d);
  rejects('CANCELLED', () => transitionDose(d, command(), context()));
});
test('unknown commands and invalid schedule input rejected', () => {
  rejects('INVALID_COMMAND', () => transitionDose(make(), command('จ้า'), context()));
  rejects('INVALID_DOSE', () => createDose({ patientId: 'p', doseId: 'd', scheduleVersion: 0, dueAt: 0, expiresAt: 1 }));
});
test('stored state validation fails closed before commands or idempotency', () => {
  const reported = transitionDose(make(), command(), context());
  for (const base of [make(), reported]) {
    for (const patch of [{ dueAt: undefined }, { expiresAt: undefined }, { dueAt: NaN }, { expiresAt: Infinity }, { expiresAt: 999 }, { scheduleVersion: 0 }, { patientId: '' }, { doseId: '' }, { status: 'unknown' }]) {
      rejects('INVALID_STATE', () => transitionDose({ ...base, ...patch }, command(), context()));
    }
  }
  rejects('INVALID_STATE', () => transitionDose({ ...reported, reportedAt: undefined }, command(), context()));
  rejects('INVALID_STATE', () => transitionDose({ ...reported, reportedBy: null }, command(), context()));
});
test('patient membership alone does not authorize cancellation or reports', () => {
  rejects('FORBIDDEN', () => transitionDose(make(), command('cancel'), context({ allowedActions: ['report_taken'] })));
  rejects('FORBIDDEN', () => transitionDose(make(), command(), context({ allowedActions: undefined })));
  rejects('FORBIDDEN', () => transitionDose(make(), command(), context({ allowedActions: ['cancel'] })));
  const cancelled = transitionDose(make(), command('cancel'), context());
  rejects('FORBIDDEN', () => transitionDose(cancelled, command('cancel'), context({ allowedActions: [] })));
});
