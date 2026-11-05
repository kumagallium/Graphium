# Which embedding model finds the right passage? <Badge type="info" text="Measured 2026-10-27 · v0.98" />

**Question.** Searching "by meaning" needs an embedding model. Until then Graphium used one through an API, so people who connected Claude or Copilot had no meaning search at all. Can a model that runs on your own computer replace it without losing quality, and which one?

**Short answer.** `bge-m3` on your computer came out first on every measure, ahead of the API model. Since [v0.99.0](/release-history) it is the default in the desktop app and downloads itself the first time it is needed.

## How I measured it

| | |
|---|---|
| Passages | My own knowledge pages: 2,375 pages split into 4,942 sections |
| Questions | 60, each with the section that answers it marked in advance. 42 in Japanese, 18 in English. About 4 in 10 are worded differently from the section |
| Method | Embed every section and every question, rank sections by similarity, and check where the right section lands |
| Scores | R@1 / R@5 / R@10: how often the right section is in the top 1 / 5 / 10. MRR@10: higher when it comes earlier. No AI grader is involved |

## Results

| Model | Where it runs | R@1 | R@5 | R@10 | MRR@10 | Japanese R@5 | English R@5 |
|---|---|---|---|---|---|---|---|
| multilingual-e5-large (as then used) | API | 0.27 | 0.55 | 0.68 | 0.38 | 0.64 | 0.33 |
| multilingual-e5-large, with prefixes | API | 0.28 | 0.60 | 0.75 | 0.42 | 0.67 | 0.44 |
| multilingual-e5-small | This computer | 0.33 | 0.50 | 0.65 | 0.41 | 0.57 | 0.33 |
| multilingual-e5-base | This computer | 0.18 | 0.57 | 0.67 | 0.31 | 0.64 | 0.39 |
| multilingual-e5-large | This computer | 0.25 | 0.60 | 0.77 | 0.40 | 0.64 | 0.50 |
| **bge-m3** | This computer | **0.42** | **0.68** | **0.83** | **0.54** | **0.69** | **0.67** |

Speed on an M1 Max under load:

| Model | Download | Sections per second | First index of 5,000 sections |
|---|---|---|---|
| e5-small | 135 MB | 55 | about 1.5 min |
| e5-base | 296 MB | 21 | about 4 min |
| e5-large | 579 MB | 7 | about 12 min |
| bge-m3 | 587 MB | 2 | about 39 min (see below) |

In this test `bge-m3` read up to 8,192 tokens per section. The app cuts each section at 512 tokens, which should bring its speed close to e5-large. Neither its speed nor its quality at 512 tokens was measured here.

## What I take from it

- **The model matters more than where it runs.** The same e5-large scored about the same on your computer and through the API.
- **bge-m3 came first, especially on English questions** (R@5 0.67 against 0.33–0.50). With only 18 English questions, that is a gap of a few questions, so read it as an order, not a size.
- **Everyone can search by meaning,** whichever chat model they connect.
- The cost is building the index the first time. The app fills it in the background after launch, and the model is downloaded only when first needed.

## Limits

- 60 questions is a small set: each score carries an uncertainty of about ±0.12. The order (bge-m3 first, then e5-large on either side, then e5-small) is readable; small gaps are not.
- Several pages repeat the same content (a claim, its topic, a summary), and only one section counts as right, so all scores run low. Compare them with each other, not with other benchmarks.
- The pages are mine and lean toward materials research and AI papers.
- The speed was measured once, on a fast machine that was busy at the time.
