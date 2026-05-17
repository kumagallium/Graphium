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
| `BENCH_OUTPUT` | `bench/baseline.json` (for `baseline` profile) | Output file path. |
| `BENCH_WRITE` | `true` | Whether to write the output JSON to disk. |
| `BENCH_JUDGE_MODEL_ID` | same as `BENCH_MODEL_ID` | LLM-as-judge model (e.g. cheap Haiku-class for cost). |

## Metrics

All metrics are normalized to 0–1. Implementation in `bench/metrics.ts`.

| metric | what it measures |
|---|---|
| `lift_score` | Fraction of Atoms whose title/body contains no domain-specific jargon (proper nouns, instrument names, abbreviations). |
| `mode_distribution_entropy` | Shannon entropy of Synthesis mode firing (`deductive` / `abductive` / `analogical` / `dialectic`), normalized by `log2(4)`. 0 = single mode dominates; 1 = perfect balance. |
| `epistemic_preservation` | Fraction of notes whose extracted Claim epistemic status matches ground-truth. |
| `adversarial_pass_rate` | Fraction of probes whose expected behavior is observed. |
| `novelty_score` | Fraction of Syntheses whose body is not a paraphrase of source Atoms. |

Auxiliary counts (`claim_count_total`, `atom_count_total`,
`synthesis_count_total`, `observation_atom_ratio`) are recorded alongside.

## Corpus

The starting corpus is 25 notes (Japanese, multi-domain) categorized to
exercise specific pipeline behaviors:

| Category | Count | What it stresses |
|---|---|---|
| clean-lab | 5 | Standard experiment notes with PROV structure |
| clean-software | 3 | Design discussions |
| casual-musing | 4 | "Maybe…?" speculations — should propagate as `speculation` |
| wrong-speculation | 2 | Known-incorrect speculations — should not contaminate the knowledge layer |
| cross-domain-pair | 2 pairs | Pairs that should fire `analogical` synthesis |
| contradiction-pair | 2 pairs | Pairs with Rebuttal — should fire `dialectic` synthesis |
| pure-observation | 3 | No mechanism stated — should stay `observational`, fire `abductive` |

## Probes

Ten adversarial scenarios in `bench/probes/`. Many are expected to *fail*
on the bare-pipeline baseline; each is the target metric for a specific
upcoming phase (e.g. `casual-speculation-propagation` is what Phase η
must pass).

## CI

`.github/workflows/bench.yml` runs the Tier 1 unit tests
(`bench/metrics.test.ts`) plus a dry-run bench on every PR, and posts a
delta comment against `main`. A `workflow_dispatch` lets a maintainer run
the live mode against the org's API-key secret when needed.

## For contributors writing a roadmap phase

Each phase declares ahead of time which metrics it must improve, then PR
delta proves it. See the development docs for the full phase list and
merge rules.
