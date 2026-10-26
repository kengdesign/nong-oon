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

PR12–14 are merged and deployed. Real LINE Login, owner consent/profile,
schedule persistence and future dose-round materialization were observed in the
staging browser. Scheduling is enabled; real/synthetic webhook ingestion and
outbound delivery remain disabled. Four owner-entered test schedules materialized
without manual database insertion. The local/CI suite passes 114 tests.

Pending release gates: Messaging API access-token creation and encrypted storage,
reviewed pilot recipient configuration, one actual reminder and authenticated
report, caregiver workflow with a separately authorized test account, and an
isolated remote restore drill. Do not infer live receipt from successful local
HTTP mocks or from the dashboard's dose rounds.
