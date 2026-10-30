# One LINE account: isolated rehearsal

No second account, SIM, logout, copying Keng records, or renaming the real profile is needed. `acceptance-media/single-account-e2e.mjs` is a separate worker with its own newly created D1 and R2, no public routes, no LINE bindings and no connection to the main app database. It creates a synthetic actor/profile **inside that isolated database**, not inside Keng's real care space. It does not simulate an authenticated Keng login.

The scheduled run uses the existing fixed blister and bottle JPEGs. Image transport substitutes a fixed internal download adapter (no LINE message/signature is forged). The real Google Vision adapter reads those images, the real review API handlers save corrections, explicit confirmation/replay creates one schedule, cancellation blocks the other, cleanup runs at the real current time, R2 HEAD must confirm absence, and SQL must confirm draft/message/review payloads are gone. The synthetic profile is withdrawn to leave no active test schedule. Random object keys, audit/manifest/replay metadata remain; this is not full metadata erasure. A durable claim prevents another paid run after failure/crash. A failed run may retain test-only objects pending diagnosis.

This certifies an isolated backend rehearsal only: it does **not** prove the LINE webhook, the actual browser review UI, the main staging bindings/cron, 24h expiry, general OCR accuracy or voice accuracy. Main staging LINE-to-draft intake for the two synthetic images has separate browser evidence. Do not combine separate checks into an unqualified full staging E2E pass.

## Run on Windows (Node 22+ with node:sqlite; Node 24 recommended)

From repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-single-account-e2e.ps1
```

The script creates uniquely named `nong-oon-e2e-*` resources, applies existing migrations to **E2E_DB only**, asks Wrangler to store an existing Google Vision key for the isolated worker, deploys, polls the aggregate evidence, then disables that worker's cron. Secret values never go into chat, source or reports. Do not retrieve the main worker's secret value or weaken Cloudflare Access. Real Vision calls (maximum two, no automatic replay) and the isolated resources may incur normal provider charges. Keep any Google-side API restrictions compatible with Vision.

If automatic cron shutdown fails, select the named isolated worker in Cloudflare → Settings → Trigger events and remove its cron. Do not change `nong-oon-staging` settings. Retain the isolated report and resources for inspection; resource destruction is deliberately not automatic. The generated config lives under gitignored `acceptance-media/private/single-account/`. Delete no real health data.

## Evidence recorded during implementation

Local tests execute the actual pipeline, review/confirmation/cancellation handlers and cleanup against disposable SQLite/R2 adapters and a synthetic Vision response. Those are local assertions, not Cloudflare or live OCR success. The production entrypoint, bindings, migrations and LINE delivery switch are unchanged. Remote run remains NOT RUN until the operator script returns its evidence. Browser rendering acceptance remains a separate pending step.

Cron startup may take longer than one five-minute interval. The operator waits up to 25 minutes before disabling the isolated cron. A timeout is not an OCR failure: inspect the existing evidence row before resuming; never recreate resources or clear the singleton claim to force a paid replay.
