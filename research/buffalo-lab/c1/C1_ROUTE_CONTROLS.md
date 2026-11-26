# C1.1a — Controlled engine and tool boundary

## Design
Six unmodified historical upstream fixtures. Common original evaluation question. Four routes: direct Seldon, direct LTM Narrative, original discussModelWithSeldon handler, original generateLtmNarrative handler. Direct engines receive original evaluation inputs without behavior. Each handler is exercised both without a variable_data cache and with a synthetic two-sample sentinel. The sentinel is not a simulation or mathematical evidence; it tests cache transport only. Total 36 controlled wrapper invocations.

The original engines and handlers are called, with only LLMWrapper.createChatCompletion replaced by a deterministic schema-conforming response. Exact messages, selected model argument, reasoning effort and schema are recorded at that boundary. This is not the actual provider SDK request and not a measure of model performance. Tool handlers run against a minimal fake session manager, not the complete Merlin planner or transport. Full agent route is a subsequent C1.1b increment; it must observe actual tool choices and synthesis, and cannot be inferred from these results.

Expected discriminators: Seldon receives the complete model and feedback; LTM receives feedback, ignores lastModel; the Seldon agent wrapper adds a brevity instruction; the LTM wrapper calls the engine with an empty user prompt, while direct LTM receives the common question. Cached behavior appears only when present. If these expectations fail, retain the artifact and inspect the source, rather than adapt the benchmark to silently pass.

Historical leaderboard report now preserves row-level failure types, generation errors, expected facts and tool-log metadata. Group totals alone do not establish semantic error. No provider, production changes or spend.

## Harness correction
Run 45877370870 verified the inventory but the evaluator constructor rejected missing Google credentials before the controlled completion was reached. The route step was skipped. The research-only preload supplies a literal invalid placeholder and denies network connections/fetch in both test processes. This does not configure credentials in GitHub or change upstream code. Both controls remain pending verification of the corrected run.
