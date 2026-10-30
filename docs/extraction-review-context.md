# Review context from cached transcripts

PR #38 adds optional item.notes (kind, text, evidence), displayed with textContent on the review screen. Notes expire with the existing draft payload; they are not copied into a confirmed medication schedule. They never authorize confirmation or supply missing schedule fields.

Reference matching is a suggestion against the existing 12 historical catalog records, not verification of a current registration or medication identity. It requires an observed literal strength, matching numeric tokens, similarity >= 0.8 and a >= 0.12 lead over the next record. Conflicting spelling is preserved in evidence; a candidate never fills the confirmed label. Strength is never imported from the catalog. An explicit labelled name is not overwritten.

Herbal excerpts become review notes without copying hospital/patient headers. Speech instructions are retained verbatim, including recognition errors; symptom prefixes are review notes, not diagnoses. Frequencies are not converted into clock times.

Validation: 241 local tests and syntax checks passed. Cached transcripts supplied in chat were replayed without provider calls (personal headers omitted from the sachet input). Blister gained a name candidate, sachet gained an herbal note, voice gained verbatim instructions and a symptom note, bottle extraction stayed unchanged. These examples are regression checks, not independent field-accuracy or pilot acceptance evidence.

To replay the original private files on the user's computer:

    node scripts/extract-captured-quality.mjs PATH_TO_PRIVATE_QUALITY_CORPUS

Only aggregate presence flags and note kinds are printed. Full drafts remain in each private corpus folder as extraction-reviewed-pipeline.json. No provider is called. Review the original sources before accepting any suggested identity or instruction.
