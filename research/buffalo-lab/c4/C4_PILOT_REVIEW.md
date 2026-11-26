# C4.1b pilot review

6/6 responses valid JSON; all stop; no retries. All six final response strings contain Markdown/plain formatting instead of required simple HTML. Gemma reports -external alias; existing product accepts this alias (verify against pinned acceptedGemmaModel separately). No claim of semantic pass from structural validity. All five broad expected facts qualitatively present in six answers, but this coarse checklist ignores added wrong claims. No original LLM judge invoked; first review unblinded and selected claims only.

## Numerical cross-check
Archived R1 and B1 scores match 100*(1-A/M) and 100*A/M, respectively, after the zero initial row, when reconstructed using Euler dt=0.0625, A0=1, M=1e6, F=1.5*A*(1-A/M). Max absolute error 2.984279490192421e-13 and 3.126388037344441e-13 percentage points. Solver identity inferred from numerical agreement, not a declared field. This independently distinguishes the score from population or statistical variance. Continuous logistic half saturation 9.210339705309183 years; Euler grid peak 9.5625 years, flow 374795.1470767747; dominance first B1 at 9.625. No archived stock time series, so label reconstructed values, not original observations.

## Result
Gemma OFF exaggerates R1 share; ON largely avoids that specific claim. GPT-OSS invents initial conditions, safe division and multiple values/times. DeepSeek derives F correctly but reverses relative contribution and overstates saturation; Inkling matches sampled percentages and states real-world limitations; GLM has good broad structure with early percentage exaggeration. No model eliminated, no significance claim. Exact selected claims and evidence in pilot-semantic-review.json; no exhaustive count or independent blinded review. HTML format noncompliance separate from semantics. Keep original outputs intact.

## Matrix gate
Pilot transport passed for Bass only. Remaining 48 attempts still require per-case input checks and a separately bounded ledger. Do not assume GPT-OSS 128k context is sufficient for larger cases based on bytes or token ratio. If a provider rejects context or returns length, record failure, no truncation or retry. Do not run new judge inference automatically.
