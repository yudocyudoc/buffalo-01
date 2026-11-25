# Buffalo Full: original qualitative remote smoke (prepared; not executed)

This independent increment starts from merged #83. #82 established five offline upstream cases and original Merlin/REST CLD generation using a controlled provider. This smoke is **one real REST case** only, not a general Gemma quality benchmark or a remote Merlin tool-selection test.

## Fixed case and acceptance

The public synthetic case in [qualitative-smoke-case.mjs](qualitative-smoke-case.mjs) is the exact three-variable balancing-loop instance observed in [#82 native CI](https://github.com/yudocyudoc/buffalo-01/actions/runs/45560758897/job/139023632916). Original evaluator family: qualitativeTranslation, singleFeedbackLoop. Freeze input and reference before dispatch; original case generation randomizes wording, so verification checks the upstream reference graph and nonrandom parameters against the frozen instance.

| Source | Destination | Polarity |
|---|---|---|
| whoziewhats | funkados | - |
| funkados | maxabizers | + |
| maxabizers | whoziewhats | + |

Only the original engine request goes to Gemma; the expected graph does not. The operator requires the actual selected model, complete schema-valid binding receipt with the exact original qualitative schema SHA-256, measured usage, a single reservation and confirmed stop. The offline runner checks the returned model's endpoint integrity and uses the original evaluator for direction, polarity and missing/invented relationships; singular/plural and ordering follow upstream semantics. Semantic failure is retained as FAIL with the actual graph and failure reasons; no repair, automatic retry or post-hoc criterion changes. The evaluator runs in the same built isolated image after verified cleanup. Controlled fixtures exercise this path separately and are labelled as fixtures.

## Operational constraints

The manual workflow is derived from the already exercised #80 operational scaffold with distinct private runtime/operator/project/one-shot ID. It shares the existing concurrency group and D1 operational ledger, not product storage. It requires the exact main SHA and explicit approval token ONE_BUFFALO_FULL_REMOTE_QUALITATIVE_MAX_ONE; first attempt only. One cumulative binding reservation, grant expires within 22 minutes. No public endpoint, no general Internet egress, no sandbox relaxation. Dry run, disabled deployment, temporary secrets, independently checked activation and unconditional disable/cleanup steps remain as in the quantitative smoke. Stop confirmation and cleanup are required; ambiguous or failed calls are spent. Separate authorization is needed to merge and separately to execute this workflow. Preparation alone makes no Cloudflare call and does not authorize deployment or inference.

The final output records case input/reference, observed graph, original evaluator failures, source schema/model hashes and measured consumption. A successful outcome is 1/1 causal translation on this fixed case only. The remaining four offline cases and original wider benchmark still need their own explicitly budgeted real evaluations.

Parallel persistence work (#84) is independent; this branch intentionally does not modify the project store or session semantics. CI is pending at preparation.
