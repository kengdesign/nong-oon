# P2-01: command and schedule-draft contract v1

Status: implemented as offline pure functions; not connected to any live route.

`src/draft-contract.mjs` exports strict validators, a bounded JSON parser and
readiness assessments. Call `parseDraft` at the untrusted JSON boundary. Unknown
keys, missing fields, model-provided identities/status/confirmation, unsupported
versions and malformed values are rejected. Error output contains fixed codes.

## Extraction format

Root: `{schemaVersion:1, sourceKind, items}`. Source kind: voice, printed_label,
printed_prescription, handwritten_prescription or pill_photo. One to twenty
items. Each item has exactly `fields` and `issues`. Fields are exactly: label,
strength, dose, instructions, times, weekdays, startDate, endDate, useMode.

Every field is `{value, evidence}`. Unknown is `{value:null,evidence:null}`.
Known values require a bounded verbatim evidence excerpt. This is provenance
metadata, not proof: a future adapter must verify excerpts against the source;
schema validation alone cannot detect a fabricated quotation or medical error.
Text fields retain source wording without dose/unit arithmetic. Strength and
amount per use stay separate. Times are explicit HH:mm in Asia/Bangkok; weekdays
are integers 0 (Sunday) through 6; dates are real YYYY-MM-DD calendar dates.
Arrays are unique/nonempty when known. `useMode` is scheduled or as_needed.
Do not derive clock times from meals or infer missing quantities, start dates,
weekdays or medication identity. PRN/as-needed with fixed times is rejected.
Bare pill photos may contain unknown fields only and cannot identify medication.
Issues: unreadable, ambiguous, conflicting, possible_duplicate,
unsupported_regimen. No AI confidence value grants activation permission.

## Command format

Exactly `{schemaVersion:1,intent,targetLabel,ambiguous}`. Supported intents:
view_today, view_remaining, report_taken, report_not_taken, create_schedule,
change_schedule, pause_schedule, unknown. Labels are hints, never identifiers.
Negative and ambiguous speech must retain its meaning; unknown intent stays
unsupported. This contract is not a Thai speech/intent classifier.

The application must resolve targets using current authenticated permissions.
Read intents still need authorization. Mutations only request confirmation;
no draft or command here can produce a schedule write, dose write or LINE send.
Even a complete draft returns activationAllowed=false. A future confirmation
endpoint must bind actor/profile, reviewed draft version, source verification,
current schedule version, consent, expiry and idempotency in a transaction.
Existing validateSchedule, authorization and quota checks remain mandatory.

## Next contracts

P2-02 adds synthetic Thai annotations and an offline runner. P2-03 defines
consent/expiry/unsend policy before P2-04 connects private media and durable jobs.
No credentials, real audio, images or health records belong in fixtures or logs.
