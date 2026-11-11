# Evaluations

Before I change how Graphium's AI works, or decide what is on by default, I measure it. This section keeps those measurements: what I wanted to know, how I measured it, what came out, and what I decided.

## Why these are public

- **So you can see why a default is what it is.** "Off by default" or "this model by default" is a choice. Here is what it rests on.
- **So I don't forget either.** A result I cannot find again cannot inform the next decision.
- **Graphium is about keeping where things came from.** A product that records provenance should show the evidence behind its own design.

## How I measure

| | |
|---|---|
| Compare like with like | The same questions or sources under each condition, back to back |
| Hide the condition | When an AI grades answers, it sees them as A / B without knowing which setting produced which |
| Check against the source | Answers and statements are judged against the original notes and documents, not against what sounds right |
| Date and version | Every page says when it was measured and on which version. Models and Graphium change; a new measurement gets a new page |
| Say the limits | Sets are small (9 tasks to 60 questions). Each page says how much a result can move, and what it was not tested on |

Most of these use my own working notes, so the questions and answers themselves are not published. Each page shows the totals, the method and the limits.

## The evaluations

| Measured | Question | Decision |
|---|---|---|
| 2026-11-11 | [Why the desktop app's window was using 5 GB twenty minutes after launch](/evaluations/search-index-memory) | The full-text index is stored packed into typed arrays. In a replay on the same engine, memory right after the restore went from about 4 GB to about 0.7 GB, and after 200 searches from about 4.6 GB to about 1.4 GB. In the real app with the fix, the web view went from 5.0–5.6 GB to 1.0–2.6 GB from one minute after launch |
| 2026-11-10 | [Do topics and insights reach the AI's answers?](/evaluations/what-reaches-the-ai) | The search and citation rules stay as they are. A question with a topic's title in it brought topics and one with a claim's title brought claims, and the form of the question made little difference. A target page that arrived was nearly always cited. Found and fixed a gap where packing stopped at a long section (it is now cut and retried, or skipped). The handling of sections that only list source names was measured again and stays as it is. The title list is not shrunk, and for Claude models it is now sent so that it can be read from the cache |
| 2026-11-10 | [Merging pages by thing: join, or summarize?](/evaluations/merging-pages-by-thing) | Grouping uses no AI: each page's body is joined as a section. In the 27-page group the AI merge kept about 30% of the source marks and 22 of 54 kinds of numbers with units in the same notation |
| 2026-11-10 | [Should topics be named after the thing itself?](/evaluations/topic-granularity) | New topics are named after the thing itself, only when a source is ingested; in a library with many "X's Y" pages the effect was not clear. Tidying up existing topics keeps the old rule |
| 2026-11-07 | [Which AI feature needs which size of model?](/evaluations/model-tiers-by-feature) | Insight, World grounding, and clean copy and summary use the default model when left empty. The default model's description is fixed, and each slot shows a model guide |
| 2026-11-06 | [Does the plan's grounding check catch planted mistakes?](/evaluations/plan-grounding-check) | Plan notes get a "Where this plan comes from" section. Claude and Copilot's gpt-5.6-luna caught every planted mistake (a small measurement). The hindsight check is on hold until its answer key is rebuilt |
| 2026-11-06 | [Where is procedure extraction weak? Measured again by meaning, and the links fixed](/evaluations/extraction-accuracy-by-meaning) | Score by meaning; the extraction instructions now ask to name hand-offs (links improve with Claude and Copilot) |
| 2026-11-06 | [How much of a paper's procedure comes out of the PDF, and how well do the names line up?](/evaluations/papers-to-procedures) | Name alignment runs by default and leans toward not merging; for steps, parameters and materials a merge that only drops a qualifier is rejected by rule |
| 2026-11-05 | [Why the desktop app ate 11 GB while tidying up](/evaluations/embedding-memory) | The embedding engine is pinned to ONNX Runtime 1.23 and embeds 8 sections at a time |
| 2026-11-05 | [Provenance tools: do they answer step and lineage questions?](/evaluations/provenance-tools) | Keep them in Research before answering. @ links are now connections without direction (v0.120.2) |
| 2026-11-05 | [Research before answering: does it help?](/evaluations/research-before-answering) | Off by default. Worth turning on with a model like Claude Opus 5 |
| 2026-10-27 | [Which embedding model finds the right passage?](/evaluations/embedding-models) | `bge-m3` on your computer by default (v0.99.0) |
| 2026-10-20 | [Can a small model on your own computer be the default AI?](/evaluations/local-models-as-default) | Not the default. One-button Copilot connection instead (v0.92.2) |
| 2026-09 | [Reading a long source in windows](/evaluations/long-sources) | Long sources are read in overlapping windows with a map (v0.80.0) |
