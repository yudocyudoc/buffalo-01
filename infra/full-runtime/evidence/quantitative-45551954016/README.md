# Archived synthetic quantitative model and receipt

Origin: [remote run 45551954016](https://github.com/yudocyudoc/buffalo-01/actions/runs/45551954016), artifact 14995035411. The original run is FAILED under v1; the separate [v2 replay](https://github.com/yudocyudoc/buffalo-01/actions/runs/45554508506/job/139003214241) passed. These two JSON files are byte-identical to the corresponding original artifact members (verified against original Git blob hashes on archival; SHA-256 checked in CI). They contain the synthetic model, the expired one-shot grant and non-secret measured inference metadata, and the cleanup outcome. They contain no provider credentials, application secrets, user project data or registry account path. This public repository intentionally does not copy the entire infrastructure artifact.

| Member | SHA-256 |
|---|---|
| remote-receipt.json | 5da8e835794921082d9fa5560f3be135772d2153349c2533b45a3e2ea37b0696 |
| cleanup.json | 13ad37de7af1a621217cf3e959f5eddcda4e26a719c99fefe1a2ef27f02d2170 |
| Original artifact ZIP (not archived here) | e4ce0527482a3f890dbebeeeff297b6fa5beff52a663784f274d5ebf16b034ae |
| Original grant.json (not separately archived; embedded in receipt) | 56c470ceb26acc56038ffa22365541cc96bc2a7051f2e288ff6c76d3c4e488a6 |
| Original registry.json (not archived here) | 3e58cd0a5b73d4ebf78d3ecf7e8bc71dd5b714601f0ef0b0562c48511287c4e4 |

The initial archive is independent of the temporary Actions artifact. Do not edit the receipt or treat the model as a controlled fixture. All scenario changes occur on a clone with the parent model hash recorded. The intervention script reruns the exact baseline with the v2 verifier, then sets only Demand=6 and checks the actual upstream PySD response; the separate executable hard-coded Inflow=5 control must fail the intervention predicate, not merely fail to simulate. The experiment tests the Demand→Inflow dependency of this specific model, not causal validity in the physical world, nor the DailyDemandRate→Demand dependency. No new inference or deployment. CI output is pending until observed.
