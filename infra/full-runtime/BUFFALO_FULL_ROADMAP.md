# Buffalo Full — delivery roadmap and acceptance boundaries

Documentation cutoff: 2026-11-25 UTC. Source: the project documents **BUFFALO_HOJA_DE_RUTA.md** and **BUFFALO_PLAN_DE_IMPLEMENTACION.md** (Astra, reviewed against #81 HEAD `57bfbdfd`). This is an operational summary, not a replacement for the detailed project sources. Future PR numbering is deliberately not reserved.

## Product objective

Port original SD-AI as a standalone private product on Cloudflare: Merlin, Socrates, Themis, Athena CLD/SFD; original engines, tools, formats and evaluations; a compatible client that supplies model state, simulations, diagnostics and feedback according to original contracts. A user must be able to generate, edit, simulate, discuss and resume a project later, with explanations grounded in the correct model revisions and actual run evidence. Cloudflare supplies isolation, access control, inference transport, persistence and consumption controls. No new Arena, CEI, ATMS or advanced Buffalo Persistent features in this delivery.

## Verified baseline

- #79 merged: original LLMWrapper route and schema-agnostic native binding adapter; 25/25 and functional CI. Agent lane separately demonstrated a real remote Merlin edit and confirmed model recovery.
- #80 merged: one real Gemma quantitative REST result accepted by the original engine, with observed usage and cleanup. Original workflow failed v1 structural assertion, before PySD.
- #81 merged at `76a38e927f38359c3dca2be5969902239ff98907`: independent replay of unchanged original result, exact trajectory, original schema identity, 30/30 contracts, native/image/upstream/Go all passed on `57bfbdfd`. No second inference. See [evidence](REMOTE_QUANTITATIVE_SMOKE.md).
- #82 merged at `47bf11711a0a5fb4cda9d56e48144c44685cfea4`: original qualitative REST and Merlin CLD generation/reopen, three translation and two conformance cases with controlled provider, 30/30 and all CI passed. Real qualitative inference still pending.
- #83 merged at `7aebc323faf8c29dd7fd2336a2cce2856255c758`: preserved exact real receipt and cleanup, original PySD intervention PASS, executable hard-coded-flow control rejected as expected. See [CI](https://github.com/yudocyudoc/buffalo-01/actions/runs/45561777601/job/139026936297).
- #84 merged at `b64715453422a0f2bcc95a54cff16b89d452761d`: historical revision identity and completed runs, local workerd restart, two exact PySD trajectories recovered.
- #85 merged at `6f63d0c43bc6c9d2b60ebcfdc59b386c1c2c831a`: frozen qualitative remote smoke; integrated offline CI 43/43. The authorized remote attempt terminated with a reserved but unconfirmed binding invocation; [receipt and cleanup](REMOTE_QUALITATIVE_SMOKE.md). No semantic evaluation or verified usage.
- #86 merged at `7094a01c751e68ecefa4d2822820f38ba6772a89`: 46/46 offline contracts; original Merlin confirmed tool trace and historical messages loaded in a fresh original session. No pending replay; no follow-up inference using recovered history yet. See [native CI](https://github.com/yudocyudoc/buffalo-01/actions/runs/45571210946/job/139058030655).
- Scope: one real quantitative REST case, not broad model quality, full real agent autonomy, or Stella simulation equivalence.

## Ordered milestones (proposed)

| Milestone | Delivery and acceptance |
|---|---|
| 1. Original qualitative generation | Start with upstream qualitative engine/REST/schema and selected original qualitativeTranslation/conformance cases. Include a positive link phrased with decreases, a balancing cycle and reinforcing cycle. Compare directed graph and polarities independent of order; check instruction constraints separately. Negative controls: reversed link, wrong polarity, invented link, violated variable count. Original CLD agent WebSocket tool path, accepted model revision and reopen; retain upstream gates. Controlled provider first, separately authorized real smoke later. Report denominators, input, expected/observed graphs, differences and receipt. |
| 2. Minimal project continuity (may begin alongside 1) | Two revisions and two simulation runs, completed conversation turns and confirmed tool traces survive Container destruction. Bind runs to exact revision/hash and simulator settings; compare Demand 5→6 and retrieve both series without resupplying them. Preserve existing model-only projects and ETag conflict checks. Test concurrent writes, duplicate operation identity, interrupted tool/ack, project isolation. No blind retry of ambiguous operations; genuinely new experiments get new identity. |
| 3. Seldon family | Original Seldon, mentor, ILE and experimental variants according to their contracts. Compare two known runs, then persistent runs. Read-only discussion preserves model hash. If dominance requested without feedback, request evidence rather than invent it. Test interpretation of known feedback separately from backend calculation. |
| 4. Documentation and narrative | Original documentation and LTM narrative engines; preserve equations, units and links; correct references, periods and polarities, joint dominance where applicable. Reject mixed-run feedback and trajectories. |
| 5. Remaining original capabilities | Inventory 21 engine directories, 25 built-in tools and five configurations, distinguishing test/experimental engines and client-defined tools. Verify Go causal-chains, Python causal-decoder, Simlin, formats, files/RAG/embeddings, dynamic tools, visualization and multimedia separately. Record supported modes, dependencies, provider and evidence; catalogue presence alone is not functional proof. |
| 6. Reproducible release | Clean-install private REST/WS product journey through generation, editing, simulation, comparison, narrative and reopen; restore and isolate projects; versioned upstream evaluations and coverage matrix including exceptions and consumption. |

## Shared architecture and scientific constraints

Retain upstream app.js, agents, engines, sandbox, REST/WebSocket/SD-JSON and tool availability gates. Extend only the transport needed by the tested original contract. Project-scoped access and cumulative inference budgets remain authoritative. Preserve original schemas, observed usage and invocation IDs; content equality is not replay identity.

Start persistence with project Durable Object revisions and minimal indices for completed turns, confirmed tool calls, runs and evidence references. Design bounded migration compatible with current projects. Associate exact input/output revisions, simulator/version, integration method, dt, units, series, diagnostics and feedback provenance; use object storage by digest for large artifacts if needed. Confirm durable writes before acknowledgement; reconcile partial writes; never resurrect pending tool calls. Keep D1 smoke ledger operational, not product memory. No cross-project knowledge or general orchestration expansion.

Distinguish missing unitWarnings/errors from a checked empty list. Preserve original scientific calculation and its provenance; language output cannot substitute for simulator results or feedback. The project's source plan cites the original qualitative benchmark (24 translation and 18 conformance cases, 11 LLMs); compare only matching evaluation conditions and explicitly label smaller samples. For future LTM calculation, reproduce published corrected equivalent-flow examples before claiming backend fidelity; evaluate Seldon narration independently. For system change, use the Bass example to distinguish relative loop dominance from magnitude of change, with tolerance and intervals agreed beforehand. A reference feedback package is not evidence of a working LTM backend.

## Immediate work package

1. #81 documentation and merge complete; preserve original failure plus replay pass.
2. Archive the exact synthetic receipt/model and cleanup in [repository evidence](evidence/quantitative-45551954016/README.md); do not publish unnecessary deployment metadata. Merged in #83; evidence is independent of expiring artifacts.
3. Intervention implementation: derive Demand=6 from the unchanged archived model, require Inflow=6 and Inventory=[10,16,22,28,34]; hard-code Inflow=5 as an executable negative control. No new inference. Record the parent/derived revision and results separately; Confirmed in #83 [image CI](https://github.com/yudocyudoc/buffalo-01/actions/runs/45561777601/job/139026936297); no new inference.
4. Qualitative offline path complete (#82/#85); one authorized remote attempt ended before a terminal inference receipt. Preserve failure and investigate before any separately authorized new attempt.
5. Historical revisions and completed runs (#84) and conversation journal (#86) merged. Next: original three Seldon REST engines on recovered runs, including missing-feedback handling with controlled provider. WS comparison tools, durable discussion, actual loop-dominance evidence and calculation remain separate. Do not implement a generalized persistent laboratory prematurely.

Per PR: define contract and controls, run relevant native/image and upstream suites; preserve post-hoc criteria and historical results. Per remote trial: exact source/project/model/expiry/budget, distinct authorization, measured receipt and independently verified cleanup, no automatic retry. Per scientific result: versioned model, scenario, simulator and evidence; distinguish fixture, remote provider output and actual calculation. This roadmap grants no merge, deployment or inference authorization.
