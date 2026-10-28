# Phase 2 execution ledger — 28 October 2026

Baseline: main after PR 26/27, commit 1892736fdc48c40f45586d488482265ddcf8affd.
Implementation is on a separate feature branch; no release/AI/resource activation.

| Item | Status | Evidence / remaining work |
| --- | --- | --- |
| P2-01 Commands and draft schema | Implemented, offline | Strict contract, JSON Schemas, assessment and adversarial tests; not an intent recognizer or confirmation API |
| P2-02 Thai evaluation corpus | Seed implemented | 26 synthetic annotated text cases and offline runner; audio/image corpus, ground-truth review and model measurements pending |
| P2-03 Media consent and retention | Policy and guarded integration implemented | Scoped/versioned consent, exact owner/profile matching, revoke/unsend/TTL/terminal-state denial; Consent API/UI and guarded job storage added; live purge acceptance pending |
| P2-04 Media pipeline | Implemented behind disabled gates | Durable jobs, private R2 interface, queue claims/recovery, bounds and repeated cleanup; actual provider/resources and complete retention rollout pending |
| P2-05 Review and confirm UI | Backend and UI implemented | Source comparison, explicit review and transactional idempotent confirmation tested; browser and live acceptance pending |
| P2-06 Thai STT comparison | Offline evaluation harness implemented | Requires approved provider setup and representative consented/synthetic audio; do not claim accuracy from text fixtures |
| P2-07 Printed-label OCR comparison | Offline evaluation harness implemented | Representative image quality, Thai/English, units and item-alignment evaluation |
| P2-08 Voice read/report commands | Pending | STT, target resolution, permissions and user confirmation integration |
| P2-09 OCR draft creation | Pending | OCR adapter, grounded excerpts and field review; no automatic activation |
| P2-10 Caregiver draft review | Pending | Real-account permission/revocation tests; partner admin is not caregiver |
| P2-11 Quality/cost dashboard | Pending | Aggregate-only counters, explicit AI budgets, failure and quota visibility |
| P2-12 Bounded Phase 2 pilot | Pending | Feature guards, measured quality/cost, rollback and isolated rollout |

## Safety and evidence

No raw messages, patient records, credentials or real media were used. New modules are wired into the proposed Worker behind staging-only disabled flags;
they have not been deployed. Existing schedules, recipient lists,
delivery/ingestion switches and infrastructure configuration remain unchanged.
Contract tests establish deterministic validation only, not clinical correctness,
Thai ASR/OCR accuracy, API reliability or live resource/deletion behavior.

## P2-03 integration requirements

Collect an explicit media-extraction consent separately from care-profile consent.
Show the actual selected provider, purpose, transfer destination and retention
before processing real media; the provider decision is not made by this module.
The policy receives authenticated records from the server, never model fields.
Recheck before download, inference, display and confirmation. Confirmed jobs are
not eligible for further extraction. Unsend/withdraw must cancel pending work and
remove associated media/drafts, but must not silently delete a confirmed schedule.
The 24-hour access ceiling is implemented, but physical deletion is asynchronous.
See media-pipeline.md for live-resource, provider, retention and UI acceptance gates.

## CI runtime update

PR 28 pins checkout v7.0.1 and setup-node v7.1.0 (Node 24 actions), uses
Ubuntu 26.04 with Node 22/24, and disables unnecessary credential/cache persistence.
Run 40632153500 passed both jobs for the workflow update. The media changes require
their own CI result; no main-branch merge or deploy is implied.
