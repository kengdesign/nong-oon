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
