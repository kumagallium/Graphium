# Research before answering: does it help? <Badge type="info" text="Measured 2026-11-05 · v0.118.0" />

**Question.** In AI chat, [Research before answering](/ai-chat-and-ask#letting-the-ai-search-again) lets the AI search again, read whole pages and follow steps and lineage before it replies. Does that give better answers than the single search that always runs first? And is it safe to turn on by default?

**Short answer.** With Claude Opus 5 it helped a lot (+8 points out of 30) and added no made-up facts. With Copilot `gpt-5.6-luna` it also helped (+6), but on one question whose answer was not in the notes it stated a value that does not exist. With `gpt-oss-120b` it did not help, and it made things up more often. That is why the setting stays **off by default**.

## How I measured it

| | |
|---|---|
| Notes | A copy of my own working notes: 179 notes and about 1,350 knowledge pages. Because they are private, the questions and answers are not published here |
| Search | Words (BM25) plus meaning with `multilingual-e5-large` through an API. The desktop app's default embedding model is `bge-m3`, so the first search there may be a little stronger |
| Questions | 15, in six kinds: answer written in one place (3), different wording from the note (3), across 2–3 notes (3), a detail deep in a long page (2), steps and lineage (2), and the answer is not in the notes (2). 11 in Japanese, 4 in English |
| Conditions | Each question asked twice in a new chat, setting off and on, back to back. The order was swapped every other question |
| Models | Claude Opus 5, GitHub Copilot `gpt-5.6-luna`, `gpt-oss-120b` (an open-weight model through an OpenAI-compatible API) |
| Scoring | The two answers were shown as A and B, with the condition hidden. A separate AI grader checked each one against the source notes: 2 = complete, 1 = partly right, 0 = wrong or no answer. It also flagged made-up facts. For "not in the notes" questions, saying so clearly scores 2 |

## Results

| Model | Off | On | Made-up facts (off → on) | Time, median (max) | Input to the AI (estimate) |
|---|---|---|---|---|---|
| Claude Opus 5 | 20 / 30 | **28 / 30** | 0 → 0 | 13 s → 16 s (42 s) | about 2–3.5× |
| Copilot gpt-5.6-luna | 18 / 30 | **24 / 30** | 1 → 2 | 6 s → 7 s (32 s) | about 2–4× |
| gpt-oss-120b | 19 / 30 | 18 / 30 | 0 → 3 | 5 s → 6 s (15 s) | about 2–3.5× |

By kind of question (points, off → on):

| Kind | Claude | Copilot | gpt-oss |
|---|---|---|---|
| Written in one place | 6 → 6 | 6 → 6 | 6 → 6 |
| Different wording | 4 → 5 | 4 → 5 | 4 → 4 |
| Across notes | 3 → 5 | 2 → 6 | 3 → 4 |
| Detail deep in a page | 1 → 4 | 1 → 4 | 1 → 1 |
| Steps and lineage | 2 → 4 | 1 → 1 | 2 → 3 |
| Not in the notes | 4 → 4 | 4 → 2 | 3 → 0 |

## What I take from it

- **It helps where one search falls short.** Comparing notes and reading a detail deep in a long page improved with both Claude and Copilot. Following steps and lineage improved with Claude only. Questions that one search already answers did not change.
- **Some models get worse.** With `gpt-oss-120b`, three answers came back empty after the AI had used its tools. On questions whose answer is not in the notes, it stated numbers borrowed from other materials as if they were the answer. Copilot also dropped on those questions (4 → 2). Whether this comes from model size or from how a model handles tools, one model cannot tell.
- **It costs time and AI usage.** Replies took a few seconds longer in the middle and up to about 40 seconds at worst. The AI read about 2–4 times as much text, because every extra step sends the conversation again.

So the setting stays off by default. If you use a model like Claude Opus 5 and ask questions that span several notes, turning it on is worth it.

## Limits

- 15 questions is a small set. One question moves the total by up to 2 points, so read the totals as a trend.
- One run per question and condition. Answers vary from run to run.
- The notes are mine and lean toward materials research and AI papers.
- A local model (`qwen3.6-35b-a3b` in LM Studio) took 2–5 minutes per answer, so I stopped it after two questions. It is not in the results.

## Found along the way

- **Usage was under-counted.** For chats where the AI took several steps, the usage log recorded only the last step. The input estimates above are ranges worked out from the number of steps.
- **Opening a page needs its exact title.** 6 of 22 "read a page" calls found nothing. Some were titles the AI guessed; in other cases the exact title of an existing page also failed, for a reason not yet found.
