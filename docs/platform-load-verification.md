# Isolated Cloudflare load verification — 26 October 2026

After PR #22, ran the bounded scheduler/alarm drill against the isolated synthetic database and Worker. The reviewed build was deployed with Cron initially disabled, then a one-minute Cron was added, saved and verified after reload. Normal staging delivery remained disabled throughout.

D1 recorded exactly ten distinct profile completions in each of cycles 1, 2 and 3, for 30 total. Completion windows (Bangkok): cycle 1 15:33:02–15:33:08, cycle 2 15:33:56–15:34:01, cycle 3 15:34:57–15:35:03. These rows verify per-cycle completion after the overlapping-Cron fix. The existing 10 profiles / 200 schedules / 3,200 doses / 6,400 notification intents were retained; this rerun exercises recovery and alarm idempotency on populated storage, not creation from an empty database. The earlier isolated run exercised initial materialization.

Final control state: runs=3, expires_at=0; current-cycle completions=30; notification attempts=0. PRAGMA quick_check returned ok and pragma_foreign_key_check returned zero violations. Prior incomplete-cycle rows remain archived under cycle numbers above 100 and are excluded from these counts.

Cloudflare Observability displayed 95 successful events and zero errors in the selected one-hour window. Two inspected events from the final cycle had outcome ok: scheduled handler CPU 5 ms and alarm CPU 26 ms, under the configured 50 ms per-invocation budget. These are individual CPU samples, not maxima, percentiles, full-traffic latency guarantees, or proof of LINE delivery under load. No live LINE token is provided to the isolated handler.

Cleanup: set the drill deadline to zero, removed the Cron, saved, reloaded and verified No cron triggers configured. Automatic builds remain disabled for the isolated Worker. Normal staging was not seeded, restored or armed for sending. Live partner-login verification remains separate; it does not block the owner-only pilot.
