# Native LTM narrative fidelity baseline

This offline benchmark covers eight successful saved simulations from two experiments. It keeps the output of the original narrative tool (HTML and loop descriptions) and Merlin's final session HTML separately. Five cases come from the [eight-case matrix](https://github.com/yudocyudoc/buffalo-01/actions/runs/45759559827/artifacts/15090822807). Arms Race, Bass and perturbed Mai-Bab come from the [three-case diagnostic](https://github.com/yudocyudoc/buffalo-01/actions/runs/45770076467/artifacts/15094458175). The three original failures produced no saved narrative.

Run from the repository root with Node 22.

```sh
node infra/full-runtime/ltm-fidelity-baseline.mjs
node --test infra/full-runtime/ltm-fidelity.test.mjs
```

The first command prints per-claim evidence, including a counterexample sample for an incorrect dominance interval. The second checks the frozen annotations, the full partition timelines against the original receipts, and edge cases. The Full Runtime offline workflow discovers the test through its existing test glob.

| Surface | Supported | Contradicted | Unverified |
|---|---:|---:|---:|
| Persisted narrative | 11 | 3 | 1 |
| Final Merlin response | 5 | 7 | 3 |

A reviewer selected and transcribed 30 claims into structured annotations anchored to the original passages. Selection includes known failures, correct values and coalitions, and causal explanations outside the checker's scope. These counts describe that selected set. They do not estimate accuracy on unannotated text, future responses or other providers. A repeated claim counts once on each surface where it was assessed.

## Mathematical contract

The extractor uses the full scalar trajectories on their saved grid. It returns all tied times for each global minimum and maximum. Activity counts nonzero signed samples per loop and tracks missing observations. It rebuilds coalitions from signed native scores using Buffalo's independent implementation of the pinned pysimlin rule. Each partition has its own timeline with inclusive endpoints. Empty coalitions represent inactivity and missing scores produce unknown intervals. Partial loop inventories leave dominance unverified.

Point values and extrema use the decimal precision recorded in each annotation (half a unit in the last displayed place). An approximate time with specified precision must resolve to one saved sample; the checker does not interpolate. The threshold claim about hares at time 14 uses strict greater-than. The Mai-Bab claim about “around 1930” is scored at its stated center year. As a sensitivity check the full 1925–1935 window ranges from 2,785 to 4,114 deer (rounded), well below 10,399. This convention is a benchmark decision, not a general interpretation of approximate language.

Coalition claims assert the exact set at every saved sample in the specified partition and interval. In Mai-Bab, both surfaces assert B6 alone through 2300. Both get a counterexample at 1975, the first sample with B1 and B6 together. General mechanism explanations remain unverified. The structured claim checker runs offline; integrating verified claims into client-facing text and measuring that change on a fresh set of responses are subsequent increments.

## Provenance and reproduction

The ZIP digests published by GitHub are `ba42be28b8507a2e859ab8a6948b180314146cbb85c11884ca74febd5c5a193f` (matrix) and `cf0e6355ba000d4f8863559c6f968d99c31b11d98867d57cd1b16957c2f710a0` (diagnostic). The importer checks the SHA-256 of every selected original JSON member before projecting it. The committed compressed corpus contains the two surfaces, full trajectories, loop scores and periods, run identity and receipt hashes. The benchmark pins the uncompressed corpus digest.

To rebuild from already extracted artifacts, pass the two directories that directly contain the case JSON files.

```sh
node infra/full-runtime/evidence/ltm-fidelity/import.mjs MATRIX_DIRECTORY DIAGNOSTIC_DIRECTORY
```
