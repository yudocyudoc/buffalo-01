# C4 — Inventory Workforce: damping versus normalized loop dominance

2026-11-26. Source: e951fe4b136968ccaeb1f703435c208ed6854202. Exploratory unblinded reviewer diagnostic; not a new matrix row, not a blinded semantic score, not a replacement for the frozen fixture. Zero provider requests and zero Simlin/Stella runs.

## Evidence and independent calculation

[Exact DeepSeek LOW wire](matrix-wires/inventoryWorkforce-deepseek-low.json), SHA-256 5946ce39184a9c1674757a5b7a89ead395f75f1e6e9cff313543247d93642820, contains original model, feedback and question, no separate stock trajectory. Model specifies dt=0.0625 month, 0–60 months, but not integration method. [LOW receipt](extension-receipts/C4-inventoryWorkforce-deepseek-low-r1.json): stop, valid JSON, 73962 input / 6734 completion tokens, 49346 ms. [HIGH receipt](matrix-receipts/C4-inventoryWorkforce-deepseek-r1.json): length, invalid JSON, 73962 / 8192, 55283 ms. Different cache metadata; no controlled latency result. LOW belongs only to extension.

Let I=Inventory, W=Workers, E=Expected Demand, D=exogenous demand. The supplied equations reduce to:

- dI/dt = 2 W - D
- dW/dt = ((E + 100 - I)/2 - W)/6
- dE/dt = (D - E)/6

For D=25 (assuming linear interpolation of the demand table and holding its final value), equilibrium is (100,12.5,25). Jacobian rows: (0,2,0), (-1/12,-1/6,1/12), (0,0,-1/6). Eigenvalues -1/6 and -1/12 ± i sqrt(23)/12. Strictly negative real parts; the fixed-demand affine continuous system converges, with no nonzero limit cycle. Oscillatory mode period 15.721616 months; envelope half-life 8.317766 months. Forward Euler at specified dt: complex update eigenvalue magnitude 0.9951052080, period 15.643019 months, envelope half-life 8.828891 months. Independent reconstruction, not a claim about the historical Stella solver.

| Reconstructed inventory local extremum (months) | Inventory | Absolute deviation from 100 |
| ---: | ---: | ---: |
| 5.625 | 87.483283 | 12.516717 |
| 13.8125 | 104.783137 | 4.783137 |
| 21.4375 | 96.882957 | 3.117043 |
| 29.3125 | 101.543053 | 1.543053 |
| 37.125 | 99.126326 | 0.873674 |
| 44.9375 | 100.462338 | 0.462338 |
| 52.75 | 99.746994 | 0.253006 |

At 60 months: I=100.131934, W=12.506740, E=24.999721. Archived set-1 B1 peaks at months 9.1875, 17.125, 24.9375, 32.875, 40.6875, 48.5625 and 56.4375 are 99.8490%, 99.4809%, 99.7049%, 99.5441%, 99.9205%, 99.9843%, 99.6767%. The percentages do not decay with reconstructed stock amplitude. Their ~7.9-month recurrence is consistent with half the oscillatory mode period, not the stock oscillation period.

## Selected claims (not exhaustive)

- DeepSeek LOW: "this is a **sustained limit cycle, not a damped transient**" — contradicted by equations and stable continuous/Euler modes.
- DeepSeek LOW: "a **steady period of roughly 7.9 months**" — supported for successive dominance patterns, not stock oscillation period; later phrasing conflates them.
- DeepSeek LOW: "B2's share spikes to near 100% (peaks of 99.85, 99.48, 99.70, 99.54, 99.92, 99.98, 99.68)" — these are B1 peaks, not B2.
- DeepSeek LOW: "As shipping jumps, B1's share collapses from ~97% to ~49% while B2's rises from ~3% to ~51%." — reverses shares: at 1.0625, set-1 B1=3.03049%, B2=96.96951%; at 2, B1=50.68917%, B2=49.31083%.
- DeepSeek LOW: "it cannot tell you the expectation loop's share of total model behavior" — supported, independent denominators.
- [Inkling HIGH](matrix-receipts/C4-inventoryWorkforce-inkling-r1.json): "This is the signature of an underdamped adjustment" — consistent with derived modes; relative dominance alone does not prove damping. "it is always 100% of that set" — contradicted by initial zero scores; first nonzero sample is 1.0625.
- [GLM HIGH](matrix-receipts/C4-inventoryWorkforce-glm-r1.json): valid JSON but only an introductory paragraph; no substantive mechanism or temporal explanation.

Do not infer general superiority. Distinguish unsupported claims from contradictions demonstrable by equations. Keep this post-hoc diagnostic separate from scoring rubric. Candidate regression for C5 or information contrast for C3, not a reason to alter C4 inputs.

## Reproduction (Node, offline)

Run as an ES module from this directory. No dependencies, provider or mutation.

```js
import {readFileSync} from 'node:fs';
const w=JSON.parse(readFileSync('matrix-wires/inventoryWorkforce-deepseek-low.json'));
const model=JSON.parse(w.wire.messages[1].content);
const f=w.wire.messages[3].content;
const feedback=JSON.parse(f.slice(f.indexOf('{')));
const dt=model.specs.dt;
let I=100,W=10,E=20;
const rows=[];
for(let k=0;k<=60/dt;k++){
  const t=k*dt,D=t<=1?20:t<2?20+5*(t-1):25;
  rows.push({t,I,W,E,D});
  [I,W,E]=[I+dt*(2*W-D),W+dt*((E+100-I)/2-W)/6,E+dt*(D-E)/6];
}
console.log(rows.slice(1,-1).filter((r,j)=>r.t>2&&
  ((r.I>rows[j].I&&r.I>rows[j+2].I)||(r.I<rows[j].I&&r.I<rows[j+2].I))));
for(const l of feedback.feedbackLoops){
  const s=l['Percent of this Feedback Loop Set Behavior Explained by Loop'];
  console.log(l.loopset,l.identifier,s.find(r=>r.value!==0),
    s.filter((r,i)=>i>0&&i<s.length-1&&r.value>s[i-1].value&&r.value>s[i+1].value));
}
```

## Continuity

Original matrix 12/54 returned, 10 valid JSON. LOW extension: one returned, one RESERVED (Mai-Bab) without receipt at source cut. Cannot establish whether provider was reached. Do not resend ambiguous reservation; reconcile if original provider evidence available, otherwise count consumed reservation with unknown outcome under no-retry policy. Six listed original r1 rows for Gemma off/on and GPT-OSS remain pending. C1 historical review and native-route gaps remain open; C4 explicitly ahead of C1 completion. No C2/C3 closure claimed. No change to prompt, runtime, ledger, budget or evaluation protocol.
