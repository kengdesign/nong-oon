# Nong Oon delivery gates

## Status and source of truth
This branch is a foundation prototype, not a production medication service. Tests of pure logic and mocked adapters do not establish actual Cloudflare/LINE integration or availability.

## Work order
1. Domain validation and authorization: foundation completed; internal SQL adapter now persists reports/cancellation and audit atomically; authenticated API integration remains pending.
2. LINE webhook HMAC verification: foundation implemented; durable minimal inbox in progress.
3. Caregiver UI: synthetic in-memory demo only; not connected to patient records.
4. Staging Worker + D1 migration + signed synthetic smoke tests.
5. LINE verification + user-approved synthetic end-to-end test.
6. Authenticated caregiver consent and schedule API; per-patient Durable Objects scheduling; transactional outbox and notification retry/deduplication.
7. Privacy, retention, backup/restore, late-job policy, quotas, monitoring, load tests against mock LINE.
8. Limited pilot only after independent review. OCR/voice/payment remain disabled until separately tested.

## Non-overlapping ownership
Root: integration/configuration and release decisions.
Backend implementer: webhook, ingestion, migration and corresponding tests.
UI implementer: public/ only, no backend changes.
Independent QA: read-only review and tests; return findings to owner rather than competing edits.

## Safety
- No inferred dose instructions or automatic medication identification.
- A report is self-reported intake, not proof of actual consumption.
- Lack of confirmation is not an emergency diagnosis.
- No real health data, credentials, raw payloads or tokens in GitHub/logs/test fixtures.
- Every dose command must bind patient, dose and schedule version; server-derived capabilities are mandatory.
- Do not connect live LINE webhooks to an unfinished processor merely because verification succeeds.

## Staging configuration
wrangler.jsonc targets only nong-oon-staging and the separately created staging D1. No production custom domain routes are configured yet. DELIVERY_ENABLED is false and there is no outbound delivery adapter. Secrets must be entered through a secure Cloudflare interface by an authorized person; never commit or paste into chat.

## Spend controls
Zero runtime dependencies for current core/UI. No AI for button presses or scheduling. CI cancels superseded jobs and has a timeout. Load tests must not send paid LINE/AI requests. No additional subscriptions or plan upgrades without approval.

