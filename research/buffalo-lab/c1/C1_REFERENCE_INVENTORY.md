# C1.0 — Reference inventory (2026-11-26)

Status: source audit complete for the listed files; archived result-row extraction and controlled evaluator checks awaiting CI. No live inference, no deployment, no changes to product runtime. This branch descends from PR #97's green head but is separate from it.

## Pinned reference
- Upstream UB-IAD/sd-ai `58cfc86c8f2634401534fc89ff856f3f21c90bba` (2026-11-17).
- Historical port without F4 `db73eedf65e177ffee38ed5b903969086d1d2130`; GitHub compare: upstream is merge base, port 215 commits ahead, zero behind.
- Runtime head `72ae78f65a4b08c0fb222ea8047600eb4186a611`.
- `reference-manifest.json` records Git blob IDs for each audited file in all three trees; `audit-reference.mjs` recomputes the Git SHA-1 of checked-out bytes. Blob equality establishes source identity, not effective runtime equivalence.

## Critical route distinction
The published discussion configuration, `evals/experiments/leaderboardDiscuss.json`, selects Seldon and Merlin (Anthropic/Google agent routes), with feedbackExplanation among five categories. It does not configure the standalone LTM narrative engine. `agent/config/merlin.md` explicitly directs feedback analysis through get_feedback_information then discuss_model_with_seldon. Our historical experiment explicitly asked for generate_ltm_narrative, then Merlin's synthesis. These are not interchangeable evaluation subjects. Both Seldon and LTMNarrativeBrain contain the historical whole-model majority instructions. The LTM narrative engine builds a separate essay and loop descriptions, with optional behaviorContent. The normal Merlin path uses Seldon. Whether the archived Merlin actually called Seldon must be inspected in per-row tool evidence; configuration is not proof of observed calls.

## Coverage versus fidelity
The actual evaluator asks a judge whether each expected fact is supported by generated text; the result fails if any expected fact is absent. It does not enumerate extra claims, read the full numerical trajectories, verify extrema, or validate independent simultaneous partition timelines. It tests the substring "true", not an exact boolean response. The controlled evaluator tests demonstrate the parsing issue and lack of an extra-claim penalty without calling a live judge. These tests establish evaluator behavior, not the quality of any actual judge. The original fixture input contains feedback and model but no separate behaviorContent. Six model tests, 35 expected facts in the current source (5+5+6+3+9+7); the script checks the count against actual groups.

## Configuration and limits
config.js defaults to gemini-3.8-flash for non-build and evaluation at the pinned source. Actual engine selection is driven by the provider, intelligence lane, difficulty and toolModels (toolHelpers.js), and the discussion experiment overrides models by configuration. The current default cannot establish the model or judge for every historical row. The archive contains generations v1 and v2 according to the generation registry; v1 has documented evaluation bugs. Do not pool their scores. Archive rows are surviving collected results, not necessarily all attempts or independent replicates. The gzip blob is pinned in the manifest. The offline report inventories feedbackExplanation rows by generation and engineConfigName, counts pass/fail/unscored and records available provenance keys, without interpreting absence of metadata as a known model or judge. The large archive could not be retrieved directly during this session; CI reads the repository copy.

## Evaluation capability matrix
| Capability | Original evaluator | Buffalo F1–F3 |
|---|---|---|
| Presence of expected mechanism statements | LLM judge | Not general |
| Exact numerical point/extremum | Not systematically measured | Structured annotation |
| Exact coalition at every saved sample | Not systematically measured | Supported when complete native scores exist |
| Extra contradictory assertions | No general penalty | Only annotated claims |
| General explanatory quality | Partial coverage proxy | Not established |
| Causal effects of interventions | Not established here | Not established |

## C1.1 decision
Add a distinct route R0 for direct Seldon, and R2a for normal Merlin/Seldon, alongside the direct LTM and forced-tool paths in the roadmap. Compare same original fixtures and same prompt first. Preserve both tool result and final synthesis, capture actual provider messages, and vary behavior availability and order without conflating it with provider/model. No new live pilot until these routes are observed with a controlled provider. F4 remains an experimental factual presentation; the historic pre-F4 cut is the comparison reference. No conclusions on relative model competence yet.

## Observed C1.0 run
Run 45877048304 extracted 186 feedback rows of 1115, archive SHA-256 700566fb90adf39eeb3a9f7807a19081e94f7711c54d32822892f54be51f83cd. v1: 38/60; v2: 35/126 across 21 configurations, none above 3/6. Do not pool generations or attribute failures to model competence. Original control failed before running the judge because our asserted count was 34 instead of 35; corrected against the source. This is a researcher counting error, not an upstream failure.
