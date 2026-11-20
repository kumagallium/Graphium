# Does gemma on one lab GPU keep the quality measured through an API? <Badge type="info" text="Measured 2026-11-20 · v0.129" />

**What I wanted to know.** I run an AI model on a lab workstation and use it from Graphium. That way the AI features work without note contents leaving the lab. The workstation first ran `gpt-oss-120b`. In the [previous measurement](/evaluations/cloud-and-local-models-by-feature), `gemma-4-31B-it` through an API did better on many tasks, so I switched the workstation to `gemma-4-31B-it`.

But the good gemma numbers were measured through an API. The workstation runs a version shrunk to 4 bits (`gemma-4-31b-qat`). When I ran the same 4-bit version on a Mac, 57 of 251 calls did not finish within 10 minutes. I wanted to see how much of the API quality and speed the workstation GPU keeps.

**In short.** On the workstation, gemma beat `gpt-oss-120b` (API) on 21 of 45 metrics and fell behind on 11. It was about level with gemma through an API (13 higher, 15 lower, 17 about the same). Only 2 of 251 calls timed out.

- **Better**: chat answers, checks, translation, name alignment, how much a summary adds that the meeting did not say, and corrections in clean copy
- **Worse**: world grounding (whether a claim matches general knowledge), topic revision, and taking steps out of papers. In clean copy, it also changed more remarks that should be left alone
- **Speed**: the median call took 74 seconds. I ran 2 calls at a time, so a single call alone would be faster

Based on this, I kept `gemma-4-31B-it` as the workstation default. If you lean on world grounding, another model fits better.

## How I measured it

| | |
|---|---|
| Version measured | Same as last time (one commit after v0.129.11 on main). I called the server endpoints directly |
| Workstation | One NVIDIA RTX A6000 (48 GB). llama.cpp with all of `gemma-4-31b-qat` (about 18 GB) on the GPU. 32,768 tokens of context per call, 2 calls at a time. Temperature 1.0, top-p 0.95, top-k 64, thinking on, up to 16,384 tokens written per call |
| Runs | 1. Two calls at a time (same as the workstation setting) |
| Inputs and grading | The same 18 tasks, inputs and criteria as last time. Two AI graders (Claude Sonnet and one GPT model on Copilot) graded separately with model names hidden. Of the 144 graded outputs, 0 replies were in the wrong format on either side |
| Timeouts | Each call was cut off at 10 minutes and counted as a failure |

The other columns reuse earlier measurements. `gpt-5.6-luna` is the reference point (the yardstick), 3 runs. `gpt-oss-120b` and gemma through an API are 3 runs each. The 4-bit version on a Mac is 1 run.

## Results

Read the metrics as on the [previous page](/evaluations/cloud-and-local-models-by-feature#reading-the-metrics). Higher is better, except rows marked ↓. "Passed every criterion" is the share where both graders passed the output.

| Task (count) and metric | Reference | gpt-oss-120b (API) | gemma (API) | gemma (Mac, 4-bit) | **gemma (workstation, 4-bit)** |
|---|---|---|---|---|---|
| Answers (30) passed every criterion | .99 | .84 | .97 | 1.00 | **1.00** |
| Source check (48) detection | .97 | .97 | .97 | 1.00 | **1.00** |
| Checks (24) detection | .76 | .58 | .88 | .00 | **.83** |
| Merging topics (24) recall | 1.00 | .82 | 1.00 | .67 | **1.00** |
| Name alignment (30) recall | .96 | .82 | .80 | 1.00 | **1.00** |
| Plan grounding check (24) detection | .85 | .71 | .83 | .42 | **.83** |
| Making Knowledge (20) share of supported claims | .94 | .83 | .87 | .86 | **.79** |
| Making Knowledge (20) criteria pass rate | .71 | .70 | .67 | .56 | **.70** |
| Topic revision (20) passed every criterion | .40 | .38 | .40 | .35 | **.25** |
| Generalizing findings (20) criteria pass rate | .78 | .53 | .73 | .26 | **.80** |
| Translation (12) passed every criterion | .83 | .25 | .58 | .83 | **.75** |
| Plan draft from an answer (10) passed every criterion | .50 | .00 | .07 | .00 | **.00** |
| Steps from papers (7) step F1 | .89 | .87 | .88 | .00 | **.79** |
| Titles (20) passed every criterion | .90 | .90 | .85 | .95 | **.95** |
| World grounding (40) accuracy | .78 | .77 | .72 | .40 | **.40** |
| Summary (6) recall of decisions | .80 | .71 | .73 | .78 | **.81** |
| Summary (6) items not in the meeting ↓ | .28 | 1.56 | .33 | 1.00 | **.67** |
| Clean copy (6) correction rate | .66 | .27 | .52 | .00 | **.47** |
| Clean copy (6) changed remarks that should stay ↓ | .19 | .04 | .18 | - | **.33** |

The full table of 45 metrics is in the measurement record (`experiments/2026-11-11-sakura-engine-bench/results/all4/ws-vs.md`).

**Time (median per call)**

| | All tasks | Answers | Making Knowledge | Generalizing findings | Clean copy |
|---|---|---|---|---|---|
| gemma (workstation) | 74 s | 15 s | 145 s | 245 s | 269 s |
| gemma (Mac, 4-bit) | 264 s | 49 s | 503 s | 600 s (cut off) | 600 s (cut off) |
| gemma (API) | 14 s | 8 s | 19 s | 17 s | 44 s |
| gpt-oss-120b (API) | 9 s | 3 s | 19 s | 17 s | 56 s |

## What I found

- **Shrinking to 4 bits kept quality level with the API on most tasks.** Checks, steps from papers and clean copy, which failed on the Mac, came back. So most of the low Mac numbers likely came from timeouts.
- **Only world grounding dropped, to the same .40 as on the Mac.** It did not give more wrong verdicts. It searched, then gave no verdict because it "found no supporting source", on 22 of 40 claims (gemma through an API did that on 8). I did not separate whether the 4-bit weights or the day-to-day search results caused it.
- **Clean copy corrected more, and also overcorrected more.** The share of mishearings fixed rose from .27 to .47. The share of remarks it should have left alone but changed also rose, from .04 to .33.
- **Long tasks take minutes.** Generalizing findings and clean copy take over 4 minutes per call. Chat answers take about 15 seconds.

## Limits

- This is 1 run. Tasks with few items (summary 6, clean copy 6, papers 7, plans 10) have wide intervals.
- One grader reported that, while listing the output folder, it saw grading results from other batches. It said it did not use them.
- The measurement stopped 3 times and I resumed it. Two calls that failed while it was stopped were rerun as measurement-side failures.
- I did not run `gpt-oss-120b` on the workstation in this benchmark. The `gpt-oss-120b` column is the API value. When I timed short tasks on the same workstation, gemma was about 2 times slower.
- The inputs are made-up cooking records. Results may differ on research notes.
