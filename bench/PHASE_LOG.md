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
