# C4 — Seldon provider comparison (ahead of C1 completion)

C1 review remains independent. This branch forks the green C1.1c/C1.2a commit 8daaed5366c8dc338f4ef5b1b4db83e9d4f3e392. No change to product gateway, runtime, Containers, schedules or credentials.

## C4.0 declared contracts (2026-11-26)

Queried the account's GET /ai/models/schema endpoint for all five exact model identifiers; all returned schemas. Not a proof of inference entitlement or real schema compliance. Gemma supports enable_thinking true/false (default true); GPT-OSS native run has max_tokens and json_schema but no explicit reasoning_effort in its returned schema, and generic JSON output rather than choices. Public model page describes medium default, not proof of effective effort. DeepSeek supports none/low/high/max (default high); Inkling none/minimal/low/medium/high/max (default high); GLM low/high/max (default max), cannot disable thinking. Use high for all three configurable frontier models to avoid comparing their defaults unintentionally; effort labels do not equalize reasoning computation. Native GPT-OSS output adapter is tentative pending live transport. All models declare JSON Schema input; exact wrapper shape/provider model echo, actual usage and termination metadata must be checked live. Never repair a malformed JSON response by inventing text or stripping reasoning.

Public documentation: 
- https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
- https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/
- https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/
- https://developers.cloudflare.com/workers-ai/models/inkling-2-small/
- https://developers.cloudflare.com/workers-ai/models/glm-5.3/
- https://developers.cloudflare.com/workers-ai/platform/pricing/

Context windows: 256k Gemma, 128k GPT-OSS, 1048576 others. Input bytes do not establish tokens. The pilot exports exact bytes and hashes and preserves all content, even if beyond Buffalo product's 128 KiB wire limit. No truncation or sampling. Provider schema is not a capacity measurement.

## C4.1a offline gate

Actual pinned Seldon engine generates messages from original Bass, Inventory and Mai-Bab model+feedback and common eval question, no behavior cache or new simulation. Capture at original LLMWrapper completion boundary with invalid placeholder and network blocked. Common temperature 0.6, max generation budget 8192 tokens, schema unchanged; only native parameter naming and model reasoning settings differ. GPT-OSS default left unset. Gemma off/on differ by one boolean. 18 unique wires, 54 balanced scheduled rows, 6 one-call-per-configuration Bass pilot rows included in the 54 (not additional). No actual inference or judge calls in CI. Artifacts contain exact request bodies for later direct REST or binding calls and independent comparison. This is a different path from past Buffalo Gemma narrative, not a direct replication of that historical run.

C4.1b (not yet authorized in code): six pilot attempts only, no retries or substitution; retain raw result, request SHA, observed model identity, time, usage, reasoning token metadata, error and finish reason. A failed call consumes its attempt. If any incompatible schema/metadata, explicitly decide whether to adapt and rerun under a new protocol, do not silently normalize. Use a separate durable ledger / explicit one-shot execution approval before any live matrix. Do not use production or expose an endpoint. Existing connector can query metadata; live permission and response format still unknown. Existing deployment token was insufficient for previous direct AI REST attempt; do not claim it suffices. No secrets added here.

C4.2: only after pilot gate, remaining 48 scheduled attempts if appropriate, retain failures and raw outputs; no automatic retries. Use original expected facts and independent fidelity/mechanism annotations, blinded and separate from model identity. Coverage, contradictions, uncertainty, cost and latency separate. No claims about statistical superiority from three repeats or generalization beyond three fixtures. Model+provider+effort is configuration-level contrast, only Gemma off/on isolates a single setting. Actual provider token counters and pricing required; estimate at 40k input/8192 output per request is illustrative, not hard spend ceiling. A real budget authorization needs a measured cap and documented behavior of reasoning tokens; actual bill can differ.
