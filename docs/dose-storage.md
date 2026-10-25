# Internal dose storage foundation

Migration 0003 adds grants per actor/patient/action, a current schedule revision,
dose records and audit receipts. It is additive. No new HTTP route, consent flow,
identity provider, reminder scheduler or outbound LINE request is included.
No real data may be enabled based on these internal tests alone.

`applyDoseCommand(DB, command, {actorId, now})` accepts only server-verified actor
identity and server time. Never pass actorId or now from request JSON. The caller
must authenticate first. Grant creation/revocation and schedule provisioning have
no public API in this foundation. Identifiers must be opaque, at most 128 ASCII
letters/digits/underscore/hyphen; no names, medication labels or message text.

The conditional UPDATE checks the current schedule revision, an active permission
for the exact action, and the report window. Pending is changed once. Cancellation
may happen before the due time. An AFTER UPDATE trigger inserts the audit row;
an audit failure rolls the UPDATE back. The D1 batch then reads a receipt. A replay
must match the key, actor, patient, dose, schedule version and status, and still
have permission. It returns the original timestamp even after the report window.
A withdrawn grant or superseded schedule also rejects replays. No retry loop is
performed; storage failures expose only a fixed error code.

Local tests run actual SQLite SQL with transactional rollback. They cover queued
conflicting commands, not simultaneous connections to deployed D1. Before API
integration, verify D1 migrations and competing requests against staging, add
verified identity/session and CSRF protections, consent lifecycle, schedule
confirmation, audit access/retention and backup/restore. The existing inbox
retention worker does not delete these new records. Data lifecycle for these
tables is a release blocker before real data, not an implied 7-day expiry.

The schema assumes one current schedule revision per patient. A future schedule
API must increment this revision atomically with schedule changes and manage
new doses explicitly. A report is a user report, not proof of intake; a missing
report is not an emergency assessment.
