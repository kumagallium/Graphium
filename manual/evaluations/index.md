# Evaluations

Before I change how Graphium's AI works, or decide what is on by default, I measure it. This section keeps those measurements: what I wanted to know, how I measured it, what came out, and what I decided.

## Where to look

| What you want to know | Where to look |
|---|---|
| What reasons lie behind the current settings and behavior | [What Graphium does now, and why](#what-graphium-does-now-and-why) (by feature) |
| Why a feature is missing or off by default | [Tried and not adopted](#tried-and-not-adopted) |
| What was measured, and when | [By date](#by-date) |

What goes here are the measurements that decided the app's defaults or behavior. One measurement is one page. If I measure again, it becomes a new page. Old pages are kept.

## What Graphium does now, and why

### Answers and search

| What it does now | What it rests on | Measurement |
|---|---|---|
| In the desktop app, `bge-m3` on your computer is the default embedding model for finding by meaning (v0.99.0) | I compared how often each model finds the right passage | [Embedding models](/evaluations/embedding-models) (2026-10-27) |
| **Research before answering** is off by default | The result split by model. With Claude Opus 5 the score rose by 8 points out of 30. With `gpt-oss-120b` the score did not rise and made-up facts increased | [Research before answering](/evaluations/research-before-answering) (2026-11-05) |
| The provenance tools stay inside "Research before answering". @ links are read as connections without direction (v0.120.2) | I checked whether they can answer questions about steps and lineage | [Provenance tools](/evaluations/provenance-tools) (2026-11-05) |
| The search and citation rules are unchanged. A gap where packing stopped at a long section is fixed | For questions with a topic's title in them, the topic's body reached the AI in 32 to 36 of 40 questions, and the form of the question made little difference (only questions that contain a title were measured). A targeted topic or insight was nearly always cited once it arrived | [What reaches the AI](/evaluations/what-reaches-the-ai) (2026-11-10) |
| Searching conversation text and making Knowledge stay as separate choices. Search results now say how to open a topic | I asked another AI about past conversations and checked its answers | [Asking another AI about past conversations](/evaluations/ai-conversation-recall) (2026-11-19) |
| Long sources are read in overlapping windows, with a map of the whole (v0.80.0) | I split long sources into windows and had them read | [Reading a long source in windows](/evaluations/long-sources) (2026-09) |

### Knowledge (claims, insights, topics)

| What it does now | What it rests on | Measurement |
|---|---|---|
| Claims go only as far as being split apart and readable without the note. The body gives the point first, then the note's record | With `gpt-5.6-luna`, outputs passing every criterion went from 4 to 10 of 20, and claims stretching beyond the note from 20% to 3%. With `gpt-oss-120b` the improvement was small | [Claims within the note](/evaluations/claim-scope) (2026-11-11) |
| One section is added to the claim instructions, only when the source is an AI conversation | Claims grounded only in the user's own words went from 69% to 85%. Run-to-run variation is large | [Insights from AI conversations](/evaluations/ai-conversation-claims) (2026-11-18) |
| The AI names the existing insight, and only claims that pass a separate call's check are added. Nothing is added if the check cannot be obtained | Closeness of wording is not used as an entry | [Reinforcing existing insights](/evaluations/insight-reinforcement) (2026-11-11) |
| In topic and Q&A revisions, each citation copies the passage of the source that the sentence restates. Before saving, each passage is checked against the source, and a passage that cannot be found is kept with a mark | With `gpt-oss-120b`, 72 of the 73 passages in the final instructions were found in the source. Output tokens grew 1.5 to 1.8 times | [Source passages behind sentences](/evaluations/sentence-passages) (2026-11-14) |
| Merging pages by thing uses no AI: each page's body is joined as a section | In the 27-page group, the AI merge left source marks at about 30% | [Merging pages by thing](/evaluations/merging-pages-by-thing) (2026-11-10) |
| New topics are named after the thing itself, only when a source is ingested | With no existing topics, "X's Y" titles went from 9% to 0% | [Topic granularity](/evaluations/topic-granularity) (2026-11-10) |

### Choosing a model

The model guide in Settings has been revised each time I measured again. Part of an older measurement's conclusion has been replaced by a later one. The table below is newest first, and where rows disagree, the upper row is what Graphium does now.

| What it does now | What it rests on | Measurement |
|---|---|---|
| The model on the lab workstation (one GPU) stays the 4-bit `gemma-4-31B-it`. If you lean on world grounding, another model fits better | It beat `gpt-oss-120b` (API) on 21 of 45 metrics and fell behind on 11. It was about level with gemma through an API. World grounding dropped to .40, and long tasks take more than 4 minutes per call | [gemma on a lab workstation](/evaluations/workstation-gemma) (2026-11-20) |
| For the light work tier, local ~30B is "conditional". The tier structure stays, and four features were moved (duplicate-insight judging and topic routing to Light, procedure extraction to Standard, translation to Advanced) | The two ~30B models measured on a computer were close to the reference point on only 3 and 4 of the 6 tasks. The differences between models showed up between checking work and writing work, not between tiers by difficulty | [Cloud and local models by feature](/evaluations/cloud-and-local-models-by-feature) (2026-11-14) |
| For the advanced work tier, open large models are "conditional" | For the three models of 100B and up, the intervals overlapped with the reference point on cross-checking work (such as checking grounds and matching names), and they were far from it on plan drafting and generalizing findings. Overlapping intervals do not prove there is no difference | [Open models by feature](/evaluations/open-models-by-feature) (2026-11-12) |
| For the standard work tier, open large models are "conditional" | When I measured making claims again on 20 notes, the spread inside this class was wide | [Claims within the note](/evaluations/claim-scope) (2026-11-11; the additional measurement is on 11-12) |
| AI work is split into three tiers (light, standard, advanced), and a model is chosen per tier. Each tier shows a model guide | The size of model needed differed clearly by feature | [Model size by feature](/evaluations/model-tiers-by-feature) (2026-11-07) |
| A small model on your own computer is not the default AI. Instead, GitHub Copilot connects with a single button (v0.92.2) | Of 9 small-model outputs, only 1 to 2 were good enough to show as they were | [A local model as the default](/evaluations/local-models-as-default) (2026-10-20) |

### Papers and plans

| What it does now | What it rests on | Measurement |
|---|---|---|
| Plan notes get a "Where this plan comes from" section | Claude and Copilot's `gpt-5.6-luna` caught every planted mistake (a small measurement) | [Checking where a plan comes from](/evaluations/plan-grounding-check) (2026-11-06) |
| Procedure extraction asks the AI to name what is handed from one step to the next | After I scored by meaning instead of exact match, the weak spots turned out to be the links between steps and the conditions | [Extraction accuracy by meaning](/evaluations/extraction-accuracy-by-meaning) (2026-11-06) |
| Name alignment leans toward not merging when unsure. For steps, parameters, materials and outputs, a merge that only drops a qualifier is rejected by rule | I checked how much of a paper's procedure comes out of the PDF and how well the names line up | [Procedures from papers](/evaluations/papers-to-procedures) (2026-11-06) |

### Importing images and data

| What it does now | What it rests on | Measurement |
|---|---|---|
| The desktop app reads images with PP-OCRv6 small (v0.142.0). On macOS, from the release after that, the OS's own reading is kept as well, for finding only | The old OCR found none of 160 handwritten phrases | [OCR engines](/evaluations/ocr-engines) (2026-11-18) |
| Data tables get no row limit | With synthetic data of 230,000 rows, the longest freeze before the import screen opened went from 16.3–17.1 seconds to 0.50–0.55 seconds | [Large data tables](/evaluations/large-data-tables) (2026-11-18) |

### Voice input

| What it does now | What it rests on | Measurement |
|---|---|---|
| Voice input passes the Latin-script terms (formulas, acronyms) from note titles and headings as a hint, space-separated, with Frequent terms at the end | With synthesized speech, Latin-script words spelled correctly went from 7 to 15 of 26, the same as giving the exact answers | [Hints for voice input](/evaluations/voice-input-hints) (2026-11-22) |

### Speed and memory

These are not measurements made to decide a setting. They are records of looking into the cause of a problem.

| What happened | What I changed | Measurement |
|---|---|---|
| Twenty minutes after launch, the desktop app's window was using 5 GB | The full-text index is now stored packed into typed arrays. In the build with the fix, 1.0–2.6 GB from one minute after launch (excluding the first launch, which rewrites the index; values after long use were not measured) | [Memory of the search index](/evaluations/search-index-memory) (2026-11-11) |
| "Tidy up automatically" made the desktop app use 11 GB | The embedding engine is pinned to `fastembed` 5.13.0 (which bundles ONNX Runtime 1.23) and embeds 8 sections at a time | [Memory while tidying up](/evaluations/embedding-memory) (2026-11-05) |

## Tried and not adopted

I also keep results that did not work out, points I could not settle, and points still not reached. These are pulled out of the measurements above.

| What I tried | What I found | Measurement |
|---|---|---|
| Making a small model on your own computer the default AI | Not the default. Of 9 small-model outputs, only 1 to 2 were good enough to show as they were | [A local model as the default](/evaluations/local-models-as-default) (2026-10-20) |
| Letting the AI merge bodies when merging pages by thing | Not adopted. Of 54 kinds of numbers with units, 22 stayed in the same notation | [Merging pages by thing](/evaluations/merging-pages-by-thing) |
| Using the "name it after the thing itself" rule when tidying up existing topics | It could not be used. Many titles had no page to merge into | [Topic granularity](/evaluations/topic-granularity) |
| Using the same rule in a library with many "X's Y" titles | Undecided. Six runs could not say whether it worked or not. The rule is still used when a source is imported | [Topic granularity](/evaluations/topic-granularity) |
| Reading handwritten sentences with OCR of the size that was adopted (PP-OCR, 22 to 180 MB) | Not reached. In handwriting it read dates and numbers but not sentences. The engine itself is adopted. Windows was not measured | [OCR engines](/evaluations/ocr-engines) |
| Checking a plan by hindsight | On hold until the answer key is rebuilt | [Checking where a plan comes from](/evaluations/plan-grounding-check) |
| Picking Japanese hint words for voice input from my notes | Not adopted. Frequent words did not help (8 → 9 of 26), and words that share characters with a misheard word were mostly unrelated. Japanese words are left to Frequent terms | [Hints for voice input](/evaluations/voice-input-hints) |

## How I measure

| | |
|---|---|
| Compare like with like | The same questions or sources under each condition, back to back |
| Hide the condition | When an AI grades answers, it sees them as A / B without knowing which setting produced which |
| Check against the source | Answers and statements are judged against the original notes and documents, not against what sounds right |
| Date and version | Every page says when it was measured and on which version. Models and Graphium change; a new measurement gets a new page |
| Say the limits | Sets are small (9 tasks to 60 questions). Each page says how much a result can move, and what it was not tested on |

Most of these use my own working notes, so the questions and answers themselves are not published. Each page shows the totals, the method and the limits.

## Why these are public

- **So you can see why a default is what it is.** "Off by default" or "this model by default" is a choice. Here is what it rests on.
- **So I don't forget either.** A result I cannot find again cannot inform the next decision.
- **Graphium is about keeping where things came from.** A product that records provenance should show the evidence behind its own design.

## By date

| Measured | Question | Area |
|---|---|---|
| 2026-11-22 | [Do hints from my own notes help voice input spell technical words?](/evaluations/voice-input-hints) | Voice input |
| 2026-11-20 | [Does gemma on one lab GPU keep the quality measured through an API?](/evaluations/workstation-gemma) | Choosing a model |
| 2026-11-19 | [Asking another AI about past conversations](/evaluations/ai-conversation-recall) | Answers and search |
| 2026-11-18 | [Insights from AI conversations](/evaluations/ai-conversation-claims) | Knowledge |
| 2026-11-18 | [Can a downloaded model read handwriting that the built-in OCR cannot?](/evaluations/ocr-engines) | Importing images and data |
| 2026-11-18 | [How long does the screen freeze when a 230,000-row CSV is imported?](/evaluations/large-data-tables) | Importing images and data |
| 2026-11-14 | [Keeping the source passage behind each topic sentence](/evaluations/sentence-passages) | Knowledge |
| 2026-11-14 | [Adding top cloud models and models on a computer, measured per AI feature](/evaluations/cloud-and-local-models-by-feature) | Choosing a model |
| 2026-11-12 | [How far can open models alone take each AI feature?](/evaluations/open-models-by-feature) | Choosing a model |
| 2026-11-11 | [Should claims generalize, or stay inside what the note supports?](/evaluations/claim-scope) | Knowledge |
| 2026-11-11 | [Do claims from other sources reach the insights that already exist?](/evaluations/insight-reinforcement) | Knowledge |
| 2026-11-11 | [Why the desktop app's window was using 5 GB twenty minutes after launch](/evaluations/search-index-memory) | Speed and memory |
| 2026-11-10 | [Do topics and insights reach the AI's answers?](/evaluations/what-reaches-the-ai) | Answers and search |
| 2026-11-10 | [Merging pages by thing: join, or summarize?](/evaluations/merging-pages-by-thing) | Knowledge |
| 2026-11-10 | [Should topics be named after the thing itself?](/evaluations/topic-granularity) | Knowledge |
| 2026-11-07 | [Which AI feature needs which size of model?](/evaluations/model-tiers-by-feature) | Choosing a model |
| 2026-11-06 | [Does the plan's grounding check catch planted mistakes?](/evaluations/plan-grounding-check) | Papers and plans |
| 2026-11-06 | [Where is procedure extraction weak? Measured again by meaning, and the links fixed](/evaluations/extraction-accuracy-by-meaning) | Papers and plans |
| 2026-11-06 | [How much of a paper's procedure comes out of the PDF, and how well do the names line up?](/evaluations/papers-to-procedures) | Papers and plans |
| 2026-11-05 | [Why the desktop app ate 11 GB while tidying up](/evaluations/embedding-memory) | Speed and memory |
| 2026-11-05 | [Provenance tools: do they answer step and lineage questions?](/evaluations/provenance-tools) | Answers and search |
| 2026-11-05 | [Research before answering: does it help?](/evaluations/research-before-answering) | Answers and search |
| 2026-10-27 | [Which embedding model finds the right passage?](/evaluations/embedding-models) | Answers and search |
| 2026-10-20 | [Can a small model on your own computer be the default AI?](/evaluations/local-models-as-default) | Choosing a model |
| 2026-09 | [Reading a long source in windows](/evaluations/long-sources) | Answers and search |
