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
pnpm test:benchmark              # all fixtures with usable input.txt
pnpm test:benchmark --fixture seed-cu2dfexs    # filter by regex
pnpm test:benchmark --dry-run    # skip LLM call, only structure check
```

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

## Reports

Each run writes a timestamped CSV + JSON to `reports/`. CSV has one row per
sample. JSON keeps the full per-procedure breakdown for ad-hoc analysis.
