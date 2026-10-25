# Staging inbox retention

The Worker receives `17 * * * *` (minute 17 each hour, UTC) scheduled events.
It runs only when APP_ENV=staging and RETENTION_ENABLED=true. To pause cleanup,
set RETENTION_ENABLED=false and deploy. Ingestion, synthetic ingestion and LINE
delivery remain disabled independently.

Each event executes one indexed DELETE, ordered by expires_at and event_id,
limited to 100 expired inbox rows. There is no drain loop, retry loop or public
maintenance endpoint. Future rows remain untouched. Failed runs raise the fixed
RETENTION_RUN_FAILED error without including row contents.

Inbox expiry is set seven days after receipt. Actual deletion occurs on an hourly
cleanup run and may lag further when more than 100 rows are overdue. This bounded
staging schedule is not a guaranteed production deletion deadline. Reassess
throughput and observability before allowing real user ingestion.

Before/after inspection in the named staging D1 console:

```sql
SELECT COUNT(*) AS total,
  COALESCE(SUM(expires_at <= CAST(strftime('%s','now') AS INTEGER)*1000),0) AS expired
FROM webhook_inbox;
```

Tests exercise the actual exported scheduled handler with real SQLite: 105
expired rows are removed in batches of 100 and 5, preserving a future row.
Cloudflare deployment/trigger configuration is separate evidence from an actual
scheduled execution. Do not report the latter as verified until it is observed.
