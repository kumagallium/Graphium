# FAQ

Honest answers to the questions that come up most — especially the "why did it do that?" kind about the Knowledge layer. Graphium's design goal here is that every number you run into is either **a cost you decided** or **a value measured from your corpus**, never a hidden quality filter. Click a question to expand its answer.

::: details Why am I getting few Insights?

[Insights](/knowledge-layer) are abstractions: the model reads your Claims and tries to factor out a rule that would survive outside its original context (the "portability test"). When few appear, check these in order:

1. **Do your Claims converge?** A collection of one-off facts has no recurring pattern to abstract. The model is explicitly told that *an empty list beats a forced Insight*, so zero can be the honest answer for a young or scattered corpus. Insights start appearing when several Claims circle the same rule.
2. **Which model is doing the abstracting?** Insight generation uses the **Insight model** from the **Insight discovery** section in [Settings](/settings) (falls back to the chat model, then the default, when unset). Abstraction is the hardest step in the pipeline, and smaller local models often return empty lists or mere restatements where a stronger model finds real patterns. We recommend a frontier-tier model here (for example Claude Opus or Claude Sonnet) — being "reasoning-capable" or merely large is not always enough; see the guide table in [Setting up AI](/ai-setup). If Insights are rare, try assigning a stronger model and running discovery again — same corpus, one variable changed. If a strong model still finds nothing new, the material (not the software) is the limit.
3. **Are new candidates reinforcing instead of creating?** A candidate that embedding-matches an existing Insight is not automatically folded in — embedding similarity only narrows down a *candidate* pair; the AI then judges whether it's really the same claim, a contradiction, or actually different. Same becomes reinforcement (the result panel counts these as *reinforced*); contradiction keeps both Insights and flags them in the Check tab; only genuinely different candidates create a new page. If you see reinforcements, discovery is working; your existing Insights are getting stronger rather than multiplying.
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
| Duplicate threshold (embedding similarity) | Narrows candidates down to a "possible match" *shortlist* against existing Insights | **This is candidate-finding, not the verdict.** Embedding similarity is blind to negation and direction (a Claim that a value "decreases" reads as near-identical to one where it "increases"), so the AI judges each shortlisted pair as same / contradiction / different before anything is merged: same → reinforcement (existing Insight gains the new supporting Claims); contradiction → both Insights are kept and flagged as a `contradiction` in the Check tab (open both to compare); different → a new page. Without an embedding model this check passes everything through as new (no shortlist, no AI judgment needed) |
| Topic matching: embedding similarity > 0.9 against existing Topics | Splits a Claim's proposed topic names into "matches an existing Topic" vs. "new" | **Same reuse principle as Insights** — normalized title match is tried first; without an embedding model this check falls back to title match only, so more Topics get created rather than silently merged |
| 0–8 candidates per call, up to 3 relations per Insight | Prompt-side ranges | **Anti-runaway guards** on LLM output verbosity, not caps on your knowledge — repeated scans keep adding what they find |
| At least 2 Claims before scanning | Run precondition | Cross-Claim patterns need something to cross; with a single Claim there is nothing to scan against yet |
| Unknown source IDs dropped | Parser guard | **Hallucination defense** — a candidate citing a Claim that doesn't exist is discarded rather than saved with a broken reference |
| Check has no day-count or overlap-percentage threshold | [Knowledge upkeep](/knowledge-layer)'s **Check** tab, **Stale** and **Redundant** issues | **Judged, not thresholded.** Stale requires the AI to name a specific newer page or note that supersedes the old one — elapsed time alone never triggers it. Redundant requires the two pages to assert the same specific claim, wording and granularity aside — topic overlap alone never triggers it |
| [Source check](/ai-grounding#source-check-does-the-source-actually-say-it) has no numeric limit of its own | The judge-call count shown before running a check | **Measured, not configured** — it's the number of sources involved, computed the same way as the Insight-discovery call count above, and can come out lower than shown once unreadable sources are skipped |
| No size cap on the text a source check re-reads | Re-reading a note, PDF, or Word file to check a citation | **Same as ingest** — ingest never caps note, PDF, or Word body length either, so source check reads exactly what ingest would have seen, not a truncated preview |
| Automatic source check is off by default and only calls the AI when it runs | [Auto-check sources](/ai-grounding#automatic-source-check) toggle in Settings | **Opt-in, not a background default.** Turning it on checks new/updated Claims and Topics one source at a time, same model call as a manual check — it never runs unless you switch it on |

If you ever see behavior that looks like a hidden filter and isn't explained by this table, that's a bug worth [reporting](https://github.com/kumagallium/Graphium/issues).

:::

::: details How do I tell whether it's Graphium or my model?

Run one controlled experiment: open [Settings](/settings) → **Knowledge** → **Discover Insights from Claims**, and note the result line — *created*, *reinforced*, and *covered n/m*. Full coverage with reinforcements but no new Insights means the pipeline looked at everything and your existing abstractions already cover the patterns present. Then assign a stronger **Insight model** and run it once more. If the stronger model creates Insights the smaller one didn't, the model was the bottleneck; if not, your Claims genuinely don't hold new recurring patterns yet — write more notes and let them converge.

:::

::: details What's the difference between Claims and Insights?

A **Claim** is one grounded assertion extracted from your notes; an **Insight** is a pattern that recurs across Claims. They form the narrow waist of the hourglass: notes → claims → insights. See the [Knowledge layer](/knowledge-layer) page for the full picture.

:::
