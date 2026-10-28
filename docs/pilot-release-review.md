# Pilot preservation and release review

## Preserve the approved trial

The authorized trial is 27 October 2026 09:00 to 28 October 2026 09:00
Asia/Bangkok, for the previously verified owner only and existing schedules.
Do not extend it, add recipients or infer delivery from an enabled switch.
This document does not change runtime configuration or authorize production.

Repository defaults disable delivery and empty the allowlist. Before any
deployment, compare the effective current variables with the effective proposed
variables, including retained encrypted runtime settings. Do not treat an omitted
variable as preserved without verifying the deployment mechanism retains it.

`node scripts/deploy-preflight.mjs` reads a JSON object from standard input with
`before` and `after` objects. Values must be strings. Use the same setting names
as the Worker. Feed the input through an approved private operator channel;
never put it in command-line arguments, shell history, Git, CI artifacts or chat.
The program performs no network request, sends no LINE message, changes no
settings and prints only fixed error codes and setting names. Exit 0 means the
supplied snapshots preserve protected values; exit 1 means stop and reconcile.
Malformed and oversized input also fail closed.

The input must include environment/origin, scheduler/delivery, recipient list,
both ingestion gates and both retention gates. Include all other configured
protected settings, especially administrator activation/owner, pilot timestamps
and LINE configuration. Secrets need not be exported: an operator may use the
same opaque reference in both snapshots only after independently confirming
that the existing encrypted setting will be retained unchanged. The tool cannot
verify those assertions or discover omitted secrets.

This is a manual preflight helper, not a deployed gate or automatic Wrangler
integration. It does not validate tokens, resolve identities, check schema,
approve configuration changes or guarantee the actual deployment matches its
input. Never attach private input to a PR. Run it immediately before deployment,
verify the selected Worker and exact commit, then reload runtime settings and
check authenticated owner access and effective window state after deployment.
A failure is a reason to inspect configuration, not to overwrite live settings
with repository defaults. Deliberate setting changes require their own review.

## Collect results after 28 October 2026 09:00 Bangkok

Use read-only inspection of the existing staging database and administration
page. Do not create schedules, resend jobs or reset attempts to obtain evidence.

| Review | Required evidence | Result still pending |
| --- | --- | --- |
| Trial boundary | Effective sending closed at/after the exclusive stop | Yes |
| Attempts | Counts and coarse outcomes within the approved window | Yes |
| Duplicate behavior | Retry identities preserved; accepted retries distinguished from new sends | Yes |
| Reports | Owner-entered reports persist without changing their meaning | Yes |
| Receipt | Owner feedback, separate from API acceptance | Yes |
| Deadline crossing | Identify attempts initiated before stop that completed later | Yes |
| Operations | Scheduler, retention and alarm outcomes; quota/dead/late totals | Yes |

Record timestamps in Bangkok time and aggregate counts only in repository
evidence. Keep recipient IDs, medication labels, notification bodies, invite
codes, retry identifiers and raw health rows out of Git and logs. `attempts`
can include a reserved attempt abandoned at the deadline; do not equate it with
HTTP sends. `ACCEPTED` and `ALREADY_ACCEPTED` do not prove delivery or consumption.
No response is not an emergency diagnosis.

## Production readiness remains a separate decision

After the trial, record pass/fail/unknown for each item above. Investigate any
duplicate, missed expected attempt, unexpected recipient, storage error or
window violation before proposing expansion. Review the selected production
origin, LINE callback/provider, isolated database/bindings, applied migrations,
secrets, access controls, maintenance triggers and recovery procedure before a
production deployment. Do not reuse staging data or silently enable production.

Caregiver and real partner acceptance/revocation require their own accounts only
when those features are released. They do not block the owner's self-care pilot.
OCR, voice, payments and dose recommendations remain outside this release.

## Staging release preservation — 28 October 2026

The root Wrangler configuration now sets `keep_vars: true` and omits `vars`.
Automatic builds therefore retain existing dashboard runtime variables rather
than applying the previous delivery-disabled and empty-allowlist defaults.
This configuration targets the existing staging Worker only. It is not a
bootstrap configuration for a new Worker: existing environment, origin,
ingestion/delivery guards and owner configuration must be inspected first.
Secrets are retained without uploading or deleting any secret values.

Pre-release read-only inspection confirmed the approved window was expired,
one allowlisted recipient, unchanged staging bindings, authenticated owner
access, ingestion disabled and scheduler/retention enabled. The preflight
comparison passed for the preservation projection; the encrypted administrator
switch was verified through authenticated owner access, while remaining
encrypted values used unchanged opaque references. This does not certify
post-deployment values; reload and compare them after each release.

Pilot D1 aggregates: six expected occurrences, six recorded doses and six
accepted reminder jobs; six attempts, no retries, no duplicate outbox-key groups,
no missing expected dose/acceptance, and no recorded attempt or acceptance at or
after the exclusive stop. Attempted recipients matched the owner. These are
database observations, not proof of handset receipt or full HTTP telemetry.

The combined PR 26/27 review copy passed syntax checks and 135 tests.
The owner also completed a Wrangler 4.154.0 dry run using the equivalent
runtime-preserving configuration. No production activation, pilot extension,
recipient expansion or schema migration is part of this release.
