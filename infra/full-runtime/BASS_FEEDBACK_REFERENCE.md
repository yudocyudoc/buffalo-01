# Bass diffusion: pinned upstream feedback reference

Source: [original SD-AI feedbackExplanation category](https://github.com/UB-IAD/sd-ai/blob/main/evals/categories/feedbackExplanation.js), [reference JSON](https://github.com/UB-IAD/sd-ai/blob/main/evals/categories/feedbackExplanationData/bassDiffusion.json), [Stella XMILE](https://github.com/UB-IAD/sd-ai/blob/main/evals/categories/feedbackExplanationData/bassDiffusion.stmx). At preparation, all three Git blob IDs matched upstream main exactly and the fork base d36b52340e3abde5e6880ecae7212dfea054f039. The original files remain unchanged; no second copy. The executable pins these blob IDs, computes SHA-256 for source/model/feedback, and checks that the original category selects the same model/feedback and five original expected facts. No LLM judge invoked.

## Data and checks

The model has 10 variables, two stocks, one flow; 1 initial adopter, market size 1,000,000, contact rate 100 and adoption fraction 0.015. XMILE specifies Euler, 0–15 Years, reciprocal DT 16 (0.0625), and loop scores enabled. The JSON model does not report integrationMethod; no value is injected. Two loops, R1 positive and B1 negative, each have five ordered causal links. Both score series contain 241 time points. At t=0 both scores are 0; thereafter percentages sum to 100 within 1e-9 percentage points. R1 crosses below 50% at the first stored sample t=9.625 and B1 exceeds 50% there. The upstream period metadata lists R1 [0,9.625] and B1 [9.625,15]; the score sample at the shared boundary belongs to B1, and t=0 is an initialization exception, not measured dominance. The verifier checks these original values and structure, not a numerical implementation of LTM.

| Time (years) | R1 (%) | B1 (%) |
|---|---:|---:|
| 0.0625 | 99.99989062500927 | 0.00010937499072716261 |
| 9.5625 | 51.16862575482285 | 48.83137424517715 |
| 9.625 | 48.82615608559289 | 51.17384391440711 |
| 15 | 0.02150338563557581 | 99.97849661436442 |

## Acceptance boundary

This is reference data supplied by upstream; the accompanying Stella file is not a certified run receipt. Neither simulator execution, original run identity, nor stock/flow time series are included in the JSON. Do not attach it to the two unrelated Inventory runs or claim measured magnitude of change from relative loop percentages. Do not label these scores as produced by Buffalo, PySD or Simlin. The original five-fact explanation evaluator requires a separate LLM judge call for each fact; this increment does not execute it, grade a generated explanation, or modify its criteria.

Native and isolated image tests verify identity, ordered loops, signs, period/grid consistency and negative controls for malformed copies. Next increment: deliver this exact model and feedback to original Seldon family with a controlled provider, preserving provenance and verifying the actual request. Separate LTM calculation and benchmark against published corrected examples, then LTM Narrative. No paid inference or deployment authorized by this reference.


## Original Seldon delivery (offline integration)

The pinned model and complete feedback object are supplied to the original REST endpoints seldon, seldon-mentor and seldon-ile-user through a compatible-client helper, using the exact original case prompt and separate source provenance in backgroundKnowledge. No expected facts are passed as answers, no behaviorContent, currentRunName or fabricated run ID is supplied. The test checks the full original system/model/user messages after original SDK user-message collapse, all 482 raw scores, hashes of received model and feedback, exact original schema, and the binding receipt's hash and byte count. No new endpoint or modification of upstream engines. A distinct local DO storage uses three controlled-provider slots, separate from Inventory; no model/run writes and no extra receipt. The fixture returns scripted responses with feedbackInformationRequired=true, since the question requires feedback; the original engine must not add its missing-feedback warning when valid evidence is present. This is delivery and response-handling evidence, not independent evaluation of narrative quality or mathematical LTM fidelity. No real inference, judge or deployment. CI pending.
