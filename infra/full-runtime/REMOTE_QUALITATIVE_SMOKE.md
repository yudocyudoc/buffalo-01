# Buffalo Full: original qualitative remote smoke (first authorized attempt: inconclusive runtime failure)

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


## Image dependency correction

Initial [CI image job 139034563486](https://github.com/yudocyudoc/buffalo-01/actions/runs/45564101069/job/139034563486) failed importing `pluralize` while the native integration passed. The original evaluator and its name matcher require this package; the image uses `npm ci --omit=dev`. Promote only the existing locked `pluralize` 8.0.0 dependency to production, retaining its version and integrity and leaving all other lock entries unchanged. Do not install the full development dependency set, change upstream evaluator semantics, or weaken the offline image test. Correction passed offline CI and integrated #85 was merged; the subsequent authorized remote attempt is recorded below.


## Observed remote outcome — 2026-11-25 UTC

[Run 45568126474](https://github.com/yudocyudoc/buffalo-01/actions/runs/45568126474), [job 139047848311](https://github.com/yudocyudoc/buffalo-01/actions/runs/45568126474/job/139047848311), [artifact 15001108616](https://github.com/yudocyudoc/buffalo-01/actions/runs/45568126474/artifacts/15001108616). Source 6f63d0c43bc6c9d2b60ebcfdc59b386c1c2c831a. Downloaded and inspected exact archive; remote-receipt.json SHA-256 a899bdd988000f0e092c8266b8325f02f6feca07be424d8458f276f1c3bab1d0; cleanup.json SHA-256 13ad37de7af1a621217cf3e959f5eddcda4e26a719c99fefe1a2ef27f02d2170.

Terminal operator status RUNTIME_FAILURE, failure_stage GENERATE, failure_code REMOTE_EXECUTION_FAILURE. Claimed 07:39:42.070Z; finished 07:42:58.179Z. Binding receipt stage BINDING_INVOKE, status RESERVED, usage null, request_bytes 6912, max_completion_tokens 8192, exact frozen qualitative schema hash e1040c3a83801ee0feda28a5e0aaec6a78d5df6f0fcbdf0e9e66914446a46ea8. No returned model, response status, provider terminal receipt, or verified consumption. The approximately 196-second claim-to-finish interval is consistent with the 180-second generate timeout plus startup/cleanup, but does not prove timeout or its location. Distinguish reserved/possibly consumed from completed inference. Do not infer a semantic failure, do not score the case, and do not reuse this spent reservation. Original evaluator step skipped. Stop confirmed and cleanup status ZERO_ACTIVE_AND_DISABLED_NO_AI_OR_SECRETS. No rerun authorized. Archive expires; preserve reviewed receipt separately if needed. Before a new attempt, improve stage-specific time/abort and provider terminal receipt observability without changing the frozen acceptance case or weakening isolation.
