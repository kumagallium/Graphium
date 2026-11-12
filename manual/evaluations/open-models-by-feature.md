# How far can open models alone take each AI feature? <Badge type="info" text="Measured 2026-11-12 · v0.129" />

**What I wanted to know.** The [previous measurement](/evaluations/model-tiers-by-feature) ran each task on 1 to 16 items, once, and one item could swap the ranking. Of the open models, it measured only one through an API (`gpt-oss-120b`). So I increased the items and the runs, fixed the grading procedure first, and measured 9 open models again on the same 18 tasks. What I wanted to know was how far open models can cover the features without a top cloud model.

**In short.** If you pick the model per task, on 13 of the 18 tasks the best model scored at least 90% of the reference point's (`gpt-5.6-luna`) score.

- **The 13 tasks** are chat answers, source checks, topic merging, checks, titles, world grounding, topic sorting, translation, procedures from papers, name alignment, the plan's grounding check, duplicate detection and summaries. In all of them the reference point scored .70 or higher.
- **The other 5 tasks had a reference point of .60 or lower too.** For topic revision and clean copy, the best model was just under 90% of the reference point. For drafting a plan from an answer and generalizing findings, it was under half. For making Knowledge, no model could be compared: every model, including the reference point, scored .25 or lower.
- **Models of the same size differed a lot.** Of three ~30B models, one was near the top on many tasks. Another, in name alignment, merged 9 in 10 of the pairs that must not be merged.
- **Two models of ~4B and below fell short on almost every task.** Another (`llm-jp-3.1-8x13b-instruct4`) often could not return a response of the required form, so there were almost no outputs that could be graded.

"At least 90%" is a ratio of averages, and it is not proof of no difference (see "Limits" below).

Based on this, in the model guide in Settings, I changed two classes in the Advanced work and Voice note rows from "poor fit" to "conditional".

## How I measured it

| | |
|---|---|
| Version measured | One commit after v0.129.11 on main. I called the app's server endpoints directly |
| Reference point | Copilot's `gpt-5.6-luna` (once only) |
| Open models | `gpt-oss-120b`, `Weblab-MedLLM-gpt-oss-120b`, `Kimi-K2.7-Code`, `Qwen3.6-35B-A3B`, `gemma-4-31B-it`, `Qwen3-VL-30B-A3B-Instruct`, `llm-jp-3.1-8x13b-instruct4`, `Phi-4-mini-instruct-cpu`, `Qwen3-0.6B-cpu`. All through an OpenAI-compatible API, 3 runs each |
| Inputs | Made-up material (records of home curry and bread making). Translation and procedures from papers go from English to Japanese. No real notes were used |
| Items | 6 to 60 per task (table below). 251 calls for the reference point, 753 per model for the others |
| Timeout | A call was cut off after 10 minutes and counted as a failure |
| Failures on the measuring side | Connection failures and rate limits were not counted as model failures and were re-run. After re-running, 0 items were left unmeasured |

**Grading.** The 8 tasks with a correct answer (tasks that plant mistakes and count how many were caught, and tasks where the pairs to merge are fixed) were graded automatically. Clean copy was also counted automatically, by whether planted mishearings were corrected.

The remaining generation tasks (chat answers, titles, translation, making Knowledge, topic revision, generalizing findings, plan drafting, summaries and procedures from papers) were graded separately by two AI graders: Claude Sonnet and one of Copilot's GPT-family models (neither was a model being measured). The graders were not told which model an output came from.

- For the 7 tasks other than summaries and procedures from papers, I fixed 3 to 5 criteria per task and marked each as pass or fail. Only outputs that passed all of them count as "can be shown as they are".
- Some outputs get split verdicts from the two graders, so pass rates are given as a range. The **lower bound** is both graders passing; the **upper bound** is either grader passing.
- For summaries and procedures from papers, the grader compared each output against the correct answer one item at a time, and recall and F1 were calculated from that. The F1 for procedures from papers is the Claude grader's value (the GPT grader's differed by .01 or less).
- I graded all items of the first run and the first 5 items of the second and third runs: 1,883 outputs in all.

**Checking against a person.** To check whether the graders are right, I marked 30 outputs (139 verdicts) myself, without looking at the graders' verdicts. I chose the 30 from the outputs of the 3 models measured first (`gpt-5.6-luna`, `gpt-oss-120b` and `Qwen3.6-35B-A3B`). The grading of the 7 models measured later was not checked by a person.

| | Claude grader | GPT grader |
|---|---|---|
| Agreement on per-criterion verdicts (139, without looking) | 79.1% | 77.0% |
| Agreement on "can be shown as it is" (30 outputs, without looking) | 18 of 30 | 17 of 30 |
| Agreement on per-criterion verdicts (after re-marking with the graders' reasons read) | 92.7% | 90.5% |
| Agreement on "can be shown as it is" (after re-marking) | 25 of 30 | 22 of 30 |

- The chance-corrected measure (kappa) for the verdicts made without looking was 0.23 and 0.30. It reads lower than the agreement rate suggests, because many criteria are mostly passes.
- For the 21 verdicts where both graders disagreed with me, I re-marked them while reading the graders' reasons. In 17 the graders were right, and 13 of those were my oversights. 2 were graders' oversights and 2 had vague criteria. The agreement after re-marking excludes the 2 vague ones.
- Re-marking happened after seeing the graders' reasons, so it is not independent. The main figures are those from the verdicts made without looking.
- Where both graders agreed, I matched them on 116 of 118 verdicts (excluding the 2 vague ones) after re-marking. On the 19 where they split, I sided with Claude on 11 and with GPT on 8, so I could not say either was right. This is why I read the results as a range.

## Results

For tasks graded by AI, values are "lower bound to upper bound". Row colors show the tier each task runs on (<span class="tier tier-light">Light</span> <span class="tier tier-standard">Standard</span> <span class="tier tier-advanced">Advanced</span>).

Column names are shortened: oss = `gpt-oss-120b`, Weblab = `Weblab-MedLLM-gpt-oss-120b`, Kimi = `Kimi-K2.7-Code`, Q3.6 = `Qwen3.6-35B-A3B`, gemma = `gemma-4-31B-it`, QVL = `Qwen3-VL-30B-A3B-Instruct`, llm-jp = `llm-jp-3.1-8x13b-instruct4`, Phi = `Phi-4-mini-instruct-cpu`, Q0.6 = `Qwen3-0.6B-cpu`.

| Tier | Task (items) and measure | luna | oss | Weblab | Kimi | Q3.6 | gemma | QVL | llm-jp | Phi | Q0.6 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| <span class="tier tier-light">Light</span> | Answers (30) can be shown | .97-1.00 | .84-.91 | .83-.90 | .93-.98 | .87-.97 | .97-1.00 | .83-.90 | .52-.61 | .40-.41 | .24-.28 |
| <span class="tier tier-light">Light</span> | Source checks (24) detection rate | .96 | .97 | .86 | .96 | .99 | .97 | .76 | .00 | .22 | .03 |
| <span class="tier tier-light">Light</span> | Topic merging (24) recall | 1.00 | .82 | .81 | .97 | .85 | 1.00 | .71 | .00 | .18 | .24 |
| <span class="tier tier-light">Light</span> | Checks (24) detection rate | .75 | .58 | .56 | .63 | .74 | .88 | .42 | .00 | .00 | .08 |
| <span class="tier tier-light">Light</span> | Titles (20) can be shown | 1.00 | .90-.92 | .80-.85 | 1.00 | .83-.93 | .85-1.00 | .73-.75 | .00 | .12-.15 | .35-.43 |
| <span class="tier tier-light">Light</span> | World grounding (20) detection rate | .70 | .68 | .67 | .75 | .65 | .75 | .62 | .00 | .07 | .00 |
| <span class="tier tier-standard">Standard</span> | Making Knowledge (20) can be shown | .10-.20 | .05-.22 | .07-.18 | .05-.18 | .00 | .05-.23 | .17-.25 | .00 | .00 | .00-.12 |
| <span class="tier tier-standard">Standard</span> | Translation (12) can be shown | .83-.92 | .25-.58 | .19-.25 | .78-.89 | .31-.39 | .58 | .08-.28 | .00 | .00 | .00 |
| <span class="tier tier-standard">Standard</span> | Topic sorting (20) pass rate | .90 | .87 | .92 | .97 | .83 | .95 | .25 | .00 | .18 | .13 |
| <span class="tier tier-standard">Standard</span> | Topic revision (20) can be shown | .50-.65 | .38-.50 | .30-.45 | .43-.58 | .37-.43 | .40 | .33-.37 | .00 | .00 | .00 |
| <span class="tier tier-advanced">Advanced</span> | Procedures from papers (7) step F1 | .89 | .87 | .84 | .76 | .79 | .88 | .88 | .00 | .00 | .00 |
| <span class="tier tier-advanced">Advanced</span> | Procedures from papers (7) attribute-value F1 | .53 | .40 | .54 | .62 | .53 | .57 | .45 | .00 | .00 | .00 |
| <span class="tier tier-advanced">Advanced</span> | Name alignment (30) recall | .93 | .82 | .79 | .96 | .98 | .80 | .93 | .00 | .09 | .53 |
| <span class="tier tier-advanced">Advanced</span> | Name alignment (30) rate of wrong merges ↓ | .00 | .00 | .00 | .00 | .01 | .09 | .91 | .00 ¹ | .08 | .32 |
| <span class="tier tier-advanced">Advanced</span> | Plan's grounding check (24) detection rate | .88 | .71 | .75 | .90 | .75 | .83 | .32 | .00 | .00 | .01 |
| <span class="tier tier-advanced">Advanced</span> | Plan from an answer (10) can be shown | .50 | .00 | .10 | .03 | .00 | .07-.27 | .00 | .00 | .00 | .00-.03 |
| <span class="tier tier-advanced">Advanced</span> | Generalizing findings (20) can be shown | .30-.50 | .10 | .05 | .00-.05 | .00-.07 | .05-.15 | .00 | .00 | .00 | .10 ² |
| <span class="tier tier-advanced">Advanced</span> | Duplicate detection (36) accuracy | 1.00 | .98 | .98 | 1.00 | 1.00 | 1.00 | .89 | .00 | .62 | .33 |
| <span class="tier tier-advanced">Advanced</span> | Clean copy (60 places) correction rate | .60 | .27 | .18 | .36 | .39 | .52 | .17 | .00 | .00 | .00 |
| <span class="tier tier-advanced">Advanced</span> | Clean copy: rate of changing what was said ↓ | .12 | .04 | .04 | .07 | .13 | .18 | .03 | - ³ | .81 | .47 |
| <span class="tier tier-advanced">Advanced</span> | Summary (6) recall of decisions | .75 | .71 | .55 | .87 | .69 | .73 | .65 | .00 | .08 | .00 |
| <span class="tier tier-advanced">Advanced</span> | Summary: items not in the meeting ↓ | 0.2 | 1.6-2.0 | 1.3-1.9 | 0.8-1.1 | 1.1-1.6 | 0.3-0.6 | 2.4-3.8 | - ³ | 5.8-6.0 | 1.8-2.3 |

↓ marks measures where lower is better. "Rate of wrong merges" is the share of the 30 pairs that must not be merged which the model merged. "Items not in the meeting" is the number per meeting, with the values from each of the two graders side by side.

1. `llm-jp-3.1-8x13b-instruct4` almost never returned a response of the right form, so there were no merges at all.
2. For inputs with nothing to generalize, an empty output is the correct answer. The .10 for `Qwen3-0.6B-cpu` is the share where that empty output happened to be right.
3. There was not a single output that could be graded.

**Failed calls.** Of the 753 calls, the number that failed because of a wrong format, not fitting in the window, a response that could not be read, or a timeout.

| Model | Format | Did not fit the window | Unreadable response | Timeout |
|---|---|---|---|---|
| `gemma-4-31B-it` | 2 | 0 | 0 | 0 |
| `Qwen3.6-35B-A3B` | 9 | 0 | 0 | 1 |
| `gpt-oss-120b` | 11 | 0 | 0 | 0 |
| `Weblab-MedLLM-gpt-oss-120b` | 11 | 5 | 0 | 0 |
| `Qwen3-VL-30B-A3B-Instruct` | 4 | 0 | 5 | 1 |
| `Kimi-K2.7-Code` | 0 | 0 | 0 | 19 |
| `Qwen3-0.6B-cpu` | 41 | 0 | 11 | 6 |
| `Phi-4-mini-instruct-cpu` | 78 | 221 | 0 | 10 |
| `llm-jp-3.1-8x13b-instruct4` | 399 | 30 | 57 | 3 |

The reference point, `gpt-5.6-luna`, had 0 failures in 251 calls.

## What I found

Below, "the six models of ~30B and up" means oss, Weblab, Kimi, Q3.6, gemma and QVL.

- **Light work depends on the task and the model.** For answers, source checks and world grounding, all six models of ~30B and up had 95% intervals overlapping the reference point's. For topic merging, titles and checks, it splits by model. The intervals overlapped on all 6 tasks for `gemma-4-31B-it` and `Kimi-K2.7-Code`, and on 3 tasks for `Qwen3-VL-30B-A3B-Instruct`. On checks, `gemma-4-31B-it` scored .88 against the reference point's .75 (the intervals overlap).
- **Work that cross-checks was also covered in advanced work.** For procedures from papers, name alignment, the plan's grounding check and duplicate detection, 5 of the six models of ~30B and up had intervals overlapping the reference point's. Last time `gpt-oss-120b` broke down on procedure links, but this time its step F1 was .87. The scoring measure and the inputs differ, so this cannot be called an improvement over last time.
- **Work that writes from nothing showed a wide gap.** For drafting a plan from an answer, the reference point was .50 and the six models of ~30B and up were .00-.27. For generalizing findings, .30-.50 against .00-.15. But with only 10 and 20 items and a reference point of a single run, the intervals overlap for some models (1 for plan drafting, 3 for generalizing findings).
- **Making Knowledge was .10-.20 even at the reference point.** This time's criteria count an output as "can be shown as it is" only if it passes all 5, so it is not the same yardstick as the previous "4 of 5". This measurement cannot separate whether every model falls short or the criteria are too strict.
- **Translation split widely by model.** `Kimi-K2.7-Code` was .78-.89, close to the reference point (.83-.92), `gemma-4-31B-it` was .58, and the other 4 of the six models of ~30B and up were .08-.58.
- **Even the reference point corrected only 6 in 10 of the 60 places in clean copy.** The six models of ~30B and up were .17-.52. The rate of changing what was said was .03-.18, not much different from the reference point (.12). A model that corrects little also changes little.
- **Summaries picked up the decisions, but many models added items not in the meeting.** Recall for the six models of ~30B and up was .55-.87, against .75 for the reference point. Items not in the meeting were 0.3-3.8 per meeting, against 0.2 for the reference point.
- **Models of the same size differed.** Among the three ~30B models, `gemma-4-31B-it` was .52 on clean copy and `Qwen3-VL-30B-A3B-Instruct` .17. In name alignment, `Qwen3-VL-30B-A3B-Instruct` merged 93% of the pairs that should be merged, but also 91% of the pairs that must not be merged. It was also .25 on topic sorting. The size class is only a rough guide.
- **Two models of ~4B and below fell short.** `Phi-4-mini-instruct-cpu` has a 4,096-token window, and 221 calls on long-input tasks did not fit. `Qwen3-0.6B-cpu` scored .24-.28 on answers.
- **`llm-jp-3.1-8x13b-instruct4` fell short on form rather than size.** On tasks that ask for JSON, 399 of 753 calls returned a response of the wrong form, and it was close to 0 on the automatically graded tasks. On answers, which are written in prose, it scored .52-.61.
- **World grounding is read by detection rate.** Looking only at the rate of calling a correct statement correct, `Qwen3-0.6B-cpu`, which flags nothing, got a perfect score.

## Limits

- **The reference point is a single run.** The other models had 3 runs, so the reference point's values swing more. When comparing by whether the 95% intervals overlap, the reference point's interval is wide, so on all 18 tasks some model came out as "overlapping". So I counted the 13 tasks in "In short" by whether the average was at least 90% of the reference point's (for AI-graded tasks, lower bound against lower bound). This is a ratio of averages. It proves neither that there is no difference nor that there is one.
- **I measured only one top cloud model.** Last time I also measured Claude Opus 5, but this time the reference point is only `gpt-5.6-luna`.
- **"Best" was chosen and reported in the same measurement.** It is the value of the best model per task, so it reads a little generous.
- **Some tasks have few items.** Summaries have 6, procedures from papers 7, plan drafting 10 and translation 12. For translation, the interval for `Kimi-K2.7-Code`'s lower bound is .58-.94 against the reference point's .58-1.00, so I cannot rank them.
- **I rewrote the grading criteria once after seeing the first grading.** I measured in stages, and the first run of the first 3 models showed a large split between the two graders. There were two causes: a bug where the common instructions were not passed to the GPT-side grader, and criteria worded so that they could be read two ways. I fixed both and graded again. Because this was a rewrite after seeing results, the rise in agreement between the two graders is not evidence that the criteria are right. After that, I fixed the criteria, inputs and instructions to the graders and measured the remaining 7 models.
- **I also fixed the automatic grading after measuring the first 3 models.** I read the outputs that failed and corrected 8 grading mistakes. The inputs to the models did not change, but the fixes include corrections to the answer data (one each in topic merging, topic sorting and making Knowledge) and to measure definitions (clean copy's "rate of changing", the rate of wrong flags in source checks, and topic sorting). I read only the outputs of the first 3 models.
- **Agreement with a person fell short of the line I had set (80%).** Agreement with verdicts made without looking was 79.1% and 77.0% per criterion, and 18 and 17 of 30 on "can be shown as it is". Most disagreements were my oversights, so I did not rewrite the criteria and chose to read pass rates as a range. The 30 outputs I checked were chosen with nearly half of them being ones where the graders split, so they lean harder than the whole.
- **The inputs are made-up records written by Claude Sonnet, and the subject is cooking.** Results may differ for research notes. The answer key for procedures from papers was built from the previous extraction (which included Claude).
- **I did not compare time.** It changes with how busy the API is. `Kimi-K2.7-Code` has strict rate limits, and when four groups of tasks ran at once, 136 calls were rejected (I filled them by re-running). Tasks that make many calls in a row will have waits.
- **I did not measure running on a computer.** The three ~30B models also went through an API. Running a quantized version in LM Studio or similar changes both quality and speed. I did not measure ~10B-class models this time.
- **World grounding depends on search results.** For 6 of the 9 models, 1 to 3 calls were cut off at 10 minutes.
- Embedding models and speech recognition models were not included.

## What I decided

- I changed 4 places in the model guide in [Settings](/settings). In the **Advanced work** and **Voice note** rows, I moved open large and local ~30B from "poor fit" to "conditional".
- I gave "conditional" where only some of the tasks in that tier come close to the reference point, or where models in the same class split. In Advanced work, the tasks that cross-check (extracting procedures, name alignment, grounding checks, duplicate detection) came close to the reference point, while plan drafting and generalizing findings were far off. In Voice notes, recall on summaries came close to the reference point, while the correction rate on clean copy was, for the best model, just under 90% of the reference point.
- I also changed the text under the guide. For Advanced work it is now "Open models can be enough for extracting procedures and checking sources. Drafting plans and finding insights suit a strong model."
- I did not change the guide for the Light and Standard tiers. I did not change the ~10B guide either, because I did not measure it this time.
- The "conditional" for local ~30B comes from results measuring same-size models through an API. It is not a value checked on a computer.
- I did not change the default models or which tier each feature is assigned to.
