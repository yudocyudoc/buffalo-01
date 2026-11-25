# Native LTM six-reference benchmark — first experimental increment

Scope: six upstream SD-AI feedback-explanation fixtures. The 12 Git blob identities in manifest.json were checked against the fork and upstream UB-IAD/sd-ai on 2026-11-25. The JSON is precomputed feedback, not certified run receipts or reference trajectories. The original evaluator tests explanations, not native numerical parity.

| Fixture | Reference loops | Integration in STMX | Denominator |
|---|---:|---|---|
| armsRace | 3 | Euler | whole model |
| bassDiffusion | 2 | Euler | whole model |
| inventoryWorkforce | 3 | RK4 | 2 loop sets |
| predatorPrey | 5 | RK4 | whole model |
| marketGrowth | 20 | Euler | whole model |
| maibab | 7 | RK4 | 2 loop sets |

Protocol frozen before results: pinned pysimlin 0.8.5, original STMX bytes copied to disposable XMILE paths, no equations, topology, solver settings or time-grid changes. Only the already understood missing-keyurl importer error allows removal of one exact known unsigned empty AI metadata block, with reversible byte and XML checks. Signed metadata remains untouched. Read imported simulation specs and preserve trajectories; imported specs are not proof of actual integrator semantics. Inspect effective method separately before any admission, especially RK4. Stella instantaneous-flow/save-interval semantics may differ; record original attributes, don't approximate them away.

Match directed cycles by rotation, never reversal or loop name. Preserve duplicate reference identifiers in different loop sets. Require complete bijective membership between reference denominators and native partitions before numerical comparison. Never renormalize matched subsets or combine native partitions. Report exact grids or reference timestamp subsets; compare only same timestamps, not a global one-step shift. Report signed native series, reference magnitudes, absolute percentage-point max/RMSE, normalization (zero or 100) and strict polarity labels. U/Rux/Bux are not silently equated. Use existing provisional 0.1 pp threshold. Native period comparison only on a single unambiguous reference set, with shared reference boundaries assigned to the new period; multi-set flat periods are not verified. No trajectory oracle is supplied by these JSON fixtures; no claim of trajectory equivalence or general Stella compatibility.

The workflow builds a separate research image, then executes each case in its own network-disabled container with resource/time limits. It reports mismatches and execution failures without aborting subsequent cases. Green CI means the experiment produced parseable reports and comparator unit tests passed, NOT that the backend passed scientific admission. Missing reports, process exits/timeouts or changed reference hashes fail CI. All six reports, stderr, image ID and checkout SHA are uploaded. Every report is explicitly admitted=false. Floating base image and transitive packages remain a reproducibility limitation; actual installed versions are recorded. No production integration, no remote inference, no Bass adapter changes, no paid service, no magnitude-of-change claim. After observing native results, archive them, diagnose individual failure modes and decide next experiments before designing a generalized adapter.
