# Authenticated care API

This API is called by the Worker only after LINE session verification, the care
feature gate, and same-origin CSRF checks. Neither `actorId` nor server `now` is
read from JSON. `handleCareApi(request, env, {actorId, now})` is an internal
boundary, not a second authentication mechanism. Client-supplied identity fields
are rejected. Responses and error codes contain no SQL, credentials, or tokens.

## Consent and access

`POST /api/patients` accepts `{displayName, consent:true,
consentVersion:"2026-10-26"}`. It creates the signed-in person's own care profile.
It cannot attest consent for another adult. There is one active owned profile per
account. A withdrawn record stays inaccessible during its deletion period;
opting in again creates a fresh profile ID, schedules, owner membership and grants.
It never restores prior caregiver access or health history. At most four retained
profile rows per owner bound repeated withdrawal/recreation before purge.

`GET /api/patients` lists up to eleven active memberships (one owner and ten
caregiver memberships). `GET /api/patients/:id` returns `{patient, canManage}`.
Patient values contain `id, displayName, role, currentVersion, consentVersion,
consentedAt`. Every read verifies current membership and active consent. Missing
and inaccessible profiles both return `404 PATIENT_NOT_FOUND`.

Only an active owner may create invitations, manage schedules, list members,
export, revoke a caregiver, or withdraw consent. A caregiver may read schedules
and doses and report taken/not-taken. These are separate action grants; caregiving
does not confer schedule management or cancellation capabilities.

## Schedules

`GET /api/patients/:id/schedules` returns `{schedules,currentVersion}`.
`POST /api/patients/:id/schedules` creates; `PUT
/api/patients/:id/schedules/:scheduleId` replaces the full explicit form:

```json
{
  "label": "ยาตัวอย่างตามฉลาก",
  "instructions": "ข้อมูลที่ผู้ใช้ตรวจจากฉลากเอง",
  "times": ["08:00", "18:00"],
  "weekdays": [0, 1, 2, 3, 4, 5, 6],
  "startDate": "2026-10-26",
  "endDate": null,
  "active": true,
  "expectedVersion": 1
}
```

Times are Bangkok local time; weekdays are Sunday `0` through Saturday `6`.
Limits: 120-character label, 500-character instructions, one to eight unique
times, one to seven unique weekdays, twenty active medications, one hundred
retained schedule rows per profile. Dates are validated as actual calendar dates.
The service never infers drug identity, dose, interval, or instructions. Set
`active:false` to pause using the same full payload and latest version.

One D1 batch advances the profile's global revision, updates the target schedule,
moves every schedule to that revision, and appends an audit event. A unique
mutation marker ties every statement to the winning compare-and-swap. Stale
requests, concurrent edits, revoked consent, blocked accounts, and quota failures
cannot partially mutate schedules. An audit failure rolls the transaction back.
The `409 SCHEDULE_CONFLICT_OR_QUOTA` response requires refreshing current state.

Mutation responses carry `x-nongoon-wake-patient` for the Worker to arm the
patient scheduler after the durable SQL commit. The header is removed from public
responses by the Worker integration. D1 remains authoritative if wakeup fails.

## Sharing and revocation

`POST /api/patients/:id/invites {consent:true}` records the owner's explicit
sharing action and returns `{code,expiresAt}`. Codes use 256 random bits, are
stored only as SHA-256 hashes, expire after fifteen minutes and are single-use.
There are at most five active invitations and five active caregivers per profile.
The recipient signs in separately and submits `POST /api/invites/accept {code}`.
Codes must not be put in URLs, analytics, logs or third-party QR generators.

Claiming and membership/grant creation are one guarded D1 batch. An invitation is
bound to the originating profile and consent epoch. A caregiver may belong to at
most ten profiles. Expired, withdrawn, self-directed and used codes are rejected
without revealing the underlying patient.

`GET /api/patients/:id/members` returns `{members:[{actorId,role,revokedAt}]}`.
`DELETE /api/patients/:id/members/:actorId` revokes that caregiver's membership and
all dose actions. It also invalidates outstanding invitation codes so a previously
copied code cannot reverse revocation. The owner cannot revoke their own membership
through this endpoint. `DELETE /api/patients/:id/consent` withdraws the whole
profile: all memberships, grants and invites are revoked, all schedules paused,
and the global revision incremented in one transaction. Profile visibility stops
immediately. Delivery authorization must still be checked by the scheduler at
claim/send time; a successful wakeup is not the privacy boundary.

## Reports and export

`GET /api/patients/:id/doses` returns at most 200 current-revision doses over the
previous thirty days and next two days. Values include `doseId,patientId,
scheduleVersion,dueAt,expiresAt,status,changedAt,scheduleId,label,instructions`.
The name/instructions join must match patient and schedule version. A legacy dose
without a matching schedule receives a generic label.

`POST /api/patients/:id/doses/:doseId/report` accepts `{type,commandId,
scheduleVersion}`, with type `report_taken` or `report_not_taken` and a new opaque
command ID. The existing atomic dose adapter verifies the exact action grant,
current revision, report window and receipt identity. Migration 0005 also guards
dose updates against inactive consent, membership or blocked accounts. Revocation
triggers revoke grants, so old receipts cannot be replayed through revoked access.
A report is a person's statement, not proof of consumption. A missing report is
not an emergency assessment.

`GET /api/patients/:id/export` is owner-only and returns the profile, up to 100
schedules, 5,000 dose rows and 5,000 minimal care audit events, with `bounded:true`.
This is a bounded account export, not a whole-database backup. Retention, deletion,
backup/restore and monitoring are handled by the separate operations module.

## Verification limits

`tests/care-api.test.mjs` executes actual SQLite migrations and transactional SQL
with a D1-shaped adapter. It exercises IDOR, explicit consent, optimistic racing
edits, quotas, invitation replay/expiry, withdrawn/revoked access, blocked accounts,
fresh-profile re-consent, audit rollback and body limits. Local success does not
prove D1 remote migration, LINE Login configuration, Durable Object deployment,
or successful live delivery. Those remain separate integration checks.
