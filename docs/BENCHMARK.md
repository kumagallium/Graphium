# Knowledge Layer Benchmark

The Wiki pipeline (ingest → atomize → synthesize) is regression-tested by an
empirical benchmark under `bench/`. Corpus, ground-truth, and probes are
checked into the repository so anyone can reproduce the numbers.

## Why this exists

Graphium's discovery pipeline is built as a "chimera" — abductive,
analogical, dialectic, and deductive reasoning are all expected to fire in
balance, and outputs should preserve epistemic status (a *speculation*
should stay a speculation as it propagates upward). Whether a change to
the prompts, the router, or the schema actually moves these properties is
not a question you can answer by reading diffs; you need to *measure*.

`bench/` is that measurement.

## Quick start

```bash
pnpm bench:run                     # Run the benchmark, write bench/baseline.json
pnpm bench:report                  # Render the latest output as a Markdown table
pnpm bench:compare main            # Diff metrics against main's baseline.json
pnpm bench:adversarial             # Run safety / robustness probes (no LLM call)
pnpm bench:performance             # Run the perf regression test (no LLM call)
pnpm test:migration                # Replay migration fixtures, assert no data loss
```

The runner has two modes:

- **live** — calls the configured LLM. Requires `BENCH_API_KEY`
  (or `SAKURA_AI_API_KEY`). Use this for any merge decision.
- **dry-run** — deterministic heuristic fallback that needs no key. Used
  by CI for smoke tests; not authoritative for quality claims.

The runner chooses automatically based on key presence. Force one with
`BENCH_MODE=live` or `BENCH_MODE=dry-run`.

## Environment variables

| env | default | purpose |
|---|---|---|
| `BENCH_API_KEY` / `SAKURA_AI_API_KEY` | `""` | API key for the bench LLM. Production default targets `gpt-oss-120b` on [Sakura AI Engine](https://platform.sakura.ad.jp/ai-engine). |
| `BENCH_MODEL_ID` | `gpt-oss-120b` | Override the bench model. |
| `BENCH_MODEL_NAME` | `gpt-oss-120b (Sakura AI)` | Display name in reports. |
| `BENCH_API_BASE` | `https://api.ai.sakura.ad.jp/v1` | OpenAI-compatible endpoint. |
| `BENCH_PROVIDER` | `openai-compatible` | Provider kind. |
| `BENCH_PROFILE` | `baseline` | Profile name written into the output. |
| `BENCH_MODE` | auto | Force `live` or `dry-run`. |
| `BENCH_N` | 3 in live, 1 in dry-run | Independent samples per run; median is the representative value, distribution and raw per-sample metrics are kept on disk. |
| `BENCH_OUTPUT` | `bench/baseline.json` (for `baseline` profile) | Output file path. |
| `BENCH_WRITE` | `true` | Whether to write the output JSON to disk. |
| `BENCH_JUDGE_MODEL_ID` | same as `BENCH_MODEL_ID` | LLM-as-judge model (e.g. cheap Haiku-class for cost). |
| `BENCH_CORPUS_LIMIT` | unset | Use only the first N corpus notes (smoke runs). |

### n=3 averaging (live default)

LLMs are stochastic — across the Phase α / β work, single live runs on
this corpus showed `atom_count_total` swinging 5 ↔ 15 and
`observation_atom_ratio` swinging 0 ↔ 0.22 between consecutive runs at
the same code. A single run is not a reliable basis for any merge
decision.

The runner therefore defaults to **`n=3` in live mode**. For each
sample it runs the full ingester → atomizer → synthesizer → judge
pipeline independently. The headline `metrics` field on the JSON output
is the **median** per metric across the n samples; `aggregate.distribution`
keeps `{ median, mean, min, max, range }` per metric; `runs[]` keeps
the raw per-sample metrics so PR reviewers can see the noise floor
alongside the median. The `pipelineByNote` / `allClaims` / `allAtoms` /
`allSyntheses` arrays come from the run whose `lift_score` was closest
to the median (avoiding storing n × the corpus).

Dry-run mode defaults to `n=1` because the heuristic pipeline is
deterministic — re-running adds no information.

## Metrics

All metrics are normalized to 0–1. Implementation in `bench/metrics.ts`.

| metric | what it measures |
|---|---|
| `lift_score` | Fraction of Atoms whose title/body contains no domain-specific jargon (proper nouns, instrument names, abbreviations). |
| `mode_distribution_entropy` | Shannon entropy of Synthesis mode firing (`deductive` / `abductive` / `analogical` / `dialectic`), normalized by `log2(4)`. 0 = single mode dominates; 1 = perfect balance. |
| `epistemic_preservation` | Fraction of notes whose extracted Claim epistemic status matches ground-truth. |
| `adversarial_pass_rate` | Fraction of probes whose expected behavior is observed. |
| `novelty_score` | Fraction of Syntheses whose body is not a paraphrase of source Atoms. |
| `cross_language_consistency` | Fraction of `cross-language-pair` notes (same `pairId`, JP↔EN) that collapse into a single Atom. 1.0 when the corpus has no pairs (vacuous). |
| `domain_balance_score` | Per-domain Atom lift-rate, combined as `meanPass × normalizedEntropy`. Penalises both low lift and uneven lift across domains; 0 when only one domain has signal. |

Auxiliary counts (`claim_count_total`, `atom_count_total`,
`synthesis_count_total`, `observation_atom_ratio`) are recorded alongside.

## Corpus

The corpus is 53 notes across 6 domains and 2 languages (JP + EN),
designed to exercise both pipeline behaviour and corpus-level
generalisation:

| Category | Count | What it stresses |
|---|---|---|
| clean-lab | 5 | Standard JP experiment notes with PROV structure |
| clean-software | 3 | JP software design discussions |
| casual-musing | 4 | JP "maybe…?" speculations — should propagate as `speculation` |
| wrong-speculation | 2 | JP known-incorrect speculations — should not contaminate the knowledge layer |
| cross-domain-pair | 2 pairs | JP pairs that should fire `analogical` synthesis |
| contradiction-pair | 2 pairs | JP pairs with Rebuttal — should fire `dialectic` synthesis |
| pure-observation | 3 | JP notes without mechanism — should stay `observational`, fire `abductive` |
| clean-en-technical | 4 | EN lab / software notes — language portability of lift |
| casual-musing-en | 3 | EN speculations — `speculation` propagation must not be JP-only |
| bio-note | 5 (3 JP + 2 EN) | Biology domain coverage |
| econ-note | 5 (3 JP + 2 EN) | Economics domain coverage |
| humanities-note | 5 (3 JP + 2 EN) | Humanities domain coverage |
| cross-language-pair | 3 pairs (6 notes) | Same concept written in JP and EN — drives `cross_language_consistency` |

Phase μ-2 added the bottom six categories (notes 026–053). Ground-truth
annotations for the new notes were drafted by the implementer and then
reviewed by an independent LLM session before merge; revisions from that
review are folded into the committed `bench/ground-truth/`.

## Probes

Two kinds of probes live next to the corpus:

- **Spec probes** (`bench/probes/*.probe.json`, 10 files) — discovery-behavior
  checks paired one-to-one with upcoming Phases. Most are expected to *fail*
  on the bare-pipeline baseline (e.g. `casual-speculation-propagation` is
  what Phase η must pass).
- **Adversarial probes** (`bench/probes/adversarial/*.probe.json`, ≥10
  files) — safety and robustness checks. `safety` probes assert that
  malicious / PII / injection content does not propagate downstream;
  `robustness` probes assert that pathological inputs (empty, whitespace,
  100 KB body, mixed-language, circular reference) do not crash or stall
  the pipeline. Run with `pnpm bench:adversarial`.

## Migration fixtures

`bench/migration/fixtures/` stores frozen snapshots of older document /
index schemas. `pnpm test:migration` replays each fixture through the
production migration code and asserts the pre-declared invariants
(version bumped, key labels remapped, `title` / `createdAt` preserved).
In CI this job runs with `BENCH_MIGRATION_STRICT=true` — any data-loss
failure blocks the merge. New schema-bump Phases (η / γ / δ / ε / ζ)
add their pre-bump fixture to this directory.

## Performance regression

`pnpm bench:performance` runs the dry-run pipeline against a 100-note
synthetic corpus and records duration, peak heap delta, and the byte
size of `atoms` / `syntheses` JSON. Numbers are compared to
`bench/performance/baseline.json`; a metric exceeding +20 % is flagged
as a regression (warning, not block). Update the baseline with
`BENCH_PERF_UPDATE_BASELINE=true pnpm bench:performance`.

## CI

`.github/workflows/bench.yml` runs four jobs in parallel on every PR:

| Job | Source | Blocks merge? |
|---|---|---|
| `bench / wiki-pipeline` | `pnpm bench:run` (dry-run by default) | No (warning) |
| `bench / adversarial` | `pnpm bench:adversarial` | No (warning) |
| `bench / migration` | `pnpm test:migration` (`STRICT=true`) | **Yes** |
| `bench / performance` | `pnpm bench:performance` | No (warning) |

Each posts an independent sticky comment to the PR (`bench-delta` /
`bench-adversarial` / `bench-migration` / `bench-performance` headers).
A `workflow_dispatch` lets a maintainer run the live LLM mode against
the org's API-key secret when needed.

## For contributors writing a roadmap phase

Each phase declares ahead of time which metrics it must improve, then PR
delta proves it. See the development docs for the full phase list and
merge rules.
