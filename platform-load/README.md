# Isolated platform load drill

This is a separate synthetic Cloudflare Worker and D1 database. Never substitute the staging database ID, LINE secrets, production routes or owner records.

## Deploy after PR review

From repository root, using an existing authorized Cloudflare build credential:

```sh
npx wrangler d1 migrations apply DB --remote --config platform-load/wrangler.jsonc
npx wrangler d1 execute DB --remote --file platform-load/seed.sql --config platform-load/wrangler.jsonc
npx wrangler deploy --config platform-load/wrangler.jsonc
```

The seed creates a single 15-minute run window and never refreshes it on build retries. Run during Bangkok daytime, before 23:50, so all eight daily times remain in the two-day materialization horizon. Expected counts after the first successful alarm per profile: 10 profiles, 200 schedules, 3,200 dose records and 6,400 outbox rows. Three cron recoveries should each report checked=10 and failed=0; platform_load_results should contain ten distinct profiles for each cycle 1–3 (30 rows). No outbox attempts or sent rows are expected.

## Verify on Cloudflare

Inspect the dedicated Worker's Cron and Durable Object invocation logs and CPU metrics. Separate scheduled recovery events from alarm events. Record outcomes, invocation counts and CPU measurements; do not present aggregate mixed-version metrics or local process CPU as per-invocation proof. The instrumented subclass runs the actual PatientClock alarm and adds a completion write plus alarm removal. LINE delivery is forced off, so this measures scheduler/materialization and alarm overhead, not live network delivery or a full enabled-delivery workload.

Query the isolated D1 database:

```sql
SELECT * FROM platform_load_control;
SELECT cycle,COUNT(*) completions,COUNT(DISTINCT patient_id) profiles FROM platform_load_results GROUP BY cycle;
SELECT COUNT(*) doses FROM dose_records;
SELECT COUNT(*) intents,COALESCE(SUM(attempts),0) attempts,SUM(status='sent') sent FROM notification_outbox;
PRAGMA foreign_key_check;
PRAGMA quick_check;
```

## Stop and retain evidence

After collecting results, remove the minute Cron trigger from nong-oon-load-review and verify the trigger list is empty. Future alarms are deleted after each successful test execution; the expiry guard also suppresses expired work. The three-cycle guard stops test work, but it does NOT remove the Cron trigger: until removal, no-op invocations continue. Do not change staging delivery settings or delete the database; retain it for evidence.

## Caregiver release gate

Local tests cover single-use/expired invitations, limited grants, reporting, and revocation. A real separate LINE account must still log in, accept an owner-issued invitation, verify visibility/reporting and then have access revoked. The owner's current account cannot substitute for this two-account test.
