# Buffalo Full original application runtime

The container starts upstream `app.js` with Express and WebSocket sharing port 8080. A non-root entrypoint drops inherited capabilities, verifies the Linux launch context, and requires authenticated sessions and bubblewrap. It uses the existing private provider bootstrap only when Workers AI is explicitly configured. Private 3B-8 retains its own image and receipts.

## Private client integration

Configure a trusted client-facing Worker to use a service binding to the named `FullApplication` entrypoint. That caller must authenticate the user, authorize the project and **overwrite** the `x-buffalo-project` header with its own verified project slug. Each project maps to one Container and SQLite-backed Durable Object. The default public handler returns 404. The private binding preserves original HTTP methods, paths and WebSocket frames. Use the original application authentication key in the REST header or session initialization. The router needs the `APP_AUTH_KEY` secret and an explicitly enabled runtime to start a container.

The project owner can save the exact client-accepted SD-JSON with `PUT /project/model`. Use `If-None-Match: *` to create and the last returned quoted ETag in `If-Match` to update. A stale revision receives 412. `GET /project/model` returns the latest model and ETag even with the container stopped. The current checkpoint limit is 1 MiB. A compatible client can save the accepted model before answering Buffalo's `update_model` request and supply the recovered version in a new `initialize_session`. Model checkpoints do not contain conversation history or tool output.

## Coverage

The build compiles the original Go causal-chains binary and installs production Node dependencies. CI records the catalog reported by the running image, checks the original `predprey` REST generation, and separately selects all five agent configurations in their declared modes using Linux bubblewrap. The image has no Docker daemon or causal-decoder ML stack; the later simulation increment installs Python/PySD as described below. Visualization dependencies still need functional coverage. A catalog entry alone does not establish that an engine's dependencies or inference path work.

The editing transport passes the original agent's tool schemas and conversation messages to a native Workers AI binding and returns correlated tool calls or final text. This increment admits model reading, granular variable edits and client updates. General engine inference through LLMWrapper is covered by the subsequent #79 increment below; other tool families and arbitrary provider routes need separate coverage. The template has no AI binding or live limits. An operator must explicitly supply the digest-pinned image, an AI binding named `AI`, a single authorized `AI_PROJECT`, an absolute `AI_EXPIRES_AT` and a cumulative integer `AI_MAX_CALLS` before an inference run. The counter is durable across container restarts. Per invocation limits are 131072 serialized input bytes and 2048 output tokens. Requests that reach the provider consume a reservation even on failure.

The private service binding exposes each reservation by its project-local number, starting at 1, via `GET /project/inference/{number}`. The receipt starts as `RESERVED`. After the binding returns, it includes the observed token counts, neurons, recognized model and finish reason, elapsed time and failed validation predicates, including for a 422. Unknown counts are null. A binding exception records the available numeric provider status and code. Receipts exclude prompts, response content and tool arguments. Reservations made before this feature have no receipt.

The offline native test runs the real parent, sandboxed child, tools, WebSocket client and SQLite storage. A local provider fixture reads, edits and pushes the model. The client logs tool events and checks the accepted Demand equation changes from 3 to 5, regardless of the sequence chosen. The test restarts the application and workerd, reopens the edited project and reads back a rejected inference receipt. The image test runs REST inside Docker with networking disabled. The historical manual edit subsequently demonstrated real Gemma tool choice for that edit case; broader tool selection remains unverified.

## Manual remote edit

One authorized private project, six native Gemma binding reservations maximum. The scheduled client uses the original WebSocket protocol and the same session driver as offline CI; it does not prescribe tool choice. It verifies Demand=3→5, refuses a stale write, destroys the Container, recovers the accepted SD-JSON, reopens an original session and destroys the Container again. The existing experimental D1 ledger records one claim and terminal receipt, not product conversation state. No public endpoint, no external Internet, no session replay. No Arena dependency. Only the four edit tools were admitted in that historical run. [Verified remote edit run 45529319023](https://github.com/yudocyudoc/buffalo-01/actions/runs/45529319023) passed, with three real calls and recovery across Container destruction/reopen.

## Original model editing and simulation tools

The transport ceiling now admits eleven original tools: get_current_model, read_model_section, edit_variables, edit_relationships, edit_specs, edit_modules, update_model, run_model, get_run_info, get_variable_data and read_file. The upstream tool roster and model/client capability gates still decide which schemas actually appear. The Docker image installs the upstream pinned PySD dependency in a Python virtual environment. The compatible test client handles the original client-owned simulation requests using SDJsonToXMILE and PySDSimulator from upstream; the agent does not invent time series. CI checks the image's actual trajectory and separately exercises the real original WebSocket tool loop with a scripted provider, including read_file on the generated data. This does not add a production simulation REST endpoint, certify Stella-specific semantics, or persist runs or conversation history. No paid inference is authorized by this change.


## Original engine inference — PR #79

The second original SD-AI inference lane is independent of the agent chat/tool-call lane. With the runtime and AI grant already enabled, an additional operator-controlled `ENGINE_INFERENCE_ENABLED=true` is required. Restart the container after changing it; the Durable Object checks the flag at every engine request. The default template leaves this disabled. No remote workflow or paid run is authorized by this PR.

### Common provider boundary

The application and existing bubblewrap preload set LLMWrapper's build/non-build defaults and cloudflare agent tool lane to the Buffalo-owned virtual alias `buffalo/gemma-4-26b-a4b-it`. The original LLMWrapper still selects its OpenRouter SDK branch by model namespace. The SDK is a local serialization library only: the preload intercepts the exact completion URL and submits the request to the private binding gateway. The actual target is `@cf/google/gemma-4-26b-a4b-it`; no real OpenRouter or provider credentials enter the container, and general Internet egress remains disabled.

`engine-adapter.mjs` is the common, schema-agnostic provider adapter for all LLMWrapper consumers. It converts the original SDK's messages, JSON Schema wrapper, JSON object mode or plain text to the binding contract and translates the validated response back. The schema and content are not repaired or generated by the adapter. The engine path imports no Arena adapters, EV-01 grants, historical GLM aliases or experimental runner policies. Historical files are preserved for reproducibility. Gemma thinking remains disabled; seed/top_p are still explicitly unsupported in this increment. A native provider branch in LLMWrapper is a possible future simplification, not a prerequisite for recovering the original engine families.

Source inspection: Quantitative, Qualitative, Seldon, Seldon-ILE-User, Generate Documentation, LTM Narrative and the qualitative brain reused by recursivecausal use the common LLMWrapper abstraction; EngineWrapper calls the original engines on the agent side. These should share this transport, not one adapter per tool. Causal-chains has a separate Go binary/provider path, and causal-decoder invokes a separate subprocess; their availability is not established by LLMWrapper transport. Other variants and tools still require individual functional coverage, not separate provider implementations.

### Invocation identity and consumption

Each intercepted SDK request receives a fresh UUID v4. Identical prompt/schema/wire content with distinct invocation IDs is a legitimate new experiment and spends a new reservation. Replay of the same invocation ID is rejected atomically in the project's Durable Object, even after a restart; the original reservation remains spent on failure. Request hashes remain receipt evidence, not deduplication keys. Legacy engine-request:<hash> keys are no longer consulted. The proxy performs one outbound fetch and maps transport/binding failures to a terminal SDK 422; it does not retry or return ambiguous results. A separate original REST call or agent tool call is a new invocation, not an API-level idempotency guarantee for repeated client submissions. This is not a result cache. The project-wide cumulative call budget and expiry still apply. The engine has an 8192-token ceiling (respecting smaller requested limits); agent chat remains at 2048. Input is capped at 131072 serialized wire bytes. Receipts store channel, invocation ID, wire hash, response format, token cap, observed usage and failure diagnostics, not prompt or output. The SDK-only missing total_tokens is derived from observed prompt and completion counts; it is not attributed to the provider. The REST BYOK waiver is disabled only in the operator-funded private engine lane.

### Acceptance and evidence boundaries

The pre-refactor commit 421dc71 passed [Full Runtime CI 45538573601](https://github.com/yudocyudoc/buffalo-01/actions/runs/45538573601): 16/16 unit contracts; actual original REST quantitative engine, LLMWrapper/OpenRouter SDK, exact original Zod schema and controlled binding fixture; real PySD Inventory [10,15,20,25,30]; empty-model Merlin generation, edit Demand 5 to 6, PySD [10,16,22,28,34], confirmed persistence and restart/reopen. The refactor retains these tests and adds repeated identical REST experiments, terminal SDK failure without an automatic paid retry, durable rejection of the same invocation ID with available budget, a new ID for identical content after restart, and schema-agnostic adapter contracts. The refactored head 8e131f38 passed [Full Runtime CI 45542945620](https://github.com/yudocyudoc/buffalo-01/actions/runs/45542945620), with 19/19 unit contracts and all functional checkpoints. A subsequent review found two receipt-level gaps: JSON parsing was mistaken for schema conformance, and invalid total_tokens could pass the gateway but fail at the SDK. The new gateway validates original JSON Schema draft 2020-12 with the pinned Worker-compatible @cfworker/json-schema interpreter (no dynamic code generation), distinguishes JSON object mode from schema mode, and shares the SDK total-token check with the adapter. Observed valid totals are recorded; absent or invalid totals remain null, and invalid totals or overflow are rejection predicates. The SDK derives an absent total only for its own envelope. The offline REST/SDK/workerd integration now includes both deliberately invalid responses, requiring REJECTED receipts with preserved consumption and no retry, before the original Merlin and persistence scenarios. Validation does not establish engine semantic correctness or remote generation quality; unsupported schema features remain a boundary of the interpreter. #79 subsequently passed 25/25 and full functional CI on the final head ([run 45547460177](https://github.com/yudocyudoc/buffalo-01/actions/runs/45547460177)); it was merged at `01fc4cea2a59db16e4b78d1feec9b2706798f7e7`.

Only the original generate_quantitative_model tool is conditionally added to the gateway ceiling (12/25 when enabled, 11/25 otherwise); upstream per-agent, mode and model-state gates remain authoritative. The controlled provider alone does not establish real Gemma structured output or tool choice; the separate real quantitative REST case below establishes structured output for that case, not autonomous generation tool selection. Other engine families still need functional coverage. No paid inference, deployment, or Buffalo Persistent work was included in #79.

### Historical R0 check

[PR #67 run 45310592177](https://github.com/yudocyudoc/buffalo-01/actions/runs/45310592177) and [PR #79 run 45538573584](https://github.com/yudocyudoc/buffalo-01/actions/runs/45538573584) report the same `MINIMAL_BWRAP_BLOCKED / NAMESPACE_CREATION_DENIED / NO_PERMISSIONS_TO_CREATE_NEW_NAMESPACE` and identical stderr SHA-256 f584d723d6016799815da1fe797c1cb4d40b556ab350e3d7b78d3d12d7febf46. The probe runs before importing Buffalo or executing AgentWorker. The strict WorkerSpawner policy and native sandboxed integration passed on 421dc71. R0 remains a genuine local OCI environment block, not a regression shown by the #79 WorkerSpawner preload change, nor proof of remote sandbox compatibility. No workflow bypass, privilege relaxation, or unsandboxed fallback.


## Current quantitative evidence and delivery priorities

As of 2026-11-25 UTC, #80 is merged at `381e22050e04918289ae9371fc7c17d5b1a89ee5`. [Remote run 45551954016](https://github.com/yudocyudoc/buffalo-01/actions/runs/45551954016) generated a schema-valid quantitative SD-JSON via original REST, LLMWrapper and actual Workers AI Gemma. One binding reservation, 1506 input tokens, 767 output tokens, 34.609092712402344 neurons; stop and cleanup verified. The original run failed before PySD because v1 demanded exactly three variables. #81's separate [real receipt replay](https://github.com/yudocyudoc/buffalo-01/actions/runs/45554508506/job/139003214241) passed using v2, the unchanged four-variable model and original PySD in isolated GitHub runner Docker: Inventory [10,15,20,25,30], Demand and Inflow [5,5,5,5,5]. No additional inference. All four CI workflows on `57bfbdfd` passed; #81 is still a draft at this cutoff. This is single-case remote quantitative evidence and a post-hoc criterion correction, not a quality benchmark or proof of every engine. See [full smoke record](REMOTE_QUANTITATIVE_SMOKE.md).

The project-level documents BUFFALO_HOJA_DE_RUTA.md and BUFFALO_PLAN_DE_IMPLEMENTACION.md guide subsequent work. The repository [roadmap summary](BUFFALO_FULL_ROADMAP.md) records their priorities and acceptance boundaries, without treating unimplemented milestones as available.
## Original qualitative generation and evaluation

With the original-engine lane enabled, the transport also forwards the original
`generate_qualitative_model` definition when offered by a CLD session. The
enabled transport ceiling is now 13 built-in tools across modes. The upstream
agent and session still select the available subset. The REST route is
`POST /api/v1/engines/qualitative/generate`.

The offline integration uses the upstream qualitative schema, three upstream
translation cases (a positive relationship described with decreases, a
reinforcing loop and a balancing loop), and the Road Rage required-variables
conformance case. It runs the two original evaluators on the returned models.
Negative controls reverse a link, flip its sign, invent a link and omit a
required variable. A separate original Merlin CLD session invokes the tool,
acknowledges a model revision and reopens it after restarting the app and
workerd. The provider is controlled; these cases measure integration and
evaluator behavior. Earlier increments above list their historical tool counts.

### Next persistent run contract (design)

The client must capture the project model revision (the ETag returned by the
accepted save) and its SD-JSON digest **before** starting a simulation. Attach
the result to that immutable input even if the latest project revision has
advanced by the time PySD finishes. Encode the simulator/version, integration
method, step, time units, scenario, series and available diagnostics. Keep a
project-scoped run identity across retries; two deliberate simulations of the
same revision may each have their own run identity. A repeated completion
with different contents for the same run must conflict.

The first persistence acceptance case uses the original inventory example:
save Demand 5, run [10,15,20,25,30], save Demand 6 as its child, then run
[10,16,22,28,34]. Restart and resolve each run to its original revision, even
when completions arrive out of order. Implement and verify historical revision
reads and durable run writes in the persistence increment. The current client
keeps run series in memory; reopening a CLD here verifies only model persistence.
