# OCR response bound and quality evidence

The operator's redacted diagnostic reported HTTP 200, 307,578 response bytes, 249 text characters, one response and no provider error or forbidden control character. The old 262,144-byte JSON cap rejected that valid envelope before extraction. This is evidence of the integration failure, not recognition accuracy.

The adapter now permits at most 1,048,576 bytes of Vision JSON, cancels larger streams, and still validates JSON, provider errors, response count and the 8,000-character text limit. Acceptance captures only validated bounded text in memory rather than cloning and parsing an unbounded response. No provider, credential, package, deployment or delivery configuration changes.

Unknown reference fields have separate counts and do not count as accurate fields. Both voice and image require at least one known reference field to pass the engineering screen; passing still returns pilotReady=false. Natural speech extraction remains deliberately narrow and must not infer dosage.

## Local verification

Run `npm run check` and `npm test`. New offline regressions exercise the observed response size, exact cap, oversized stream cancellation, unknown-only references and failed-image retry without repeating voice. These tests do not call Google, Workers AI, LINE or live D1/R2.

## Windows operator verification

Stop the previous acceptance preview with Ctrl+C before updating files. Back up existing changed files before replacing them from the reviewed pinned commit. Do not replace private samples or .dev.vars.

1. `node --test tests/media-providers.test.mjs tests/media-acceptance.test.mjs tests/media-evaluation.test.mjs tests/media-quality-run.test.mjs`
2. Start `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/start-media-quality.ps1` and wait for Ready on port 8798.
3. Run once: `node scripts/media-quality-run.mjs --kind image --retry-failed`.

The retry is allowed only for a previous failed SAMPLE_OR_PROVIDER_REJECTED receipt. It archives the receipt and prior aggregate, skips voice entirely and refuses successful/started/timeout replays. Keep the aggregate result even if screen=needs_review. Do not change reference text merely to improve a score: it must transcribe the actual sample. Unknown-only references cannot certify field extraction. Stop preview afterwards.

## Remaining gates

Actual image and voice accuracy on multiple synthetic Thai samples is not yet established. The main cleanup function passed real isolated D1/R2 cron acceptance in operator evidence; this does not verify the main staging cron. Metadata retention age and current staging switches require explicit verification before Phase 2. This patch does not enable those switches or authorize a pilot.

## Independent reference assessment (follow-up)

A reference containing only selected lines must not be compared against full-image OCR as a certified full-transcript error rate. The earlier 82.9% is an unqualified raw comparison, not a validated Google accuracy estimate. No revised score is available without a matching transcript pair and reviewed scope.

Acceptance now requires a private `<kind>.reference.json` sidecar with `scope` (`full` or `partial`) and `humanReviewed: true` before a paid runner request. A full-transcript score is available only for human-reviewed full scope. Optional `referenceDraft` must be a valid draft-contract object manually reviewed independently of the extractor. It is never generated from reference text by the extractor under test. Unknown fields remain null; unprovided times, dates, strengths and identities must not be guessed. No gold means no field score. Image and voice must both pass their separate transcript/field screens before the engineering screen passes; pilotReady remains false in every result.

Offline analysis needs a private JSON file with `sourceKind`, `reference`, `predictedTranscript`, and `review` (the sidecar object above). Run `node scripts/media-assess-offline.mjs acceptance-media/private/offline-case.json`. It performs zero provider calls, writes no transcript and prints only aggregate results. The earlier aggregate receipt does not contain the OCR transcript, so it cannot reconstruct or rescore that run. Do not rerun OCR simply to manufacture a passing result. Private images, transcripts, human gold and identities must never be committed. Public regressions use invented text only.

The narrow labelled-line extractor is still a limitation for natural hospital labels or speech. This change makes that limitation visible; it does not claim to solve natural-language extraction or authorize automatic medication scheduling.

## Conservative label excerpts (29 October follow-up)

Explicit labels accept whitespace before ASCII/full-width colons. Duplicate labels remain conflicts regardless of spacing. A single line beginning with an explicit Thai administration verb can be preserved verbatim as an instruction excerpt for human review. Multiple directions or disagreement with a labelled instruction leave instructions unknown and mark a conflict. This is not a complete multiline interpretation.

No natural-language dose, frequency, bedtime clock, weekday, start date or medication identity is inferred. Patient-name lines are not drug names; PRN still clears clock times. All missing fields and source verification/confirmation gates remain. Validation: npm run check, 197/197 offline tests, 26/26 synthetic contract fixtures on Node 24.22.1; zero provider calls. Real-sample quality and staging acceptance remain unverified.
