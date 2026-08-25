# FAQ

Honest answers to the questions that come up most — especially the "why did it do that?" kind about the Knowledge layer. Graphium's design goal here is that every number you run into is either **a cost you decided** or **a value measured from your corpus**, never a hidden quality filter. Click a question to expand its answer.

::: details Why am I getting few Insights?

[Insights](/knowledge-layer) are abstractions: the model reads your Claims and tries to factor out a rule that would survive outside its original context (the "portability test"). When few appear, check these in order:

1. **Do your Claims converge?** A collection of one-off facts has no recurring pattern to abstract. The model is explicitly told that *an empty list beats a forced Insight*, so zero can be the honest answer for a young or scattered corpus. Insights start appearing when several Claims circle the same rule.
2. **Which model is doing the abstracting?** Insight generation uses the **Chat & Insight model** from [Settings](/settings). Abstraction is the hardest step in the pipeline, and smaller local models often return empty lists or mere restatements where a stronger model finds real patterns. We recommend a frontier-tier model here (for example Claude Opus or Claude Sonnet) — being "reasoning-capable" or merely large is not always enough; see the guide table in [Setting up AI](/ai-setup). If Insights are rare, try assigning a stronger model and running discovery again — same corpus, one variable changed. If a strong model still finds nothing new, the material (not the software) is the limit.
3. **Are new candidates reinforcing instead of creating?** A candidate that closely matches an existing Insight is not dropped — it is folded into that Insight as additional support. The result panel counts these as *reinforced*. If you see reinforcements, discovery is working; your existing Insights are getting stronger rather than multiplying.
4. **Has everything actually been looked at?** Scans report their measured coverage as **covered n/m** — how many of your Claims were in view at least once. Ingest-time scans are budgeted (see the next question), so a large corpus is only partially covered per ingest by design. To sweep everything, run **Discover Insights from Claims** in [Settings](/settings) → **Knowledge**: it shows the measured number of LLM calls needed for full coverage before running, and reports the coverage it reached.

:::

::: details Does Graphium secretly limit how many Insights or Claims are created?

No. There are no quality-based silent drops: the model's confidence score is recorded and shown, never used to discard a candidate, and there is no minimum or maximum count a scan must produce. Claims work the same way — the extractor is told to harvest every distinct transferable point, with no fixed cap.

The numbers that *do* exist fall into three categories, and each has a reason you can check:

| Number | What it is | Why it exists |
|---|---|---|
| Scans per ingest (default 3) | A user setting in [Settings](/settings) → AI. Each scan is one LLM call over one cluster of Claims | **Cost control — yours to decide.** Set 0 to skip scanning at ingest entirely; the result always reports the measured coverage so you know what was and wasn't looked at |
| Calls needed for full coverage | Shown in the confirm dialog of **Discover Insights from Claims** | **Measured, not configured.** Computed from how your Claims cluster; scanning runs until every Claim has been in view at least once |
| ~50 Claims per LLM call, previews truncated | Internal slice size | **Context-window protection** — more would silently overflow the model's input |
| Duplicate threshold (embedding similarity) | Splits candidates into "new" vs. "matches an existing Insight" | **Near-duplicates become reinforcement**, not new pages. Nothing is discarded — the matched Insight gains the new supporting Claims. Without an embedding model this check simply passes everything through as new |
| 0–8 candidates per call, up to 3 relations per Insight | Prompt-side ranges | **Anti-runaway guards** on LLM output verbosity, not caps on your knowledge — repeated scans keep adding what they find |
| At least 2 Claims before scanning | Run precondition | Cross-Claim patterns need something to cross; with a single Claim there is nothing to scan against yet |
| Unknown source IDs dropped | Parser guard | **Hallucination defense** — a candidate citing a Claim that doesn't exist is discarded rather than saved with a broken reference |

If you ever see behavior that looks like a hidden filter and isn't explained by this table, that's a bug worth [reporting](https://github.com/kumagallium/Graphium/issues).

:::

::: details How do I tell whether it's Graphium or my model?

Run one controlled experiment: open [Settings](/settings) → **Knowledge** → **Discover Insights from Claims**, and note the result line — *created*, *reinforced*, and *covered n/m*. Full coverage with reinforcements but no new Insights means the pipeline looked at everything and your existing abstractions already cover the patterns present. Then assign a stronger **Chat & Insight model** and run it once more. If the stronger model creates Insights the smaller one didn't, the model was the bottleneck; if not, your Claims genuinely don't hold new recurring patterns yet — write more notes and let them converge.

:::

::: details What's the difference between Claims and Insights?

A **Claim** is one grounded assertion extracted from your notes; an **Insight** is a pattern that recurs across Claims. They form the narrow waist of the hourglass: notes → claims → insights. See the [Knowledge layer](/knowledge-layer) page for the full picture.

:::
