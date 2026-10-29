# Phase 2 media implementation and rollout gates

This feature is implemented behind staging-only guards. It is not a staging
release, a provider integration, or evidence of real-media accuracy.

## Implemented

Signed LINE intake feeds durable D1 jobs. Job identifiers alone enter the queue.
Owner consent generation, account/profile membership, unsend, expiry and leases
are checked before work and again before sensitive reads/writes. Downloads use a
fixed LINE host, bounded streams, MIME signatures and timeouts. Private R2 objects
are accessed only through the authenticated owner API. Queue claims, retries,
per-owner/global budgets and repeated cleanup are bounded.

The separate `/media-review.html` page shows source and extracted evidence, collects
explicitly reviewed fields, saves a short-lived versioned snapshot, and separately
confirms it. Confirmation uses a transactional schedule write, current authority,
schedule/review versions and an idempotent receipt. Extraction never activates a
schedule. PRN and pill-photo inference are not supported by this intake.

Offline evaluation reports aggregate Unicode code-point edit distance and exact
field agreement. It does not report Thai word error rate, clinical correctness or
measured model quality. All automated media/provider tests use synthetic mocks.

## Required before enabling

1. Apply migration `0009_media_drafts.sql` to an isolated environment after review.
2. Provision private `MEDIA_R2` and `MEDIA_QUEUE` bindings and queue consumer/DLQ
   operations. No public bucket access. Configure periodic recovery/cleanup.
3. Implement and evaluate a server-side inference adapter. The current consumer
   deliberately has no real adapter: `provider_not_ready` prevents media download.
   Provider IDs are policy identifiers, not functioning integrations. Select the
   actual provider and verify transfer, retention and consent wording.
4. Validate media decoding and actual audio duration, provider output grounding,
   resource permissions, real D1 transactions, R2 deletion and queue redelivery.
5. Define bounded retention for cleanup manifests, receipts, budget rows and unsend
   tombstones, plus recovery/deletion alerts. Current cleanup keeps random object
   manifests to delete late puts again; it is not a complete retention rollout.
   Deletion is asynchronous and can lag the 24-hour access cutoff.
6. Visually test the review UI and exercise real-account authorization, revoke,
   unsend, multi-item review and rollback. Browser acceptance is not yet recorded.
7. Only after these gates, explicitly configure staging `MEDIA_API_ENABLED` and
   `MEDIA_PROCESSING_ENABLED` plus a supported provider. Neither flag is added by
   this change; absent flags keep the feature disabled. Preserve current runtime
   settings; do not change recipients, delivery windows or LINE switches.

## Validation

Local Node 24: `npm run check`, `npm test` (164 tests). Tests cover real SQLite
transactions with a D1-shaped adapter, mocked media/queue/R2/provider calls,
revocation races, duplicate confirmation, batch rollback and bounded evaluation.
Cloudflare resources, actual provider processing and browser rendering are separate
acceptance gates. No secrets or real health data are test fixtures.
