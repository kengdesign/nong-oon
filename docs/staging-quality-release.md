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
