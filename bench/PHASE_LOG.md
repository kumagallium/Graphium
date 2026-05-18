# Phase log

A ledger of each Wiki-pipeline phase as it lands on `main`. The full
benchmark spec is in `docs/internal/wiki-discovery-mode-fullspec-2026-05.md`
(internal); the user-facing reference for the bench scripts is
`docs/BENCHMARK.md`.

Conventions:

- `bench/baseline.json` stays fixed at Phase μ-1's snapshot. Every phase
  is measured against that snapshot, **not** against the previous phase.
  The fixed baseline lets each phase's claim be re-verified months
  later.
- Per-phase live runs are committed to `bench/results/<phase>-<date>.json`.
  These are the durable record of "what the metric was the day the PR
  merged" so the numbers cannot drift after the fact.
- Each entry below is short: pre-declared metric, observed delta, and
  whether the phase was merged / revised / abandoned.

## μ-1 — benchmark foundation (PR [#293](https://github.com/kumagallium/Graphium/pull/293), merged 2026-05-17)

The baseline itself. No comparison; this run **is** the reference.

| metric | value | notes |
|---|---|---|
| `lift_score` | 0.800 | LLM judge (gpt-oss-120b) over 5 atoms |
| `mode_distribution_entropy` | 0.500 | n=2 syntheses, both fired in different modes |
| `epistemic_preservation` | 0.875 | heuristic (Phase η will replace) |
| `adversarial_pass_rate` | 0.600 | 6 / 10 probes pass |
| `novelty_score` | 1.000 | LLM judge |
| `observation_atom_ratio` | 0.000 | **none** of the 5 atoms tagged `observational` |
| `claim_count_total` | 41 | 1 / 25 notes (010-casual-musing-sleep) under threshold |
| `atom_count_total` | 5 | atomizer was conservative this run |
| `synthesis_count_total` | 2 | confidence-threshold-gated |

Snapshot: `bench/baseline.json` itself — this is the fixed reference and is not duplicated under `bench/results/`.

## α — rung-2 lift + observational atom preservation (PR [#294](https://github.com/kumagallium/Graphium/pull/294), merged TBD)

Pre-declared metrics:
- ✅ `observation_atom_ratio` must move off zero (load-bearing)
- ⚠️ `lift_score` should rise ≥ +0.10 (target +0.15 per spec)

Live run: CI workflow_dispatch [run 26022706841](https://github.com/kumagallium/Graphium/actions/runs/26022706841) on `feat/wiki-atomizer-lift`. Snapshot: `bench/results/with-alpha-2026-05-18.json`.

| metric | baseline (μ-1) | with-α | Δ |
|---|---|---|---|
| `lift_score` | 0.800 | 0.857 | ▲ +0.057 |
| **`observation_atom_ratio`** | **0.000** | **0.214** | ▲ **+0.214** |
| `epistemic_preservation` | 0.875 | 0.917 | ▲ +0.042 |
| `novelty_score` | 1.000 | 1.000 | · 0 |
| `adversarial_pass_rate` | 0.600 | 0.600 | · 0 |
| `mode_distribution_entropy` | 0.500 | 0.000 | ▼ −0.500 |
| `claim_count_total` | 41 | 41 | · 0 |
| `atom_count_total` | 5 | 14 | ▲ +9 |
| `synthesis_count_total` | 2 | 2 | · 0 |

Verdict: **merge**. The load-bearing metric (`observation_atom_ratio`)
moved from a hard zero to 21.4 % — spec g6 is no longer absolute.
`lift_score` moved in the right direction but below the headline target;
the likely cause is that the atomizer became more permissive
(`atom_count` 5 → 14), so the lift-quality is averaged over a larger
pool. Watch in subsequent phases; not a reason to revert.

The `mode_distribution_entropy` regression is sampling noise from n=2
syntheses (spec §15(r7) flags this); Phase β is the entropy-targeting
phase and will retest.

## β — synthesis router rebalance + per-mode confidence thresholds (PR TBD, status: **revise / defer**)

Pre-declared metrics:
- `mode_distribution_entropy` should rise above the baseline 0.5
- `observation_atom_ratio` must NOT regress below α's 0.214
- `lift_score` neutral

Implementation (4 sub-changes, see commit history):
- **β-1** removed `deductive` from candidateModes whenever another mode fires (router as a "true fallback")
- **β-2** widens abductive's firing condition to `observational + known.length >= 2`
- **β-3** splits `SYNTHESIS_CONFIDENCE_THRESHOLD` into a per-mode map (`deductive` 0.92, others 0.85) with `DEFAULT_SYNTHESIS_THRESHOLD = 0.85`
- **β-4** renames callers to `DEFAULT_SYNTHESIS_THRESHOLD` and emits the per-mode map back in the `/synthesize` response

### Live evidence (n=3 on `temp/alpha-plus-beta`, gpt-oss-120b on Sakura AI Engine)

| run | lift | entropy | obs_ratio | epi | atoms | syn | modes |
|---|---|---|---|---|---|---|---|
| α+β #1 ([26024305995](https://github.com/kumagallium/Graphium/actions/runs/26024305995)) | 0.600 | **0.000** | 0.000 | 0.913 | 5 | 1 | [dialectic] |
| α+β #2 ([26024578995](https://github.com/kumagallium/Graphium/actions/runs/26024578995)) | 0.667 | **0.000** | 0.222 | 0.909 | 9 | 2 | [analogical, analogical] |
| α+β #3 ([26024580526](https://github.com/kumagallium/Graphium/actions/runs/26024580526)) | 0.400 | **0.000** | 0.000 | 0.909 | 5 | 2 | [analogical, analogical] |

Verdict on original β: **does not deliver the pre-declared metric**. Entropy stays at 0 across all three runs. β-1 successfully eliminates deductive monoculture (modes shifted away from `deductive`), but the synthesizer's tiny output count (n=1–2 per session) collapses into whichever single mode the router recommends — a deductive monoculture is replaced by an analogical / dialectic monoculture, not by mode diversity.

### β-revised — drop β-1, keep β-2/β-3/β-4

Hypothesis: keeping `deductive` as a co-candidate (the old behavior) might give the LLM more freedom to choose mode-by-content. β-2 and β-3 stay as they don't independently regress anything.

| run | lift | entropy | obs_ratio | epi | atoms | syn | modes |
|---|---|---|---|---|---|---|---|
| α+β-rev #1 ([26025519202](https://github.com/kumagallium/Graphium/actions/runs/26025519202)) | 0.667 | **0.000** | 0.133 | 0.875 | 15 | 2 | [analogical, analogical] |
| α+β-rev #2 ([26025520519](https://github.com/kumagallium/Graphium/actions/runs/26025520519)) | 1.000 | **0.000** | 0.000 | 0.864 | 5 | 1 | [deductive] |
| α+β-rev #3 ([26025522116](https://github.com/kumagallium/Graphium/actions/runs/26025522116)) | 0.600 | **0.000** | 0.000 | 0.833 | 5 | 2 | [deductive, deductive] |

Verdict on β-revised: **still does not deliver entropy**. Reverting β-1 restores deductive monoculture in 2/3 runs; entropy stays at 0.

### Conclusion

The pre-declared metric (`mode_distribution_entropy > 0.5`) is **structurally unreachable** in the current corpus state. Synthesizer routinely emits only 1–2 candidates that survive the confidence threshold, and entropy = 0 unless those candidates span two distinct modes — which the LLM rarely does in a single session regardless of router pressure. β is not the right phase to fix this; the corpus is.

Action per spec §14:
- **(d2) revise** has been attempted (β-1 reverted) — did not unstick entropy
- **(d1) defer**: PR #295 stays open as a holding ground but is not merged. β's pre-declared effect cannot be demonstrated at this corpus size, and merging would lock in changes whose value cannot yet be measured.
- β-3 (per-mode confidence threshold) is genuinely useful infrastructure and may be salvaged into a smaller PR after Phase μ-2 / μ-3 expands the synthesis sample, at which point entropy becomes a measurable gate.

### What this teaches about the bench itself

n=1 is **not** a reliable basis for any phase decision in this corpus state. The variance run-to-run on atom_count (5 → 14 → 5 → 15) and obs_ratio (0 → 0.214 → 0) is larger than most phase effects. Future phases should default to n=3 averaging in the runner (spec §5 already assumes this) — that scaffold is the natural follow-up to Phase μ-2.

Snapshots:
- `bench/results/beta-alone-2026-05-18-run1.json` — β alone (no α) for completeness
- `bench/results/with-alpha-beta-2026-05-18-run{1,2,3}.json` — α + original β, n=3
- `bench/results/with-alpha-beta-revised-2026-05-18-run{1,2,3}.json` — α + β-revised, n=3
