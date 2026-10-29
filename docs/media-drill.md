# Isolated Phase 2 drill

The drill worker has a separate D1/R2/Queue and no LINE bindings, public routes or
care records. It does not deploy or change nong-oon-staging. Synthetic payload is
fixed in source; queue messages contain only one fixed D1 job identifier.

A cron seeds one object/job and retries dispatch up to ten times. Consumer reads
the job, checks contents, deletes the object, verifies absence and records state
`deleted`. Duplicate delivery is idempotent. This proves the isolated consumer's
automatic deletion, not the main app's revoke/TTL cleanup service. Missing object
without a deletion-intent marker fails closed. Partial failure is retryable.

AI tests use a PNG reading SYNTHETIC ONLY and half a second of silence. Each type
claims a durable row before its one paid provider call. No provider transcript or
error body is stored. Voice passing proves API response shape/connectivity only,
not speech accuracy. Image passing requires the word SYNTHETIC in OCR. No real
medication, identities or health data are submitted. No automatic retries for AI.
Google Vision requires an enabled project and a restricted secret API key. Skip
image if that credential is absent; never report it passed. Workers AI and Vision
may incur provider charges. After collection, remove cron and disable drill gates.

The localhost UI uses the actual media-review assets and review/confirmation
handlers, with synthetic owner/session and OCR, disposable SQLite and mock R2.
It binds only 127.0.0.1:8799, checks Host and mutation Origin/CSRF and never calls
LINE or cloud providers. All records disappear when stopped. Browser acceptance
is manual, separate from HTTP/backend tests and production login tests.

Acceptance: unknown fields initially blank; source visible; saving shows summary
without schedule creation; explicit confirmation creates one schedule and prints
LOCAL_CONFIRM_RESULT schedules=1. Reload cannot offer the confirmed job again.
Withdraw consent stops access. Restart provides a clean synthetic session. Test
both a normal desktop window and narrow/mobile browser layout before acceptance.

Validated locally: 177 tests, syntax checks and localhost HTTP save/confirm with
one real SQLite schedule. No live Queue/AI/browser-rendering result is claimed.
The main application's provider adapter now exists in PR29; prior documentation
saying no adapter is superseded by this note. It still requires provider gates,
bindings/credentials and quality evaluation before a real-media pilot.
