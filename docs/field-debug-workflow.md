# Cached field comparison and targeted extraction

Run `node scripts/debug-extracted-fields.mjs PRIVATE_CORPUS_PATH` on the computer holding the private corpus. Reads reference.txt, field-gold.json, prediction.txt and the previous extraction-reviewed-pipeline.json. No provider is called. Reference, independent gold and previous extraction remain unchanged. Revised extraction is saved separately as extraction-debug-candidate.private.json.

Open field-comparison.private.html locally to inspect one row per drug_name, strength and instructions: expected value, previous value, revised value, exact score and diagnostic reason. Each folder also receives field-comparison.private.json. Aggregate field-debug-report.json/console omit private values. HTML escapes input, has no external resources or executable script and is not uploaded by the tool.

Reasons distinguish no annotated reference field, explicit absence, missing prediction, unexpected extraction, exact match and text differences. High string similarity is only a possible spelling/formatting hint; it never changes exact-match scores. A reference value not literally present in cached OCR/STT triggers source review, not a claim that the human reference is wrong. OCR can itself contain errors.

Printed botanical product names starting with a plant-part term and ending with an explicit preparation (capsule/powder/extract) can fill the label from literal evidence. An indication alone, multiple different herbs, or conflicting explicit names cannot establish one name. No strength is inferred; ambiguous trailing text still requires review.

Voice uses an explicit instructions-only task score in this debug report. The original full three-field accuracy, errors and prior scores are still shown. This is a different evaluation scope, not a correction of the full-field score or a production-readiness claim. Gold is not changed to improve results. Fields absent from gold are unscored, not automatic matches. Confirmed schedule creation continues to require the existing source check and manual confirmation.

Validation: 259 local tests pass, including botanical ambiguity, separate voice task/full scores, four-folder CLI execution, preserved input files, escaped private HTML and aggregate-only console output. Actual private expected values remain on the user's computer; no new real-data scores can be claimed until this command is run there.
