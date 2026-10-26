# Medication scheduling and LINE delivery

This implementation is not evidence of a live LINE delivery test or of Cloudflare alarm execution. Unit/integration tests use actual local SQLite and mocked outbound HTTP. Live staging switches remain independently controlled by the deployment owner.

## Timing policy

- Bangkok timezone only (`Asia/Bangkok`, UTC+07:00); no device timezone or inferred medication instructions.
- Each saved medication schedule supplies explicit start/end dates, weekdays (0=Sunday) and up to eight `HH:mm` values. A patient has up to twenty active schedules.
- Materialize today and tomorrow; one persisted Durable Object alarm per patient wakes at the next due, caregiver alert, retry or needed replenishment boundary. Forecasting the next wake computes dates only, with no occurrence hashing or database writes. Distant future starts cause one replenishment wake on the day before the occurrence; ended schedules stop without an endless midnight alarm.
- A reminder expires fifteen minutes after its configured due time. Missed historical reminders are not backfilled. A dose can be reported during the two hours after due time; the reporting window is a product setting, not guidance to take medication late.
- An active invited caregiver gets one generic no-response alert thirty minutes after due time, valid for fifteen minutes. Either report (`reported_taken` or `reported_not_taken`) suppresses this no-response alert. Absence of a report is not a diagnosis or emergency.
- Occurrence IDs are stable for patient + medication schedule ID + Bangkok date/time, independent of global schedule revision. A schedule edit cannot recreate an already-due/reported occurrence. Only pending future records and never-attempted future notification intents can move to the newest revision.
- Pausing and later resuming safely rearms only future, unattempted, still-authorized cancelled intents. Sent/attempted and already-due intents are never restarted.

## Atomic outbox and retry contract

Migration `0006_delivery.sql` adds nullable `dose_records.schedule_id`, `notification_outbox`, `scheduler_control` and `delivery_budget`. One transactional D1 batch inserts/revises dose rows, rearms eligible future intents, and inserts owner/caregiver intents. Unique `(patient_id,dose_id,recipient_actor_id,kind)` prevents duplicate logical notifications. Health labels/instructions are absent from the outbox.

Each intent has a persisted version-4 UUID, used as `X-Line-Retry-Key` from the very first LINE push attempt and every retry. A thirty-second CAS lease guards concurrent workers. Attempts persist before outbound HTTP; an HTTP timeout or crash after LINE accepted the request reuses the same key and payload after lease expiry. A SHA-256 payload hash and persisted recipient prevent a modified payload from using an old key. No private LINE response body or request ID is logged or stored.

Accepted 2xx or a 409 carrying `x-line-accepted-request-id` marks the request accepted, which does not prove delivery to the recipient. Network failures and 5xx use exponential backoff (15, 30, 60, 120 seconds) up to five total attempts, always inside the notification's expiry and the LINE twenty-four-hour retry-key horizon. Other 4xx, including rate/plan caps, end the intent. Outbound calls time out after ten seconds; redirects are rejected.

Permission, account-block state, active patient consent, active membership, pending dose and current active schedule version are checked during the lease write and again immediately before the network attempt. A request already accepted by LINE cannot be retracted by a later withdrawal. No new attempt is made using revoked rights.

## Deployment gates and cost limits

Actual HTTP requires all of:

1. `SCHEDULER_ENABLED=true` and `DELIVERY_ENABLED=true`.
2. `LINE_CHANNEL_ACCESS_TOKEN` entered through the secure deployment interface.
3. A valid fixed HTTPS `APP_ORIGIN` with no trailing slash.
4. `LIVE_LINE_RECIPIENTS` JSON array containing 1–10 explicit `U` + 32 hexadecimal LINE user IDs from the same LINE provider as Login/Messaging API. It is an administrator-controlled pilot allowlist, never request input.

Every claim atomically reserves a hard pilot budget of 100 attempts/day globally and 20 attempts/day per recipient, using Bangkok days. Failures/timeouts count. Each object wake processes at most ten ready intents. Tests never send paid LINE or AI requests. Updating these deliberately conservative caps requires an explicit code change/review.

`PatientClock` is bound as `PATIENT_CLOCK`, uses SQLite-backed Durable Object storage and is not publicly routed. Root calls `armPatient(env,patientId)` after relevant care mutations. `recoverSchedules(env,now)` visits at most one hundred active patients with non-ended schedules per recovery invocation using a persisted cyclic cursor, so later patients are not permanently starved. Recovery uses an internal `onlyIfMissing` wake that preserves a healthy future alarm rather than rerunning every patient's forecast every five minutes. Recovery is a repair mechanism; per-patient alarms are the normal timing path.

Failing/disabled delivery configuration does not poll ready intents every second. Alarm selection filters the live recipient allowlist and ignores outbox timing entirely if delivery configuration is incomplete. The scheduler may still materialize future dose rows for an enabled, non-sending staging test.

## Operational retention

Root maintenance owns the retention policy. `notification_outbox.expires_at` and `delivery_budget.day` have covering indexes. Daily-budget buckets can be removed after the chosen operational retention horizon. `scheduler_control` stores only a bounded recovery cursor and last-run timestamps. Durable Object storage contains patient ID, alarm and last-success timestamp; patient consent withdrawal leaves no active alarm after the next wake/recovery cycle.

## Verification

Run `node --test tests/scheduler.test.mjs tests/delivery.test.mjs tests/patient-clock.test.mjs`.

Coverage includes actual SQLite transactional rollback; revision-safe occurrence IDs; pause/resume and invitation revocation/regrant; explicit weekdays/calendar boundaries; no historical backfill; competing leases; crash after LINE acceptance; stable retry keys; report/consent/account revocation before send; last-moment expiry; caregiver no-response suppression; five-attempt exhaustion; 4xx terminalization; daily caps; allowlist alarm filtering; persisted object re-instantiation; failure rearming and cyclic recovery across more than one hundred patients.

Primary API references: [LINE retry contract](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/) and [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
