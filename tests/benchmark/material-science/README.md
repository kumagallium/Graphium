# Material-science benchmark harness (Phase 5a)

Tracks extraction quality of the Graphium material-science prompt against MatPROV
gold standard. See `docs/internal/external-source-extraction-prompt.md` §10.

## Layout

```
material-science/
  fixtures/           paired (*.input.txt, *.gold.json) per sample
  reports/            CSV + JSON outputs (gitignored except keep stub)
  fetch-dataset.ts    pulls gold standard from Hugging Face
  runner.ts           main: load fixtures, call LLM, evaluate, write reports
  evaluator.ts        MatPROV ↔ MatPROV structural comparison metrics
  sakura-runner.ts    OpenAI-compatible chat client for さくら AI engine
```

## Run

```
pnpm test:benchmark              # production open-set prompt (canonical metric)
pnpm test:benchmark -- --fixture seed-cu2dfexs    # filter by regex
pnpm test:benchmark -- --dry-run                  # skip LLM call, only structure check
```

### MatPROV-format reference run (diagnostic only)

```
pnpm test:benchmark -- --prompt matprov
```

Switches the prompt to the original Phase 5a MatPROV `@graph` format
(`matprov-prompt.ts`) and parses output via `matprov-parser.ts`. Pred
and gold are both `MatProvOutput`, compared via `evaluateMatProvSample`.

Use this as a **reference ceiling**: same model, same fixtures, but
domain-specific prompt. The delta vs the canonical (open-set) numbers
isolates the cost of open-set generalization from model strength.

Do NOT replace the canonical run with this — it does not exercise the
production prompt path. It is purely a diagnostic to attribute the
benchmark gap.

## Environment

Set in `.env` (worktree root):

```
SAKURA_AI_ENDPOINT=https://api.ai.sakura.ad.jp/v1   # OpenAI-compatible base URL
SAKURA_AI_API_KEY=...                                 # API key
SAKURA_AI_MODEL=gpt-oss-120b                          # model id
# Optional:
SAKURA_AI_CHAT_PATH=/chat/completions
SAKURA_AI_TEMPERATURE=0
SAKURA_AI_MAX_TOKENS=8192
```

## Adding fixtures

The MatPROV Hugging Face dataset (`MatPROV-project/MatPROV`) ships only
`(doi, label, prov_jsonld)`. Paper paragraph text is **not** included.

1. Fetch gold standards:

   ```
   pnpm test:benchmark:fetch -- --count 10 --offset 0
   ```

   This writes `<slug>.gold.json` and `<slug>.input.txt` placeholders.

2. Fill each `<slug>.input.txt` with the synthesis paragraph(s) from the
   source paper. Two options:

   **a) Manual paste**: open the PDF, copy the Methods / Experimental
   section, paste into the file.

   **b) Notion-managed fixtures**: if you keep extracted paragraphs in
   Notion under a "論文からの参考部分" heading per page, fetch via:

   ```
   pnpm test:benchmark:fetch-notion <notion-url-or-id> <fixture-slug>
   ```

   Requires `NOTION_TOKEN` in `.env` (Notion Integration secret) and the
   target page Shared to that Integration. Default section title is
   `論文からの参考部分`; override with `--section "<heading>"`.

   Fixtures with empty / placeholder-only `input.txt` are skipped by the
   runner.

`fixtures/.gitignore` excludes `*.input.txt` (paper text is copyrighted),
with an exception for the `seed-*` files which come from MatPROV's own
open-source prompt example. Gold standards (`*.gold.json`) are
commit-friendly because they are derived PROV graphs, not paper text.

Phase 5a ships with one seed fixture (`seed-cu2dfexs`) using the example
paragraph from the MatPROV paper (NeurIPS 2025 AI4Mat workshop). Expand
to 5–10 samples by populating additional `*.input.txt` files locally.

## Metrics

The runner reports four primary indicators plus a token-F1 sub-metric, all
computed in MatPROV (raw LLM output) space — no reverse translation:

| Metric     | Set                                                              |
|------------|------------------------------------------------------------------|
| Activities | Activity labels (normalized)                                     |
| Materials  | Entity labels where `type == material`                           |
| Tools      | Entity labels where `type == tool`                               |
| Edges      | `(Usage\|Generation, activityLabel, entityLabel)` triples         |
| Parameters | `(ownerLabel, paramKey, value)` triples                          |

Primary: normalized exact-match precision / recall / F1.
Normalization: NFKC + lowercase + punctuation/symbol strip + whitespace collapse.
Sub-metric: token-F1 over space-split label tokens (averaged across procedures).

When the LLM returns multiple procedures, gold and predicted procedures are
greedy-matched by normalized label first, then by output order.

### Semantic scoring (recommended for comparing prompts)

Exact match undercounts a lot: "Calcining" vs "calcination", or
"Fritsch Pulverisette P-5" vs "planetary ball mill", are misses, and the
gold covers synthesis only, so every characterization step the extractor
(rightly) keeps lowers precision. `semantic-judge.ts` scores by meaning:

1. The prediction and the gold become node lists (activities, entities,
   parameters). Predicted links follow the app's PROV rules: material / tool
   spans are Usage, output spans are Generation, and a material with the same
   name as an earlier step's output is that output.
2. A judge model maps each predicted node onto the gold node it denotes, or
   marks it as characterization (out of the gold's scope). It produces only
   the mapping.
3. Links are scored in code through the mapping.

Precision is reported twice: over all predictions, and over predictions in
scope (not characterization, or matched). Recall counts distinct gold nodes
hit. Several predictions mapped to one gold node (one sintering step per
temperature against a gold list value) each count as correct.

```
GRAPHIUM_USE_KEYCHAIN=1 DATA_DIR=<dir with models.json> \
  pnpm exec tsx tests/benchmark/material-science/semantic-eval.ts \
    --results <jsonl of {model, rep, id, raw: ProvIngesterOutput}> \
    --gold-map <json {id: gold path}> --out <jsonl> [--judge claude-opus-5]
pnpm exec tsx tests/benchmark/material-science/semantic-summary.ts <out.jsonl> <gold-map.json>
```

The output keeps the judge's mapping, so `semantic-summary.ts` recomputes the
scores without re-judging when the formula changes.

## Reports

Each run writes a timestamped CSV + JSON to `reports/`. CSV has one row per
sample. JSON keeps the full per-procedure breakdown for ad-hoc analysis.
