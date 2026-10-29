# Phase 2 remaining acceptance gates

These tools do not enable LINE, main-app media flags, or deploy the care Worker.
No result automatically approves a pilot. Do not use actual health/personal data.

## 1. Photographed Thai label and real speech

Open `acceptance-media/sample-label.html`. Photograph the fictional label with a phone
(or print and photograph it). Save JPEG as `acceptance-media/private/image.jpg`.
Create UTF-8 `image.txt` with the exact visible text, including the heading.
A screenshot/render is a useful baseline but **not** a real-photo acceptance case.
Record the Thai phrase below as PCM WAV, 16 kHz mono, shorter than 60 seconds;
save as `voice.wav`. `voice.txt` must contain exactly what was spoken:

นี่คือข้อความทดสอบระบบน้องอุ่น ไม่มีข้อมูลยาจริง

Run `scripts/setup-media-acceptance.ps1` first to make the private folder.
It prompts for a Google Vision key with hidden input and writes a git-ignored local
`.dev.vars`. Never paste keys into chat, CLI arguments, public files or commits.
Enable Cloud Vision API and billing in the key's Google Cloud project; restrict the
key to Cloud Vision API. A missing key blocks image acceptance; it is not a pass.

Run `scripts/start-media-quality.ps1`. The new PowerShell window runs Wrangler remote
preview on port 8798, with only AI + local secrets; no DB/R2/Queue/LINE bindings.
Wait for Ready, then run `node scripts/media-quality-run.mjs` in the original window.
Remote preview uploads code/secrets to Cloudflare and calls actual providers (billable).
One provider request per available sample. Receipts are written before the call and
prevent accidental repeated calls, including after timeout. To deliberately test a
NEW sample, archive its aggregate receipt and remove only that kind's `.attempt.json`.
Stop preview with Ctrl+C in its window after collecting results.

Only aggregate counts and CER are returned/persisted. The raw reference/image/audio
remain in the private folder. Provider text/drafts stay in memory. Exceptions are
redacted. `aggregate-report.json` never contains keys, transcripts or field values.
The 5% CER screen is a provisional engineering threshold, not clinical validation.
CER uses NFC Unicode codepoints and includes whitespace/punctuation. Field equality
uses the existing narrow labelled-line parser on both reference and prediction;
this is not independent clinical annotation. `knownFields` excludes nulls to avoid
inflating results by matching unknowns. Natural speech may test transcription alone;
it does not prove free-form schedule extraction. Multi-case independent Thai review,
no invented dosage, image noise/rotation, ambiguous labels and varied speakers are
still required before a pilot. A one-photo/one-voice pass is only a smoke test.

## 2. Actual application cleanup function, local and remote storage

`node scripts/media-cleanup-acceptance.mjs` runs real main `cleanupMedia` against real
SQLite with D1 API shape and in-memory storage. Tests include TTL, active control,
lease wait, consent withdrawal, delete failure retry and a delayed external write.
`node scripts/media-cleanup-acceptance.mjs --remote-r2` uses real R2 in the existing
**nong-oon-media-drill** bucket, unique acceptance/<UUID> keys only. D1 remains local.
No bucket-wide deletion and no care database access.

## 3. Main cleanup on real D1/R2 with a real scheduled event

Run `scripts/run-main-cleanup.ps1` **once**. It uses the existing isolated drill D1
f8d6fd36-0d75-45f9-9164-e2ed2225b9b0 and bucket, never staging's care DB.
It refuses import if `media_jobs` already exists, preserving existing evidence.
A temporary Worker `nong-oon-cleanup-acceptance` imports the unchanged main cleanup
function and complete app schema, with only two synthetic jobs. It verifies expired
payload/source ID erasure, physical object absence, and preservation of an active
control, then removes the control object and records a single `passed` receipt.
The cron is at most 20 minutes of polling; finally deploy sets its own flag false and
removes cron. If shutdown deploy fails, manually run:

```
npx.cmd --yes wrangler@4.154.0 deploy --config ./acceptance-media/private/main-cleanup.jsonc
```

The local config has already been set to flag=false/crons=[] before that command.
Verify this in the CLI output. For a read-only result recheck (no import/retest):

```
npx.cmd --yes wrangler@4.154.0 d1 execute DB --remote --config ./acceptance-media/private/main-cleanup.jsonc --command "SELECT state FROM acceptance_cleanup_receipt WHERE id=1"
```

This proves the shared function with live D1/R2 + scheduled execution in isolation,
not that the main staging cron is enabled. Main media remains disabled; its cleanup
is gated on APP_ENV=staging and MEDIA_API_ENABLED=true. Do not advertise automatic
24-hour deletion to real users until that rollout is deliberately configured and
observed. Metadata manifests remain intentionally retained for delayed-put cleanup;
complete metadata retention/erasure policy remains a pilot gate.
