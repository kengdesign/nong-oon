/** Pure state model only. 'reported_taken' is a user report, not proof of ingestion. */
export class DomainError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new DomainError(code); };
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const states = new Set(['pending', 'reported_taken', 'reported_not_taken', 'cancelled']);
const validBase = (dose) => dose && text(dose.patientId) && text(dose.doseId)
  && Number.isSafeInteger(dose.scheduleVersion) && dose.scheduleVersion >= 1
  && Number.isSafeInteger(dose.dueAt) && Number.isSafeInteger(dose.expiresAt) && dose.expiresAt > dose.dueAt;
const validStored = (dose) => validBase(dose) && states.has(dose.status)
  && (['pending', 'cancelled'].includes(dose.status)
    ? dose.reportedBy === null && dose.reportedAt === null
    : text(dose.reportedBy) && Number.isSafeInteger(dose.reportedAt)
      && dose.reportedAt >= dose.dueAt && dose.reportedAt < dose.expiresAt);
export function createDose({ patientId, doseId, scheduleVersion, dueAt, expiresAt }) {
  if (!validBase({ patientId, doseId, scheduleVersion, dueAt, expiresAt })) fail('INVALID_DOSE');
  return Object.freeze({ patientId, doseId, scheduleVersion, dueAt, expiresAt, status: 'pending', reportedBy: null, reportedAt: null });
}
/** Authorization is supplied by the server's trusted consent/identity layer, never request payload. */
export function transitionDose(dose, command, { actorId, authorizedPatientIds, allowedActions, currentScheduleVersion, now }) {
  if (!validStored(dose) || !Number.isSafeInteger(now)) fail('INVALID_STATE');
  if (!text(actorId) || !Array.isArray(authorizedPatientIds) || !authorizedPatientIds.includes(dose.patientId)) fail('FORBIDDEN');
  if (!command || !['report_taken', 'report_not_taken', 'cancel'].includes(command.type)) fail('INVALID_COMMAND');
  if (!Array.isArray(allowedActions) || !allowedActions.includes(command.type)) fail('FORBIDDEN');
  if (command.patientId !== dose.patientId || command.doseId !== dose.doseId) fail('DOSE_MISMATCH');
  if (command.scheduleVersion !== dose.scheduleVersion || currentScheduleVersion !== dose.scheduleVersion) fail('STALE_SCHEDULE');
  if (command.type === 'cancel') {
    if (dose.status === 'cancelled') return dose;
    if (dose.status !== 'pending') fail('ALREADY_REPORTED');
    return Object.freeze({ ...dose, status: 'cancelled' });
  }
  if (dose.status === 'cancelled') fail('CANCELLED');
  const target = command.type === 'report_taken' ? 'reported_taken' : 'reported_not_taken';
  // Replays never replace original reporter or timestamp, even after expiry.
  if (dose.status === target) return dose;
  if (dose.status !== 'pending') fail('ALREADY_REPORTED');
  if (now < dose.dueAt) fail('NOT_DUE');
  if (now >= dose.expiresAt) fail('EXPIRED');
  return Object.freeze({ ...dose, status: target, reportedBy: actorId, reportedAt: now });
}
