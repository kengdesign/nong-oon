# Offline extraction scores

Run `node scripts/score-captured-extraction.mjs PATH_TO_PRIVATE_QUALITY_CORPUS` after cached extraction. Reads each group's extraction-reviewed-pipeline.json and reference.txt. Writes private extraction-score-report.json and prints aggregate scores only. Does not write or change source/reference files, call APIs or deploy anything.

`textMatchPercent` = 100 × (1 − Unicode codepoint Levenshtein distance / max(reference length, extracted length)), after NFC and whitespace normalization. It is bounded to 0–100. Order, spelling and extra/missing text matter. Only extracted name, strength, dose, instructions and literal symptom/herbal notes are included; fuzzy name candidates and unknown fields are excluded. Voice symptom context precedes instructions. This is text similarity, not OCR/STT accuracy or semantic/clinical accuracy. A partial reference remains partial and can penalize legitimately additional output. Review/scope flags come from review.json; missing flags are unknown, never auto-approved. The threshold is strictly >80, not >=80.

`fieldAccuracyPercent` is null until independent human field gold is supplied. An optional reference-fields.json uses:

    {"humanReviewed":true,"independentlyAnnotated":true,"draft":{...}}

The draft must follow schemas/schedule-draft-v1.json, use the correct source kind and independently annotated expected fields/evidence. Null gold fields are excluded from the denominator. A known gold value missing or different in the prediction counts as wrong. Fuzzy suggestions never count as confirmed names. Do not copy the predicted draft or generate gold using the tested extractor. Field comparison is exact and aligned by item position; no medical equivalence is assumed.

Production readiness remains false in this small diagnostic suite even for text scores >80. Before preparing executable production deployment commands, collect reviewed independent field labels, a broader representative holdout, checks for incorrect name/strength suggestions, staging UI/provider/retention evidence and a rollback-capable release snapshot. No LINE sending is enabled by this tool. The current four samples were used for tuning and do not constitute an independent holdout.

Missing/invalid inputs produce fixed error codes without raw text. Exit 2 means blocked groups/report write failure; scored groups may still contain low scores. No weighted all-group average masks a failed group.
