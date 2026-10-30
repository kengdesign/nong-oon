# Staging quality candidate

This candidate expands the historical reference snapshot to 12 entries. It does not certify current registration status, general recognition accuracy or pilot readiness.

Run `node scripts/prepare-quality-mocks.mjs` to materialize three synthetic JPEG labels and one silence WAV negative test in `acceptance-media/private/mocks`. The three layout names are corpus categories; these drawings are not realistic photographs of those packages. Never mark synthetic transcripts as independently human-reviewed. Silence is not a positive Thai speech sample.

## Staging manual acceptance (delivery must stay false)

1. Record deployed commit/version and verify `/health` has deliveryEnabled=false. Verify bindings and gates in Dashboard without exporting secrets. Dry-run cannot verify live preserved variables.
2. Use a separate test LINE account and separate test care profile with consent. Do not mix synthetic entries into a real person's regimen. Send one mock JPEG from LINE, wait for awaiting_review, inspect name/strength against the fixed fixture text. Record only aggregate status, not transcript, account IDs or source URLs.
3. Fill missing fields with clearly synthetic test values in that isolated profile. Save review: assert no schedule yet. Explicitly confirm: assert exactly one schedule. Refresh/repeat submission: assert no duplicate.
4. Send a different mock. Cancel through the UI and confirm it cannot subsequently be confirmed; verify existing confirmed schedule is unchanged.
5. Verify cancelled/confirmed source is inaccessible through the owner UI and absent in R2 after actual cleanup at current time. Do not advance the global staging clock or delete objects by an unscoped prefix. Test 24-hour expiry only after real expiry. Confirm no draft/OCR payload remains in D1; retain receipts according to policy, never equate inaccessible with physically deleted.
6. Remove the synthetic schedule and withdraw the isolated test profile's consent. Verify deliveryEnabled remains false. Report extraction, review, confirmation, replay, cancellation, R2 deletion and D1 clearing separately as pass/fail/not_run.

These are operator steps, not an automated staging success claim. Existing `media-flow-acceptance.mjs` is local SQLite/R2 adapter coverage only.

## Real quality corpus still required

Privately collect at least three de-identified photographs per category (blister, bottle, sachet), including rotated/glare/blur conditions, plus Thai speech WAV recordings with distinct wording/noise. Place under `acceptance-media/private/quality/{blister,bottle,sachet,voice}/`. Remove names, patient numbers and identifying details before upload. A separate human must transcribe the entire image/audio and annotate available fields, leaving absent fields null; do not use the extractor to manufacture gold. For `media-quality-batch.mjs`, supply a JSON object with cases containing layout, sourceKind, reference, predictedTranscript, and review {humanReviewed, scope, referenceDraft}. Raw corpus and provider output must never be committed. The script makes zero provider calls; OCR/STT transcripts must come from separately authorized measurement. Report Unicode codepoint error rate separately from exact field correctness; synthetic fixture results do not establish real-world accuracy.

## API E2E runner (post-intake; never a full E2E certificate)

`node scripts/staging-media-e2e.mjs acceptance-media/private/e2e-manifest.json`

Requires an **existing separate test LINE account**, an empty consented care profile named exactly `SYNTHETIC E2E`, and two distinct synthetic JPEGs already delivered via the LINE webhook and processed to `awaiting_review`. The current app has no web upload/test-intake API. Do not create fake LINE signatures or insert mock jobs/sessions into the main staging database. The manifest is private and contains `{ "syntheticOnly": true, "patientId": "<test-profile-id>", "jobs": ["<first-job-id>", "<second-job-id>"] }`. IDs come from the test account's authenticated job list, never from Keng's existing drafts.

The operator supplies the test account's existing session cookie through local environment variable `NONG_OON_TEST_COOKIE` (secret; never paste into chat or commit). If the client is behind Access, supply existing authorized `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` only if already available; do not create new credentials or disable Access for a test. The ordinary browser Access login does not automatically authenticate Node. The runner never prints credentials, raw responses, patient/job IDs or transcripts. It obtains CSRF from `/api/session`, rejects redirects/HTML, and checks staging/delivery=false before any writes.

It validates both synthetic jobs before mutation, saves a correction without creating a schedule, confirms and replays the same request, cancels the other reviewed job twice, verifies cancellation blocks confirmation, verifies source access is denied, and rechecks delivery. It deliberately leaves `endToEndPassed=false`, R2 deletion and D1 clearing `not_run`. A failed or timed-out mutation must be investigated from the last checkpoint before rerunning; it never blindly retries with a new confirmation ID. A successful workflow leaves exactly one explicitly synthetic schedule. Remove/withdraw only the isolated test profile after evidence collection; this is not automatic teardown and metadata/replay receipts are retained according to policy.

Generate read-only proof SQL once:

```powershell
node scripts/prepare-staging-e2e-proof.mjs acceptance-media/private/e2e-manifest.json
if ($LASTEXITCODE -ne 0) { throw 'Proof preparation failed' }
npx.cmd --yes wrangler@4.154.0 d1 execute DB --remote --config wrangler.jsonc --command (Get-Content acceptance-media/private/e2e-proof.sql -Raw) --json
if ($LASTEXITCODE -ne 0) { throw 'D1 evidence read failed' }
```

After the real cleanup cron and all leases expire at **actual current time**, expected scoped counts: jobs_found=2, confirmed=1, cancelled=1, uncleared_payloads=0, remaining_reviews=0, replay_receipts=1. These counts **do not prove R2 absence**. Separately check each exact synthetic object's key in R2 with an authorized admin and record absence, not merely an API 404 or access failure. No bucket-wide delete, global clock change or forced cleanup against unrelated jobs. Original payload deletion does not mean all metadata has been erased. This runner does not certify the browser's visual/editing flow either; browser UI acceptance remains separate.

## Additional regression coverage

`node scripts/synthetic-quality-regression.mjs` exercises 15 fixed synthetic transcript cases / 32 field assertions: packaging categories, conflicting products, manufacturer exclusion, missing fields, invalid times, PRN, Thai explicit fields, negation and empty speech transcript. These are **text inputs after OCR/ASR**, no additional rendered images or positive speech recordings. It reports no OCR/ASR accuracy and no paid provider calls. Real provider/corpus quality remains pending.

Current execution evidence: 224/224 local tests passed after these additions. The actual handlers and disposable SQLite/R2 adapter pass the runner; the Node request to staging was blocked by Cloudflare Access before any mutation. A browser session can read `/health` with deliveryEnabled=false. No separate test account/profile/intake evidence was available during this run, so live confirmation/cancellation and physical deletion remain NOT RUN. Do not deploy configuration changes to solve an authentication/fixture prerequisite.
