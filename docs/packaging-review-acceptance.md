# Partial printed packaging acceptance

The extractor accepts literal uppercase name + strength pairs, or repeated adjacent
name/ingredient-strength pairs on printed packaging. It does not use a drug lookup,
repair OCR spelling, interpret bare pills, or generate missing regimens. Conflicting
candidates stay unknown. This bounded parser cannot guarantee every OCR layout.

## Automated disposable run

`node scripts/media-flow-acceptance.mjs`

Runs the real ingestion, processing, extraction, review, confirmation/replay,
cancellation and cleanup handlers against disposable SQLite and an R2 adapter.
UI tests verify blank editable unknowns and separate explicit confirmation.
No remote writes or provider calls. This is not evidence of staging acceptance.

## Staging manual acceptance (owner session)

Keep DELIVERY_ENABLED=false. Use a disposable synthetic care profile and fictional
packaging only. Never use a real medication schedule to test confirmation.
1. Send one new synthetic packaging image through LINE after deployment. Wait up
   to six minutes, then load the review list. Existing stored drafts are immutable
   extraction results and are not automatically rerun by a parser deployment.
2. Compare recognized name/strength and evidence with the source. Missing amount,
   directions and dates/times remain blank. Fill only synthetic known answers.
3. Review summary, verify strength/amount included. Return to edit, change one
   value, review again, then explicitly confirm. Verify one schedule only.
4. Reload/repeat confirmation: no second schedule. Test another disposable draft:
   cancel, verify source/review unavailable and no schedule added.
5. After the cleanup cron, verify those terminal draft source objects are absent
   and draft/message payloads cleared. After 24h verify an unconfirmed disposable
   draft expires. Preserve confirmed schedules and replay receipts.
6. Read aggregate D1 job state/error/attempt counts and Queue metadata before and
   after. Do not export OCR text, IDs, tokens or source photographs in reports.

Source access expires at 24h; physical deletion is asynchronous and may be delayed.
Metadata manifests/receipts currently remain for late-write cleanup and replay
protection; this change does not invent a metadata retention period or purge them.
Quality requires independently reviewed full transcription and field reference data,
multiple image/voice cases, and separate transcript/field scores. One passing fixture
or a partial reference does not certify production accuracy or pilot readiness.

LINE OA: disable scheduled automatic responses and select manual chat while keeping
Webhook on. This removes the misleading generic fallback; it does not assert that a
Webhook event was processed. Users check job status on the review page.
