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

## First execution — comparator control failure (no scientific observations)

[Run 45693067519](https://github.com/yudocyudoc/buffalo-01/actions/runs/45693067519), job 139483285377, head 8da1563ac1bd7fb5922089566cf6a89fc3456b45. The pinned wheel installed successfully; 4/5 controls passed. The unsigned-empty-metadata control failed because ElementTree stores indentation preceding a removed child in its parent's text or preceding sibling's tail. Byte-exact removal was correct, but serialized XML differed in whitespace. No fixture simulation was executed. The correction compares tag, attributes, non-whitespace text/tail and ordered children, ignoring only whitespace-only formatting; the exact known block, byte reversibility and original source hash requirements remain unchanged. Added negative equation/attribute checks and a preceding-sibling control. Prepare the artifact directory and capture build output before running Docker so future build failures retain diagnostic evidence. No score, time, topology, denominator or scientific verdict criterion changed.

## Second execution — five native observations and one malformed source

[Run 45693764412](https://github.com/yudocyudoc/buffalo-01/actions/runs/45693764412), job 139485700637, head 61813d0937f557f84873314f8d837f983e96dab7, artifact [15059134410](https://github.com/yudocyudoc/buffalo-01/actions/runs/45693764412/artifacts/15059134410) (ZIP SHA-256 reported by Actions: fc2988bb97fe2e77b606cdebc8d451dec47f4008849bffc6f7055397caa3dff2). All five comparator controls passed. Five cases ran in exhaustive mode with exact reference grids. These figures come from CI logs; artifact bytes have not yet been archived in git.

| Case | Matched loops | Maximum comparable error pp | Observation |
|---|---:|---:|---|
| Arms Race | 3/3 | 5.488942633746774e-13 | Native scores and periods match |
| Bass | 2/2 | 2.342469669229999 | Known native score and period mismatch |
| Inventory Workforce | 3/3 | 5.139764169825867e-10 | Both denominators match; flat multi-set periods unverified |
| Predator Prey | 5/5 | 0.17468822432812736 | Scores exceed 0.1 pp; period check fails |
| Market Growth | 11/20 | not comparable | Nine loops include a native internal DELAY3 node; contraction is a future hypothesis, not applied |
| Mai-Bab | not run | not measured | XML ParseError at line 237 column 526 before simulation |

The malformed Mai-Bab source has an invalid UTF-8 value in a table display header_font_family attribute, raw value hex d0525eff7f. The connector's decoded text was not byte-identical; reconstructing the raw bytes from that single attribute reproduced the pinned Git blob 623ab6a83a91caa8d810b2cd4b71d7c0ba63fa3f exactly. The next run explicitly permits one reversible deletion of this exact attribute (including its leading space, offset 17656), only in that pinned source after the exact parser error, and confirms its table is uniquely located under model/views/view/style. All remaining bytes are unchanged. Original XML error, removal bytes/offset and source/derived SHA-256 are reported. The existing unsigned-AI metadata fallback remains separate. Source XML errors inside the case now produce a structured EXECUTION_FAILURE report instead of an uncaught process error, with source identity checks still hard failures. This is a derived import experiment, not evidence that Simlin imports the malformed original directly. No topology contraction, numerical tolerance adjustment, reference rewriting or generalized Bass adaptation. New CI pending.

## Third execution — full native baseline, 2026-11-25

Run [45694445445](https://github.com/yudocyudoc/buffalo-01/actions/runs/45694445445), job 139488054065, artifact 15059503682. Six controls and all six report processes passed. The ZIP was downloaded and its exact 430606 bytes independently checked against the Actions SHA-256; all 15 member hashes and sizes, checkout SHA and image identity are recorded in `evidence/45694445445/manifest.json`. The full ZIP is available from the original artifact; its bytes are not yet committed to git (connector cannot upload local binary archives directly). The manifest is not a substitute for the reports. Mai-Bab now executes after the pinned view-font repair, with 491 exact timestamps, exhaustive 10 native cycles versus seven reference cycles, three extra food-related paths, no comparable denominator and no admitted result. First five results repeat exactly.

### Retrospective representation diagnostics (separate from frozen native verdict)

Run `python infra/full-runtime/ltm-benchmark/representation_diagnostics.py github-actions-artifact-15059503682.zip evals/categories/feedbackExplanationData/marketGrowth.stmx`. The script verifies the ZIP and all 15 member hashes before reading. A current CI report directory may also be supplied for a new diagnostic. The native reports are never rewritten.

Inventory Workforce: the union of flat reference period IDs is B1/B2. Only Feedback Loop Set 1 contains both identifiers; Set 2 contains B1 only. That makes Set 1 the unique compatible scope under the hypothesis that the flat timeline describes a single set. It maps to native partition 1 by complete cycle membership. Observed 944/944 active samples match; 17 inactive samples excluded (both reference and native zero). Set 2's reference periods are not supplied unambiguously and remain unverified. This is not an assertion that upstream documented the scope explicitly.

Market Growth: the pinned source equation for current capacity is DELAY3(desired_capacity,Capacity_Acquisition_Delay,  Initial_Capacity). Only the exact internal node $⁚current_capacity⁚0⁚delay3, between desired_capacity and current_capacity, is contracted in cycle identity for the retrospective comparison. No simulation or scores change. All 20 cycles map bijectively, nine contracted, single native partition, all 20 polarity labels agree. Maximum native score error 0.5519361143246186 pp (R4 at month 25); 74/80 active period samples match, six differ. The 0.1 pp threshold still fails. Mapping resolves a representation obstacle, not the numerical discrepancy. This is not an approved general delay contraction algorithm.

CI will re-run these two diagnostics on freshly produced reports and retain their JSON separately. No scientific thresholds or native verdicts changed. Further work: independent link-level attribution/solver diagnostics on Predator Prey and Market Growth, establish why Mai-Bab contains three extra cycles, and preserve exact full baseline ZIP durably in repository storage via a capable authorized client. No production admission.
