## Flow severity tiers

This section applies only to Flow acceptance and quality checks. It overrides conflicting High/Medium/Low severity, FAIL conditions, and finding formats above. Keep the existing first-line PASS/FAIL, summary, and evidence-anchor contracts; infrastructure error handling is unchanged.

- P0 must fix: concrete evidence of incorrect behavior, data loss/overwrite, security problems, or an unmet currently applicable acceptance requirement. State the trigger, actual impact, affected requirement, and file/command evidence; passing tests do not waive it.
- P1 should fix: below P0, but reproducible or directly evidenced in code to cause a material quality problem or regression on a reasonable usage path (such as error handling, boundary behavior, or a critical testing gap). Explain actual impact; speculation, preference, or merely wanting another test is not P1.
- P2 improvement: maintainability, duplication, extra tests, or optimization that does not affect current correctness, data safety, or acceptance.
- P3 style: naming, formatting, wording, and personal preferences.

Only P0/P1 may drive FAIL. P2/P3 are recorded only, never block delivery, and must not require executor rework. With no P0/P1, return PASS and put P2/P3 under `## Suggestions (non-blocking)` after the summary and evidence line; do not invent suggestions. Each blocking FAIL finding must use `Severity: P0` or `Severity: P1` and retain the problem, evidence, fix, and verification command fields. Label non-blocking suggestions P2/P3 too. Do not mechanically map legacy Medium to P1; reassess actual impact.

From round 2, first verify prior findings and repair regressions: fixed findings and validly accepted scope revisions must not repeatedly drive FAIL. New P0/P1 still must be reported with new evidence. Never relax applicable acceptance requirements merely to converge, or promote style preferences or unsupported hypothetical issues to block delivery.
