# Can a small model on your own computer be the default AI? <Badge type="info" text="Measured 2026-10-20 · v0.90" />

**Question.** Setting up AI is the hardest step for someone who has never used it. If a small model that runs on your own computer were the default, AI would work from the first launch with no account and no key. Are 4B–8B models good enough for summarizing a meeting and turning notes into knowledge?

**Short answer.** Not yet. Only 1–2 of 9 small-model outputs were good enough to show as they were, and the main failure was making up numbers that were not in the source. Graphium's promise is that the AI can always point back to its sources, so I did not make a local model the default. Instead, connecting a GitHub Copilot account became a single button in [v0.92.2](/ai-setup), and **Run it on this computer** stays available for people who want it.

## How I measured it

| | |
|---|---|
| Machine | Apple M1 Max, 64 GB (about 3–4 times faster than a base M1–M3) |
| Models | On this computer through Ollama: `gemma3:4b`, `qwen3:4b`, `qwen3:8b`. For comparison: `gpt-oss-120b` through an API |
| Tasks | 9: summarize a meeting transcript (3), turn a note into knowledge (4), write a new topic page (2). The inputs were my own transcripts and notes |
| Scoring | The four outputs for each task were shown as A–D in random order, with model names hidden. An AI grader rated faithfulness, coverage and usefulness from 1 to 5, and said whether each output could be shown in the product as it was |

## Results

Outputs good enough to show as they were:

| Model | Meeting summary | Knowledge | Topic page | Total | Time, median (summary · knowledge · topic) |
|---|---|---|---|---|---|
| gpt-oss-120b (API) | 3 / 3 | 4 / 4 | 2 / 2 | **9 / 9** | 7 s · 13 s · 7 s |
| gemma3:4b | 0 / 3 | 0 / 4 | 1 / 2 | 1 / 9 | 36 s · 51 s · 20 s |
| qwen3:4b | 0 / 3 | 1 / 4 | 1 / 2 | 2 / 9 | 248 s · 141 s · 244 s |
| qwen3:8b | 1 / 3 | 0 / 4 | 1 / 2 | 2 / 9 | 171 s · 219 s · 123 s |

Faithfulness when turning notes into knowledge (1–5, average): gpt-oss-120b 4.2, gemma3:4b 3.0, qwen3:4b 2.8, qwen3:8b 1.8.

## What I take from it

- **The failures broke the core promise.** The small models wrote numbers into knowledge that the note did not contain (for a note that listed only a procedure, for example). They also kept too little (a single finding from a whole note), or treated a speech-recognition fragment as a decision.
- **They were also slow.** Even on a fast machine, the thinking models took 2–4 minutes per task.
- **What new users need is fewer steps, not a local model.** That led to the one-button Copilot connection instead.

## Limits

- One run per task and model, 9 tasks in total.
- The inputs were my own and lean toward materials research.
- **Scores from an AI grader are relative.** In a second round, the same `gpt-oss-120b` outputs were scored again next to stronger models, and dropped from 9 / 9 to 2 / 9. Compare models within one round only, never totals across rounds.
