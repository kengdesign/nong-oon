# Private OCR diagnosis and reference seed

OCR text is retained only in the bounded `sourceText` property of an image draft
(maximum 8000 characters). Existing authenticated owner, consent, expiry, no-store,
unsend and cancellation protections apply. It is cleared with the entire draft on
confirmation, cancellation or expiry; no new metadata lifetime or public log output.

An explicit two-step owner retry can replace an unedited awaiting-review draft.
It refuses any saved review, expired/revoked/foreign job, absent source message,
concurrent retry or three processing attempts. It retains the same source hash,
original expiry and attempt budget. Queue failure leaves durable work for cron.
No confirmation or medication schedule is created by retry.

The reference lookup is a deliberately small curated seed, not a complete drug
registry or a free-form AI classifier. Current entry: BESTATIN 20, simvastatin
20 mg, Berlin Pharmaceutical Industry, Thai FDA registration 1A 3/44(NG).
Source: https://ndi.fda.moph.go.th/drug_info/index?name=simvastatin
Retrieved 2026-10-29; source snapshot 2025-06-30. Lipid-lowering classification
also documented by the Thai FDA Orange Book. No assertion of current registration
status, personal indication, authenticity, dose or schedule is made.

Reference data appears separately only for exact name AND strength matches.
Berlin alone, fuzzy spelling, unknown names and mismatching strengths return no
match. No OCR image, transcript or patient identifier is sent to registry search.
Fields remain source-evidenced and independently editable; reference data does not
fill missing amounts/times or authorize a schedule. Additional curated entries need
source review and tests; never map every Berlin product to one medicine.

Validation: retry access/races/attempt preservation, payload cleanup, bounded source
validation and strict reference matching in tests/media-retry.test.mjs. Existing
pipeline and owner/CSRF tests remain release gates. Live quality requires inspecting
the private OCR text of a bounded retry, then independent reference annotations.

Follow-up: known manufacturer aliases are excluded from unlabelled product names.
The curated seed can associate literal names and ingredient/strength only when
both occur at least twice. It does not repair spelling, fill from a manufacturer,
or override conflicting explicit labels or another repeated product. Weak isolated
OCR tokens are flagged as possible duplicates; all such reference-assisted drafts
remain ambiguous and require human source verification. This is a narrow heuristic,
not evidence of general OCR accuracy or support for every product.

If a private OCR transcript already exists, the same explicit action reparses that
text locally without a provider call, queue dispatch, expiry extension or attempt
reset. Saved reviews still block replacement. Legacy drafts without text use one
bounded provider retry. Tests cover both branches and payload cleanup.
