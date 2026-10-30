# Independent three-field evaluation

`node scripts/evaluate-extracted-fields.mjs PATH --annotate` reads only the existing cached prediction.txt and reference.txt in blister, bottle, sachet and voice. No OCR/STT calls or deployment occur. The provider configuration is unchanged.

On the first run, the local terminal shows the reference (not the prediction). Enter independently checked drug_name, strength and instructions. Explicit labelled reference lines/JSON provide defaults; unlabelled text never becomes inferred gold. `-` means explicitly absent; `?` leaves the field unannotated. Empty answers only accept existing labelled defaults. Enter values from the original source/reference, not the system prediction. Complete all four groups in one run. This is data annotation, not deployment approval.

Human annotations are saved as field-gold.json, bound to the exact reference SHA-256. Subsequent runs without --annotate reuse gold. Changed references require reannotation; stale gold blocks scoring. Keep all corpus files private.

The current extractor replays prediction.txt, preserves separately printed literal meal/bedtime instruction lines and exports drug_name, strength and instructions in extracted-fields.private.json. Historical-catalog fuzzy suggestions stay in review notes, not confirmed names. Never count a candidate as a confirmed identity. No symptoms are silently repaired, no catalog strength is inferred, and no clock times are added.

The aggregate field-accuracy-report.json contains exact-match scores per field after NFC, whitespace and case normalization, missing/mismatch states, coverage, explicit-absence flags, positive-only accuracy and false-positive counts. No medication text is printed in the aggregate report. A single field in one sample is either 0% or 100%; group accuracy is correct annotated fields / all annotated fields. All three fields must be annotated before a >80% group screen is reported. Explicitly absent gold matches are shown separately so they do not masquerade as successful nonempty extraction. No semantic drug equivalence is assumed.

Gold is never generated with the extractor under test. The four tuning examples cannot establish general provider accuracy or production readiness, even if all three fields match. Independent holdout and staging end-to-end acceptance remain separate requirements. Local-file scoring must run on the user's computer; do not invent real scores when only synthetic tests were run.
