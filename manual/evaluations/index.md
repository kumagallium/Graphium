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
| 2026-11-06 | [Does the plan's grounding check catch planted mistakes?](/evaluations/plan-grounding-check) | Plan notes get a "Where this plan comes from" section. Claude and Copilot's gpt-5.6-luna caught every planted mistake (a small measurement). The hindsight check is on hold until its answer key is rebuilt |
| 2026-11-06 | [Where is procedure extraction weak? Measured again by meaning, and the links fixed](/evaluations/extraction-accuracy-by-meaning) | Score by meaning; the extraction instructions now ask to name hand-offs (links improve with Claude and Copilot) |
| 2026-11-06 | [How much of a paper's procedure comes out of the PDF, and how well do the names line up?](/evaluations/papers-to-procedures) | Name alignment runs by default and leans toward not merging; for steps, parameters and materials a merge that only drops a qualifier is rejected by rule |
| 2026-11-05 | [Why the desktop app ate 11 GB while tidying up](/evaluations/embedding-memory) | The embedding engine is pinned to ONNX Runtime 1.23 and embeds 8 sections at a time |
| 2026-11-05 | [Provenance tools: do they answer step and lineage questions?](/evaluations/provenance-tools) | Keep them in Research before answering. @ links are now connections without direction (v0.120.2) |
| 2026-11-05 | [Research before answering: does it help?](/evaluations/research-before-answering) | Off by default. Worth turning on with a model like Claude Opus 5 |
| 2026-10-27 | [Which embedding model finds the right passage?](/evaluations/embedding-models) | `bge-m3` on your computer by default (v0.99.0) |
| 2026-10-20 | [Can a small model on your own computer be the default AI?](/evaluations/local-models-as-default) | Not the default. One-button Copilot connection instead (v0.92.2) |
| 2026-09 | [Reading a long source in windows](/evaluations/long-sources) | Long sources are read in overlapping windows with a map (v0.80.0) |
