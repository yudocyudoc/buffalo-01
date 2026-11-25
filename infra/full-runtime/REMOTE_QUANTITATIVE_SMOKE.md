# Buffalo Full — remote quantitative smoke (PR #80) and offline replay (PR #81)

## Scope and approval

Historical preparation (#80) was merged at 381e22050e04918289ae9371fc7c17d5b1a89ee5. One explicitly authorized remote run has now completed; its grant is spent. #81 changes the offline verifier only. No additional provider call, publishing, deployment, migration or scheduled execution is authorized by this documentation update. Previous #79 is merged at 01fc4cea2a59db16e4b78d1feec9b2706798f7e7; its offline CI passed 25/25 and the complete original REST/Merlin/PySD/persistence integration. R0 historical OCI-local namespace block remains unchanged.

The original manual workflow on the exact main SHA, first run attempt only, requires the explicit token ONE_BUFFALO_FULL_REMOTE_QUANTITATIVE_MAX_ONE. It uses separate private runtime and operator names and a fresh fixed project. No public URLs, no general Internet egress, and no change to sandbox policy. The existing control-plane D1 table is reused solely for the smoke claim and result (distinct probe ID); no migration is performed. The runtime grant permits one cumulative binding reservation for the fixed project, expiring within 22 minutes. The operator makes one original REST request, with no retry; a failed or ambiguous attempt is spent. This is a test budget, not a product-wide ban on repetitions.

## Acceptance stages

1. Source SHA, image digest, image local REST and offline contracts; private config dry-run.
2. Preflight: existing table accessible, no conflicting CLAIMED row, new smoke resources absent, zero active Containers.
3. Publish the image and verify digest and revision; deploy disabled configuration; use temporary auth secret; activate only after explicit approval. Read back both disabled Workers with their temporary secret before arming; read back the armed runtime and still-disabled operator before enabling its cron.
4. Operator atomically claims, checks no old inference receipt, starts the original app via health, POSTs one synthetic Inventory prompt through the authenticated original quantitative endpoint, stores returned unmodified SD-JSON and actual receipt. An OK receipt must prove the actual accepted Gemma model, schema mode, successful schema and total validation, stop reason and measured usage including neurons. No extra reservation, stop must be confirmed.
5. Independently disable operator and runtime (including engine flag and AI binding), remove temporary secrets, verify no active or starting Containers, no public endpoints/cron/AI/secrets on smoke Workers. Disabled resources and registry image remain; no automatic deletion.
6. With cleanup successful, run the original SDJsonToXMILE and PySD client inside the same locally built OCI image on the GitHub runner, with network disabled, read-only root filesystem, no capabilities, and a read-only mount of the exact returned receipt. First check one stock, one flow, required named variables, a bounded number of auxiliaries, exact Euler day 0–4 specs and dt=1. Equivalent auxiliary factorizations are permitted by acceptance contract v2. Compare schema digest to the exact original LLMWrapper schema, time [0,1,2,3,4], Inventory [10,15,20,25,30], Demand/Inflow constant 5. Retain model hash and simulation evidence. The simulation is real but local to the runner, not Cloudflare-side PySD. A labelled synthetic receipt is separately exercised by the identical verifier in native and OCI offline CI, with schema and trajectory negative controls in the native job. Synthetic receipts cannot enter the remote verifier CLI without the explicit --fixture option. No model or equation repair. A failed semantic/simulation assertion is a failed smoke even if transport succeeds.

The operator terminal status FULL_REMOTE_QUANTITATIVE_MODEL_RETURNED means model/transport acceptance only. FULL_REMOTE_QUANTITATIVE_PYSD_PASS plus verified cleanup are needed for the complete smoke. Receipts may be RESERVED or missing after ambiguous failure; do not retry or infer successful execution from a missing receipt. The raw model is synthetic test data and is retained in the private D1 receipt and workflow artifacts.

## Remaining boundaries

Offline CI tests operator contracts and the existing real original app path with a controlled provider; it cannot certify Gemma remote structured output. The manual workflow was executed once, as documented below; do not rerun or rearm its spent grant. The workflow timeout is 150 minutes to preserve the cleanup steps' time budget after the earlier bounded phases; the inference grant itself remains at 22 minutes. Cloudflare API permissions, dry-run/deployment and actual cleanup readback passed in the authorized run, for those resources and that execution only. No expansion of the tool roster, no Buffalo Persistent features. Existing runtime and historical edit operator remain untouched.

## First real execution and separate post-hoc replay

[Run 45551954016](https://github.com/yudocyudoc/buffalo-01/actions/runs/45551954016) executed source 381e22050e04918289ae9371fc7c17d5b1a89ee5. Deployment, original REST, native Gemma, one reservation, all gateway response predicates, Container stop and independent cleanup passed. The original run remains FAILED: PySD was not reached because v1 imposed EXACT_THREE_VARIABLES. The returned model has Inventory=10, Inflow=Demand, Demand=DailyDemandRate, DailyDemandRate=5. No additional inference was authorized or performed. Observed model @cf/google/gemma-4-26b-a4b-it-external, 1506 prompt tokens, 767 completion tokens, 2273 total, 34.609092712402344 neurons, 19092 ms binding elapsed. The exact original schema hash matches the offline reference 42a687027ee4d911555eba65afaa02d936b64d53cd6358067ddfe50766bcfc93. Artifact 14995035411 ZIP SHA-256 e4ce0527482a3f890dbebeeeff297b6fa5beff52a663784f274d5ebf16b034ae; remote-receipt.json SHA-256 5da8e835794921082d9fa5560f3be135772d2153349c2533b45a3e2ea37b0696; cleanup receipt SHA-256 13ad37de7af1a621217cf3e959f5eddcda4e26a719c99fefe1a2ef27f02d2170.

V2 acceptance changes only the smoke verifier: one stock, one flow, named target variables and up to 16 total variables (extra auxiliaries allowed); same stock connections, time specs, schema, observed receipt, immutable model, and exact PySD series. This is an explicitly post-hoc criterion correction, not a retroactive PASS of the original workflow. The separate offline replay checks artifact bytes and executes the exact saved model using unchanged upstream converter/simulator, with no Cloudflare credentials or network in simulation. Additional controlled regression checks equivalent factorization, order independence, wrong constant, extra stock/flow, and previous controls. The replay workflow is restricted to its investigation branch because original artifacts have finite retention. The replay passed on 2026-11-25 UTC; see the evidence below. No rerun of the remote one-shot.


## Verified replay outcome — 2026-11-25 UTC

[Replay run 45554508506, job 139003214241](https://github.com/yudocyudoc/buffalo-01/actions/runs/45554508506/job/139003214241), evaluated HEAD `57bfbdfde15c4eccabafb5e6e148e1bcfe707c75` of #81 (still draft at this documentation cutoff). The four file hashes (remote receipt, cleanup, registry, grant) passed independently. The unchanged model has SHA-256 `dfd7dc6e99848d67268d4ff5ebcc7898c9a7c909ba30aa1c14220ef1707ab2c4`; the original schema SHA-256 is `42a687027ee4d911555eba65afaa02d936b64d53cd6358067ddfe50766bcfc93`.

| Check | Observed result |
|---|---|
| Evidence source | remote-receipt |
| Acceptance contract | bounded-equivalent-auxiliaries-v2 |
| Time (days) | 0, 1, 2, 3, 4 |
| Inventory | 10, 15, 20, 25, 30 |
| Demand and Inflow | 5, 5, 5, 5, 5 each |
| Variables | 4 |
| Simulator | Original SDJsonToXMILE + PySD in rebuilt isolated GitHub runner OCI image |
| Terminal replay marker | FULL_REMOTE_QUANTITATIVE_PYSD_PASS |

[Native and image CI](https://github.com/yudocyudoc/buffalo-01/actions/runs/45554508294) passed, including 30/30 contract tests, equivalent auxiliary factorization and negative controls, original Merlin generation/edit/simulation and model reopen. [Upstream](https://github.com/yudocyudoc/buffalo-01/actions/runs/45554508204) and [Go](https://github.com/yudocyudoc/buffalo-01/actions/runs/45554508154) passed. The historical #80 run remains FAILED under v1; v2 is a separate post-hoc evaluation, not a retroactive pass. Together the remote receipt and offline replay demonstrate one real quantitative REST case only, not generalized quality or Cloudflare-side PySD.

[Replay artifact 14994769404](https://github.com/yudocyudoc/buffalo-01/actions/runs/45554508506/artifacts/14994769404) has 30-day retention (reported expiration 2026-12-25T05:36:48Z). Durable archival of authorized evidence is still pending; hashes alone are not a substitute for the original bytes.

## Follow-up experiment (proposed, not executed)

The base trajectory alone cannot discriminate a flow dependent on Demand from a hard-coded constant 5. Preserve the remote model and receipt unchanged. In a distinct derived revision set Demand=6; require Inflow=6 and Inventory=[10,16,22,28,34] using original PySD. Negative control: set Inflow=5 in a separate derived revision and require the intervention test to fail. Record parent hash, derived revision/hash, exact equation edit, simulation settings and observed series. No additional inference or Cloudflare deployment is needed. This is a prospective intervention test, distinct from the completed base replay.

See [implementation priorities](BUFFALO_FULL_ROADMAP.md).
