# Adding top cloud models and models on a computer, measured per AI feature <Badge type="info" text="Measured 2026-11-14 · v0.129" />

**What I wanted to know.** The [previous measurement](/evaluations/open-models-by-feature) measured 9 open models through an API. The reference point (the model used as the yardstick), `gpt-5.6-luna`, ran only once. I did not measure any model running on a computer.

So this time I added 5 more, on the same 18 tasks, the same inputs and the same grading procedure.

- 2 top cloud models (I raised `gpt-5.6-luna` to 3 runs, and ran `gpt-6.1-sol` 3 times)
- 3 models on a computer (LM Studio): `gemma-4-31b-qat`, `qwen3.6-35b-a3b` and `qwen3.5-9b`, once each

I wanted to know two things. One is the remaining cells of the model guide in Settings (local ~30B and ~10B). The other is whether the 3 tiers, split by difficulty, are still useful.

**In short.** In every one of the 3 tiers, many models came out "close to the reference point on only some tasks". So the per-tier guide showed no difference. The clear difference was between **checking work** and **writing work**.

- **Checking work** (source checks, checks, name alignment, duplicate detection and so on): many open models were close to the reference point.
- **Writing work** (answers, translation, making Knowledge, generalizing findings, summaries, clean copy and so on): models differed a lot.
- **A ~30B model on a computer is enough for source checks and titles.** But on tasks with long inputs, calls did not finish in 10 minutes, or scored lower than through an API.
- **A ~10B model fell short on most writing work.**

Based on this, I changed just 1 place in the model guide in Settings. In the Light work tier, I moved local ~30B from "good fit" to "conditional".

## How I measured it

| | |
|---|---|
| Version measured | One commit after v0.129.11 on main (same as last time). I called the app's server endpoints directly, not through the app screen |
| Reference point | Copilot's `gpt-5.6-luna`. I did not use last time's single run, and ran it 3 times again |
| Top cloud | Copilot's `gpt-6.1-sol` (3 runs) |
| On a computer | LM Studio's `google/gemma-4-31b-qat`, `qwen/qwen3.6-35b-a3b` and `qwen3.5-9b` (once each). Apple M1 Max, 64 GB of memory. One model loaded at a time, a window (how much it can read at once) of 65,536 tokens, 1 call at a time |
| Inputs and items | Same as last time. Made-up material (records of home curry and bread making), 6 to 60 items per task |
| Timeout | A call was cut off after 10 minutes and counted as a failure |
| Grading | Same as last time. Two AI graders (Claude Sonnet and one of Copilot's GPT-family models) graded separately. 833 outputs were added this time, and after re-running, 0 gradings had a response of the wrong form from either grader |

I used last time's values for the 9 models as they are. Only the reference point in the table is replaced with this time's 3 runs.

## Reading the metrics

Every value is a ratio from 0 to 1, and for most of them **larger is better**. Only the rows marked ↓ are measures where **smaller is better**. "Items not in the meeting" is not a ratio. It is the number per meeting.

| Term in the table | What the ratio is of |
|---|---|
| Passed every criterion | The share of outputs where the AI graders marked a pass on all of the 3 to 5 criteria fixed for the task. Last time this was called "can be shown". The ".83-.94" range runs from both graders passing (lower bound) to either grader passing (upper bound) |
| Share of criteria passed | For one output, the share of the criteria it passed. It is the average of the two graders. Outputs that are missing, for example from a timeout, count as 0 |
| Detection rate, recall | Of the mistakes or pairs that should be found, the share found |
| Accuracy, pass rate | The share that matched the correct answer |
| F1 | A value that looks at both missed items and extra extractions |
| Correction rate | Of the planted mishearings, the share corrected |

**On the rows where "passed every criterion" is low for every model.** For making Knowledge and generalizing findings, one output holds 10 to 20 claims. If even one of them misses a criterion, the whole output fails. So every model except `gpt-6.1-sol` came out with a lower bound of about .25 or lower, and the differences were hidden. These are the rows where the previous page said "this measurement cannot separate whether every model falls short or the criteria are too strict".

So this time I added "share of criteria passed" for these 2 tasks and for topic revision, and I used it for the guide's verdict. For the top cloud models, making Knowledge is .71-.86, so the task itself is done. There are just few outputs where all criteria line up. I added this measure after seeing the results.

## Results

For "passed every criterion", graded by AI, values are "lower bound to upper bound". Row colors show the tier each task runs on (<span class="tier tier-light">Light</span> <span class="tier tier-standard">Standard</span> <span class="tier tier-advanced">Advanced</span>).

Column names are shortened: luna = `gpt-5.6-luna` (reference point), sol = `gpt-6.1-sol`, gemma = `gemma-4-31B-it`, Q3.6 = `Qwen3.6-35B-A3B`, Q3.5 = `qwen3.5-9b`. "API" is the value measured through an API last time (3 runs). "Local" is the value measured on a computer this time (1 run). For gemma and Q3.6, the API and local versions have the same weights by name, but the local ones are quantized.

| Tier | Task (items) and measure | luna | sol | gemma API | gemma local | Q3.6 API | Q3.6 local | Q3.5 local |
|---|---|---|---|---|---|---|---|---|
| <span class="tier tier-light">Light</span> | Answers (30) passed every criterion | .99-1.00 | 1.00 | .97-1.00 | 1.00 | .87-.97 | .87-.90 | .83-.90 |
| <span class="tier tier-light">Light</span> | Source checks (24) detection rate | .97 | 1.00 | .97 | 1.00 | .99 | .92 | 1.00 |
| <span class="tier tier-light">Light</span> | Topic merging (24) recall | 1.00 | 1.00 | 1.00 | .67 | .85 | .83 | .83 |
| <span class="tier tier-light">Light</span> | Checks (24) detection rate | .76 | .82 | .88 | .00 ¹ | .74 | .71 | .42 |
| <span class="tier tier-light">Light</span> | Titles (20) passed every criterion | .90-.95 | 1.00 | .85-1.00 | .95-1.00 | .83-.93 | .85-.90 | .75-.85 |
| <span class="tier tier-light">Light</span> | World grounding (20) detection rate | .68 | .67 | .75 | .35 | .65 | .70 | .40 |
| <span class="tier tier-standard">Standard</span> | Making Knowledge (20) share of criteria passed | .71 | .86 | .67 | .56 | .60 | .70 | .62 |
| <span class="tier tier-standard">Standard</span> | Making Knowledge: passed every criterion | .08-.22 | .15-.57 | .05-.23 | .10-.25 | .00 | .00-.15 | .10-.15 |
| <span class="tier tier-standard">Standard</span> | Translation (12) passed every criterion | .83-.94 | 1.00 | .58 | .83-.92 | .31-.39 | .08-.17 | .08-.17 |
| <span class="tier tier-standard">Standard</span> | Topic sorting (20) pass rate | .87 | .95 | .95 | .95 | .83 | .50 | .90 |
| <span class="tier tier-standard">Standard</span> | Topic revision (20) share of criteria passed | .89 | .92 | .86 | .74 | .82 | .61 | .69 |
| <span class="tier tier-standard">Standard</span> | Topic revision: passed every criterion | .40-.55 | .53-.67 | .40 | .35-.50 | .37-.43 | .10-.15 | .20-.35 |
| <span class="tier tier-advanced">Advanced</span> | Procedures from papers (7) step F1 | .89 | .88 | .88 | .00 ¹ | .79 | .89 | .67 |
| <span class="tier tier-advanced">Advanced</span> | Procedures from papers (7) attribute-value F1 | .54 | .70 | .57 | .00 ¹ | .53 | .49 | .48 |
| <span class="tier tier-advanced">Advanced</span> | Name alignment (30) recall | .96 | 1.00 | .80 | 1.00 | .98 | .77 | .83 |
| <span class="tier tier-advanced">Advanced</span> | Name alignment (30) rate of wrong merges ↓ | .01 | .00 | .09 | .00 | .01 | .47 | .00 |
| <span class="tier tier-advanced">Advanced</span> | Plan's grounding check (24) detection rate | .85 | .96 | .83 | .42 | .75 | .46 | .63 |
| <span class="tier tier-advanced">Advanced</span> | Plan from an answer (10) passed every criterion | .50-.63 | .17-.43 | .07-.27 | .00-.10 ¹ | .00 | .00 | .00-.10 |
| <span class="tier tier-advanced">Advanced</span> | Generalizing findings (20) share of criteria passed | .78 | .91 | .73 | .26 | .62 | .57 | .04 ¹ |
| <span class="tier tier-advanced">Advanced</span> | Generalizing findings: passed every criterion | .25-.28 | .48-.83 | .05-.15 | .00-.20 | .00-.07 | .00 | .00 ¹ |
| <span class="tier tier-advanced">Advanced</span> | Duplicate detection (36) accuracy | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | .97 | 1.00 |
| <span class="tier tier-advanced">Advanced</span> | Clean copy (60 places) correction rate | .66 | .58 | .52 | .00 ¹ | .39 | .32 | .00 ¹ |
| <span class="tier tier-advanced">Advanced</span> | Clean copy: rate of changing what was said ↓ | .19 | .05 | .18 | - ² | .13 | .18 | .00 ³ |
| <span class="tier tier-advanced">Advanced</span> | Summary (6) recall of decisions | .80 | .98 | .73 | .78 | .69 | .67 | .72 |
| <span class="tier tier-advanced">Advanced</span> | Summary: items not in the meeting ↓ | 0.3 | 0.2 | 0.3-0.6 | 0.8-1.0 | 1.1-1.6 | 1.0-2.0 | 0.7-1.3 |

"Rate of wrong merges" is the share of the 30 pairs that must not be merged which the model merged. "Items not in the meeting" shows the values from each of the two graders side by side.

1. All or almost all calls timed out at 10 minutes (see the table below).
2. There was not a single output that could be graded.
3. This is the value of only the 1 call (of 6) that did not time out. It corrected almost nothing, so its rate of changing what was said also reads low.

**Failed calls.** The 3 models on a computer were called 251 times each, and the 2 cloud models 753 times each.

| Model | Time per call (median) | Timeouts | Format | Tasks with many timeouts |
|---|---|---|---|---|
| `gpt-5.6-luna` | 23 s | 2 | 0 | - |
| `gpt-6.1-sol` | 24 s | 0 | 0 | - |
| `gemma-4-31b-qat` (local) | 264 s | 57 | 1 | generalizing findings 14 of 20, plan drafting 9 of 10, procedures from papers 7 of 7, clean copy 6 of 6, checks 6 of 6, making Knowledge 6 of 20, grounding check 5 of 8, topic revision 3 of 20, topic merging 1 of 3 |
| `qwen3.6-35b-a3b` (local) | 11 s | 0 | 0 | - |
| `qwen3.5-9b` (local) | 208 s | 41 | 1 | generalizing findings 19 of 20, translation 7 of 12, clean copy 5 of 6 |

## Checking work and writing work

I split the measures of the 18 tasks into two groups and counted them. Each group has 10 measures. The count is how many had an average of at least 90% of the reference point's (for ↓ measures, at most the reference point ÷ 0.9).

- **Checking work**: source checks, topic merging, checks, world grounding, topic sorting, the plan's grounding check, name alignment (recall and rate of wrong merges), duplicate detection, and steps from papers
- **Writing work** (summaries count as 2 metrics): answers, titles, making Knowledge, translation, topic revision, generalizing findings, plan drafting, summaries (recall and items not in the meeting), and clean copy's correction rate

| Model | Checking work | Writing work |
|---|---|---|
| `gpt-6.1-sol` | 10 | 8 |
| `gemma-4-31B-it` (API) | 8 | 6 |
| `Kimi-K2.7-Code` (API) | 8 | 6 |
| `Qwen3.6-35B-A3B` (API) | 7 | 2 |
| `gpt-oss-120b` (API) | 6 | 3 |
| `Weblab-MedLLM-gpt-oss-120b` (API) | 5 | 1 |
| `gemma-4-31b-qat` (local) | 5 | 4 |
| `qwen3.6-35b-a3b` (local) | 5 | 2 |
| `qwen3.5-9b` (local) | 4 | 1 |
| `Qwen3-VL-30B-A3B-Instruct` (API) | 3 | 1 |
| `llm-jp-3.1-8x13b-instruct4` (API) | 1 | 0 |
| `Phi-4-mini-instruct-cpu`, `Qwen3-0.6B-cpu` (API) | 0 | 0 |

I decided on this split after seeing the results. Some tasks are hard to place (steps from papers is also extracting work).

## What I found

- **The 3 tiers, split by difficulty, did not separate the models.** Before measuring, I had decided: "good fit if all tasks in a tier are at least 90% of the reference point, conditional if only some are". Counted this way, almost every cell becomes "conditional", except top cloud on Light and Standard work (good fit) and ~4B and below (poor fit). A model close on 1 of 6 tasks and a model close on 5 of 6 get the same "conditional". Each tier mixes checking work and writing work, so the differences cancelled out.
- **On checking work, many open models were close to the reference point.** `gemma-4-31B-it` and Kimi through an API are at 8 of 10.
- **On writing work, the gap between models was large.** `Qwen3.6-35B-A3B` through an API is at 7 of 10 on checking work and 2 on writing work. `Weblab-MedLLM-gpt-oss-120b` is at 5 and 1, and qwen3.6 on a computer is at 5 and 2. On the other hand, the gap for `gpt-6.1-sol`, and for gemma and Kimi through an API, is 2 in both kinds of work.
- **Drafting a plan from an answer was .17-.43 even for `gpt-6.1-sol`.** No model reached the reference point's .50-.63. This is not a task that top cloud covers. It is a task that only the reference point model is high on.
- **Clean copy's correction rate was .58-.66 even for top cloud.** The 95% intervals of `gpt-5.6-luna` and `gpt-6.1-sol` overlap a lot, so I cannot say there is a difference. The rate of changing what was said was .05 for `gpt-6.1-sol`, lower than the .19 of `gpt-5.6-luna`.
- **`gemma` on a computer did not fit tasks with long inputs in 10 minutes.** Checks, procedures from papers and clean copy all timed out. For topic merging (.67), 1 of 3 calls timed out. Even on tasks that did not time out, some values were lower than through an API: world grounding .75 → .35, and the plan's grounding check .83 → .42. On the other hand, translation was .83-.92, higher than through an API (.58) (a difference of 12 items and 1 run).
- **`qwen3.6` on a computer had 0 timeouts, but some tasks fell a lot compared with through an API.** A call took 11 s. Topic sorting went .83 → .50, the rate of wrong merges in name alignment .01 → .47, and translation .31-.39 → .08-.17. Some tasks rose (steps from papers .79 → .89, share of criteria passed for making Knowledge .60 → .70). It may be an effect of quantization, but with a single run I cannot separate the cause.
- **The ~10B model (`qwen3.5-9b`) fell short on most writing work.** Source checks (1.00), duplicate detection (1.00) and topic sorting (.90) were on par with the reference point. For generalizing findings, 19 of 20 calls timed out, and for clean copy, 5 of 6 did. The 1 clean copy call that did not time out also corrected not one place.

## Limits

- **Both top cloud models are from the same company.** It is also the same family as one of the graders (the GPT one). I could not measure Claude Opus this time, because of cost.
- **The models on a computer ran once each.** I could not measure the variation between runs. There was also only 1 computer (M1 Max, 64 GB).
- **The 10-minute cutoff is a hard condition for slow models.** `gemma` on a computer might have reached scores close to the API's if given more time. But I counted tasks that take over 10 minutes per call as failures, because I think people would not wait that long in real use.
- **"Share of criteria passed" and the split into checking work and writing work were decided after seeing the results.** The guide's verdict applies this measure to the rule I fixed before measuring (at least 90%).
- **The gap between checking work and writing work is mixed with a gap in how they were graded.** Apart from steps from papers, the measures for checking work are graded automatically. Apart from clean copy, the measures for writing work are AI grades (the lower bound, where both graders pass). Checking work also includes measures that are easy to get to 90% on, such as duplicate detection (upper bound 1.00) and the rate of wrong merges (reference point near 0). This measurement cannot separate whether the gap comes from the nature of the work or from how it was graded.
- **A person did not check the grading of the 5 models added this time.** The check against a person covers only 30 outputs of the first 3 models in the [previous measurement](/evaluations/open-models-by-feature).
- **Running the reference point 3 times moved it a little from last time.** For example, clean copy's correction rate went from .60 to .66, and making Knowledge's "passed every criterion" from .10-.20 to .08-.22. The "13 tasks" on the previous page is a value counted with the reference point's single run.
- The other limits (made-up cooking records, tasks with few items, and the grading criteria rewritten once) are the same as [last time](/evaluations/open-models-by-feature#limits).

## What I decided

- I changed 1 place in the model guide in [Settings](/settings). In the **Light work** tier, I moved local ~30B from "good fit" to "conditional". Measured directly on a computer, the two ~30B models were close to the reference point on only 3 and 4 of the 6 tasks. `gemma` timed out on checks (0) and scored .35 on world grounding. `qwen3.6` did not reach the reference point on answers and topic merging.
- I also changed the text for Light work. It is now: "Even a local model handles source checks and titles well. Lint and world checks can be slow or miss more, depending on the model."
- I pointed the "What we measured" link in Settings to this page.
- **I did not change the other cells.** By the rule I fixed before measuring, almost every cell becomes "conditional". Open large on Light work (1 to 5 of 6 tasks), and top cloud on Advanced work and the Voice note slot, also become "conditional" by this rule. Even so, the guide keeps them as "good fit". The rule is coarse and cannot tell a model close on 1 of 6 tasks from one close on 5 of 6, so I did not move cells on the strength of this result alone. Local ~30B on Light work is the one exception. I had few measurements on a computer until now, and this time I could measure it directly on the same 18 tasks. Both ~30B models were close to the reference point on only about half of the 6 tasks.
- **I did not change how the tiers are split this time.** In the data, splitting into checking work and writing work shows the differences between models better. But the tiers are part of how the app decides which feature uses which model. When I change the split, I will design it separately, together with a way to carry over today's settings.
