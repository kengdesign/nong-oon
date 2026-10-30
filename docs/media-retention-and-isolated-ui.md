# Media retention and isolated UI rehearsal

The isolated UI command is `node scripts/media-review-isolated-ui.mjs`, then open http://127.0.0.1:8799. It creates two synthetic drafts and the care profile `Keng - Test (LOCAL ONLY)` in disposable in-memory SQLite. It uses the actual review UI and handlers, a fixed image transport and simulated extraction. It does not authenticate as Keng, connect to Cloudflare, send LINE messages, or measure OCR/ASR. Closing the process destroys the database.

For the first draft, enter synthetic dose/instructions and a valid one-day schedule, check the acknowledgement, review the summary and explicitly confirm. Reload and verify the first draft is confirmed. Cancel the second draft and use the visible test-only cleanup button. Expected aggregate: schedules=1, confirmed=1, cancelled=1, reviews=0, objects=0, privatePayloads=0. Do not confuse this local UI rehearsal with main staging acceptance or a real-provider quality measurement.

Cleanup deletes payloads at expiry, deletes R2 objects, verifies absence with R2 HEAD, then atomically removes associated reviews, receipts and completed job manifests. Before expiry, manifests and receipts stay to prevent duplicate ingestion and confirmation. Confirmed medication schedules are separate records and are not erased by source retention. Expired unsend tombstones and old daily budgets are removed in bounded batches. Consent rows retain their own 30-day lifetime and are removed after expiry when no job needs them.

Unsettled writers retain manifests, including after lease expiry, so a delayed put can be swept again. Normal pipeline invocations release their lease when they settle. A crashed invocation whose writer completion cannot be established still needs reconciliation; this patch deliberately does not claim guaranteed full metadata erasure for that case. A failed DELETE or non-empty/failed HEAD retains the manifest for retry. R2 adapters without HEAD do not certify metadata erasure.

Validation on 2026-10-30: exact-expiry SQLite tests and R2 adapter failure tests; local UI HTTP startup/profile check. No new Cloudflare deployment, real elapsed 24-hour test, or positive Thai speech/provider measurement has been completed for this patch.

Real quality input requirements: deidentified packaging photos for blister, bottle and sachet, plus intelligible Thai speech (not silence), with independent human transcripts and field gold. Existing synthetic labels, parser transcripts and silence WAV cannot certify real-data accuracy. Do not mark generated text as human-reviewed.
