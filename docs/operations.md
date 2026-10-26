# Nong Oon operations and recovery

This runbook distinguishes local test evidence from an observed Cloudflare or
LINE result. A passing mock never proves that a live alarm or LINE push ran.
The release owner records the deployed commit, migration result, pre-migration
bookmark, trigger history and observed invocation outcomes separately.

## Gate matrix

| Setting | Current staging configuration | Limited live pilot |
| --- | --- | --- |
| `APP_ENV` | `staging` | Keep the selected environment explicit |
| `APP_ORIGIN` | `https://staging.nongoon.com` | Exact HTTPS origin; no trailing slash |
| `CARE_API_ENABLED` | `true` | Requires successful LINE Login integration |
| `INGESTION_ENABLED` | `false` | Enable only for the tested LINE channel |
| `SYNTHETIC_INGESTION_ENABLED` | `false` | Remains `false` |
| `SCHEDULER_ENABLED` | `true` | Prepares rounds; outbound sending stays independently disabled |
| `DELIVERY_ENABLED` | `false` | Enable only for the reviewed pilot recipients |
| `LIVE_LINE_RECIPIENTS` | `[]` | Explicit 1–10 same-Provider LINE IDs |
| `RETENTION_ENABLED` | `true` | Keep enabled |
| `PRIVATE_RETENTION_ENABLED` | `true` | Keep enabled independently of delivery |

`LINE_LOGIN_CHANNEL_ID` and the Login channel secret belong to a LINE Login
channel; the Messaging API channel secret verifies webhooks, and its access
token authorizes pushes. Enter secrets through the secure deployment interface.
Do not put them in Git, URLs, screenshots or chat. A failed configuration remains
closed. Do not remove staging Access protection to work around missing login
credentials. Existing endpoint-specific Access exceptions must remain narrow.

## Migrations and release evidence

Before changing remote schema, inspect the selected account/database and capture
a current recovery bookmark. The following commands target the named staging
database; run them from the matching repository configuration, with authorized
Wrangler authentication:

```sh
npx wrangler d1 info nong-oon-staging
npx wrangler d1 time-travel info nong-oon-staging
npx wrangler d1 migrations list nong-oon-staging --remote
npx wrangler d1 migrations apply nong-oon-staging --remote
```

Record results without credentials or private rows. Apply all migrations before
enabling their API/maintenance flags. Verify the expected tables, indexes and
triggers, then use synthetic records to test D1 transactions and concurrent
commands. Do not infer a remote migration from passing local SQLite tests.
Every deployment must preserve the independently disabled collection/sending
gates until the pilot is ready.

## Timing, costs and monitoring

Times in the product use Bangkok time. The hourly `17 * * * *` trigger performs
retention at minute 17. `*/5 * * * *` performs bounded scheduler recovery when
scheduling is enabled; normal reminder timing uses one persisted alarm per
patient. Recovery visits at most 100 profiles per run with a persisted cursor.

The pilot has at most 10 active profiles, 20 active medication schedules per
profile and eight explicit daily times per schedule. Each materialization covers
today and tomorrow. A wake processes at most 10 ready notification intents.
Hard database triggers reserve at most 100 attempts per Bangkok day globally and
20 per recipient, including failures and timeouts. A cap terminalizes the affected
intent; it does not automatically spend tomorrow's budget to send an old reminder.
Any cap change needs a reviewed code change. No AI, OCR, paid load-test traffic,
additional subscriptions or plan upgrades are part of this release.

Inspect actual scheduled invocation results and aggregate stable task/error
codes. `operation_health` tracks retention success; `scheduler_control` tracks
recovery; each object stores its last successful run. Investigate missed expected
runs, repeated storage errors, stale leases, increasing dead/late intents and
quota exhaustion. This release provides those diagnostic records; it does not
claim an externally delivered monitoring alert or uptime guarantee.

Keep persisted automatic request-invocation logging disabled for auth routes:
OAuth callback query strings contain short-lived authorization codes. Use only
aggregate application logs; never log request URLs, bodies, identity IDs,
medication labels, invitation codes, cookies or provider token/error bodies.
Successful webhook verification alone is not a successful medication workflow.

## Data lifecycle

Withdrawal stops profile visibility and permissions immediately, pauses schedules
and invalidates grants/invitations. A request already accepted by LINE cannot be
retracted. It does not prove arrival or that medication was taken.

Hourly private retention is separate from ingestion and delivery. Each table
operation deletes at most 100 rows, except notification-outbox operations, which
delete at most 1,000. Finite batches can require several cycles to drain a backlog.
Monitor the oldest retained records rather than claiming exact-time erasure.

| Data | Policy |
| --- | --- |
| Webhook inbox | Seven days; at most 100 rows per hourly run |
| Sessions, OAuth states, rate buckets and invitations | Remove expired rows in bounded batches |
| Dose records and dose/care audit | 90 days |
| Notification outbox | Seven days after intent expiry; expired active leases checked |
| Delivery budgets | Retain the recent seven Bangkok days |
| Withdrawn profile dependencies/profile | Eligible after 30 days; delete dependencies first |
| Login rate salt | One rotating row; no raw IP address |

Backups can retain older snapshots within their recovery window. A restore must
reapply withdrawals/revocations and reconcile outbound receipts before access or
delivery resumes. Do not recreate deleted access from an old backup.

## Backup and isolated restoration

D1's production storage backend provides built-in Time Travel. Its supported
window depends on the account plan: seven days on Free and 30 days on Paid.
Verify the actual backend and account entitlement. No separate automated R2
export workflow or new backup subscription has been provisioned by this release.

For an additional SQL export, choose a protected destination outside the Git
checkout. The path below is an operator-selected placeholder, not a prepared file:

```sh
npx wrangler d1 export nong-oon-staging --remote --output=/secure/nongoon-staging-backup.sql
```

Treat the export as sensitive. Restrict access, encrypt retained copies using the
operator's established backup tooling, and apply a deletion schedule. Never commit
exports or upload health data to a public artifact/download URL.

Prefer an isolated restore drill: select a separately provisioned review database
and configuration that has no production route, no live LINE token, an empty
recipient list and `INGESTION_ENABLED=false`, `SCHEDULER_ENABLED=false`,
`DELIVERY_ENABLED=false`. Import the SQL into that empty selected database, then
check integrity, foreign keys, schema/triggers, counts, audit receipts and record
isolation. Do not import into the source database as a test.

```sh
npx wrangler d1 execute nong-oon-restore-review --remote --file=/secure/nongoon-staging-backup.sql
```

The review database name and secure file path are illustrative. Inspect the
actual destination before running the import. An in-place Time Travel restore
is destructive and needs explicit action-time review; the example below is a
runbook step, not an operation executed by the test:

```sh
npx wrangler d1 time-travel restore nong-oon-staging --bookmark=RECORDED_BOOKMARK
```

Pause all writes/ingestion/scheduling/delivery first and retain a pre-restore
bookmark/export. A database rollback cannot roll back an HTTP request accepted
by LINE. Before re-enabling, reconcile sent and uncertain `sending` intents with
the pre-restore state. Preserve original retry UUIDs and payload hashes; never
reset attempted jobs to fresh pending notifications. Quarantine uncertain intents
and skip past-due reminders. Reapply later consent withdrawals and membership
revocations, clear restored sessions/login states, and rearm only future eligible
schedules after the review. Keep delivery off until reconciliation is complete.

## Reproducible local checks

```sh
npm run check
npm test
node --test tests/backup-restore.test.mjs tests/load.test.mjs
```

The backup drill uses `node:sqlite` online backup, restores into a separate
temporary SQLite file, compares full synthetic care/audit/outbox rows and checks
that restored delivery is disabled. It verifies that restored writes leave the
source unchanged and that audit triggers still work. It performs no D1 restore.

The maximum-pilot load test uses 10 synthetic profiles ×20 schedules ×8 times,
yielding 3,200 two-day dose rows and 6,400 owner/caregiver intents. It checks repeat
materialization, recovery, occurrence uniqueness and 100/global plus 20/recipient
attempt caps. Outbound HTTP is replaced with a mock; accidental global network
calls fail the test. Logged elapsed/CPU measurements describe the local SQLite
process only, not Cloudflare CPU, D1 capacity, alarm accuracy or LINE delivery.

Primary operational references:
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## Observed staging evidence — 26 October 2026

Before schema changes, the named staging database contained only `webhook_inbox`
with zero rows. A pre-change recovery bookmark was recorded separately in the deployment
operator context; recovery bookmarks are not included in this repository.
Migrations0003–0007 were executed in that database after confirming0001/0002
were present; schema enumeration then showed all20 application tables.
The Wrangler-compatible migration ledger is recorded separately from application
schema. No real patient records or LINE delivery were used in these changes.

Cloudflare Observability showed the existing hourly retention trigger
`17 * * * *` with eventType`scheduled`, outcome`ok`, dated26October2026
08:19GMT+7 on Worker version`7ad4db84`. That verifies the prior inbox-retention
invocation, not the new private-retention implementation or patient alarms.

Later verified on 26 October 2026:

- PR12 deployed the supplied branding and persisted the Login channel ID. The
  Login channel exists under the same Nong Oon Provider, its callback is saved,
  and its secret is stored in Cloudflare encrypted secrets.
- PR13 fixed Workers-incompatible `redirect:error` on server-side LINE calls.
  `redirect:manual` rejects non-success responses without forwarding credentials.
  A real browser Login completed and the authenticated dashboard opened.
- The owner created a consented profile and entered test schedules. Reloading
  retained the profile and schedules.
- PR14 enabled scheduling with delivery and ingestion still disabled. Following
  recovery, future rounds appeared in the authenticated dashboard; additional
  owner-entered test schedules also materialized. This demonstrates the live
  recovery/alarm/materialization path, not a live LINE push or reminder receipt.
- Messaging API access-token issuance and live recipient setup are still pending.
  No live push, caregiver receipt or isolated remote restore is claimed.

All evidence above describes the selected staging deployment, not production.
No medication labels, account identifiers, provider credentials or health rows
are recorded in this runbook.
