# Nong Oon delivery gates — connected staging

## Implemented and locally verified
- LINE webhook HMAC with bounded minimal inbox, duplicate-event handling and signed follow/unfollow lifecycle.
- LINE Login code flow (separate Login channel under the Messaging Provider), PKCE, nonce/browser-bound single-use state, opaque hashed sessions, CSRF, request limits.
- Explicit versioned self-profile consent, owner-managed expiring single-use caregiver invitations, immediate revocation, fresh profile after withdrawal, audit transactions.
- Medication schedules entered by the owner, Bangkok times and weekdays, optimistic versions, reports with audit, read-only prior-version history, JSON export.
- Per-patient SQLite Durable Object alarms; deterministic doses and transactional outbox; five-minute bounded cyclic recovery.
- Generic LINE push adapter, persisted same-payload retry keys, bounded leases/retries, account/consent/membership/version rechecks and pilot recipient allowlist.
- Thai responsive UI, privacy/help, accessible dialogs, controlled refresh, no browser persistence of medical data.
- Hourly retention: inbox7d, outbox7d, dose/audit90d, withdrawn details eligible after30d, short-lived auth expiry, monitoring counters.

## Pilot bounds
Ten active self profiles globally. Each profile:20 active medication schedules,8 times/day,5 caregivers. Up to10 explicitly allowlisted LINE recipients;100 attempt/day global and20 per recipient/day. API limits30 mutations and120 reads per actor/minute. No AI calls for button presses/scheduling. No new subscription or plan upgrade.

## Release gates and evidence
Local SQLite and mock-LINE tests do NOT establish actual Cloudflare/LINE availability. A merged PR and Ready deployment do NOT establish live Login/notification correctness.

1. Apply all seven migrations to staging; preserve a D1 Time Travel bookmark before changes.
2. CI + independent QA + deploy exact reviewed commit with collection and delivery disabled.
3. Check deployed assets, authenticated API rejection paths, actual D1 schema, alarm binding and retained Cron.
4. Supply LINE Login channel ID/secret under the SAME Provider as Messaging, fixed callback `https://staging.nongoon.com/auth/callback`, then actual browser Login/consent pilot. Secrets only in Cloudflare secure interface, never chat/GitHub.
5. Supply Messaging access token and explicitly selected pilot LINE IDs; arm scheduler and test real reminder/report/caregiver alert once with user-approved synthetic data. Keep delivery and real ingestion disabled until this gate.
6. Verify DO alarm execution, request/CPU budgets at pilot load, late-job/retry behavior and backup restore drill before expanding. Never claim a push accepted by LINE proves receipt or consumption.

## Privacy and rollback
`PRIVATE_RETENTION_ENABLED` is independent of the API switch. Disable delivery/scheduler/ingestion before rollback/restore; preserve external send receipts/retry keys and reconcile outbox before re-enabling. Never restore a backup directly into a sending environment. SQLite backup tests are separate from an actual D1 remote restore drill.

## Scope intentionally disabled
OCR, voice recognition, medication identification, dose recommendation, payments, emergency escalation and public production access are not enabled. No inference of dosing instructions; lack of response is not an emergency diagnosis. Only current explicit capabilities may change a dose. No raw messages, reply tokens, credentials or health data in GitHub or application logs.

## Latest staging verification — 26 October 2026

PR12–16 are merged. Real LINE Login, consented self-profile creation,
schedule persistence and round materialization were observed on staging.

The owner-approved synthetic reminder due at 12:10 Bangkok was accepted by LINE
at 12:10:01, with persisted status sent / ACCEPTED and one attempt. The synthetic
round has a not-taken report and one audit record. The owner subsequently
confirmed in chat that the scheduled message arrived. Receipt of a test message
does not establish medication consumption.

The Messaging API token is stored as a Cloudflare encrypted secret. After the
test, outbound delivery was disabled and the pilot recipient list cleared.
Scheduling remains enabled; real/synthetic webhook ingestion remains disabled.
Both synthetic schedules end on 2026-10-26 and do not recur after that date.
Owner-entered schedules are preserved.

Current local verification: npm run check and all 115 tests pass, including D1
trigger-inclusive lease claims, isolated SQLite restore and maximum-pilot load.
These local results do not establish remote D1 restore success or Cloudflare CPU
limits at maximum pilot load.

Live read-only checks show retention last succeeded at 12:17:20 Bangkok and
scheduler recovery at 12:25:30, with no recorded recovery failure. No notification
was sent during these checks.

## Remaining release gates

- Test caregiver invitation acceptance, visibility, reporting and revocation with
  a separately selected and authorized LINE account. No caregiver is currently
  linked. Do not invent a recipient or grant access to the owner's data.
- Measure actual Cloudflare request/CPU budgets at pilot load. Keep local load
  evidence separate from platform measurements.
- Review recipients and duration before continuous delivery; the successful
  one-off test does not mean ongoing reminders are enabled.
- Keep public production access disabled until the remaining gates are reviewed.

## Isolated remote D1 Time Travel drill — 26 October 2026

Created nong-oon-restore-review as a separate database, with no Worker binding,
LINE credentials or route. Applied all seven schema migrations. The schema has
20 application tables (plus the D1 internal table), 21 explicit indexes and six
triggers. No staging records were exported or copied.

Seeded only synthetic account/profile/schedule/dose data, one trigger-generated
report audit and one synthetic sent receipt. No HTTP push was made; the receipt
is a database fixture and does not claim LINE acceptance. Saved a Time Travel
bookmark, changed a marker from 1 to 2, then restored the isolated database to
the saved bookmark. The marker returned to 1, the report/audit join remained
consistent, and the sent receipt ID, payload hash and timestamp were preserved.
Foreign-key check returned zero violations and PRAGMA quick_check returned ok.
Recovery bookmarks are kept out of this repository. Staging was not restored.

This establishes real remote D1 Time Travel on a synthetic isolated database.
It does not establish restoration of actual user data, reconciliation of real
outbound sends, an SQL export/import drill, or maximum-pilot platform load.
The isolated database is retained for subsequent checks and is not bound to the
application. No additional plan or subscription was enabled.

## Isolated D1 volume check — 26 October 2026

Reran the existing maximum-pilot application test locally: 10 profiles, 200
schedules, eight times/day, 3,200 two-day doses and 6,400 notification intents.
The mock-only test passed idempotency and the 100/day global plus 20/recipient
attempt limits; elapsed 1,659 ms and process CPU 1,665 ms for the entire local
test, not an individual Worker invocation. No real HTTP push was made.

Seeded the same row volumes using SQL in the unbound restore-review D1 database.
The ten load profiles are synthetic, their 200 schedules are inactive, and no
Worker, token or live recipient is attached. Existing restore fixtures remain
separate. Counts were 10/200/3,200/6,400 with zero foreign-key violations.
The count/integrity query reported 2.43 ms D1 query time (529 ms dashboard response).
One profile had 160 ready owner intents. A diagnostic due-queue query used the
notification_due index and a temporary B-tree for the final ordering term.
These are individual dashboard observations, not latency percentiles or an SLA.

This checks remote storage volume and bounded query behavior only. SQL-created
fixtures do not establish that the application's scheduler ran at maximum load
on Workers. The full scheduler/alarm CPU budget at pilot load remains a release
gate; the 50 ms configured Worker limit must not be compared with whole-suite
local CPU time. No staging settings were changed and no LINE messages were sent.
