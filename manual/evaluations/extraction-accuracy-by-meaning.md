# Where is procedure extraction weak? Measured again by meaning, and the links fixed <Badge type="info" text="Measured 2026-11-06 · v0.121.1" />

**What I checked.** The [previous measurement](/evaluations/papers-to-procedures) counted a name as right only when it matched the reference exactly. That makes "Calcining" versus "calcination" a miss. The reference also holds only the synthesis procedure, so every measurement or characterization step the extraction keeps lowers precision. I built a scoring that matches by meaning, measured again, found the real weak spots, and changed the extraction instructions. Before and after are compared with the same scoring.

**In short.** Matched by meaning, operations and materials score an F1 of 0.7–0.95 (in-scope F1, explained below). What stayed weak was the links (which operation used which material and made what) and the conditions. I think the links were weak mainly because intermediate products had no name: in the app's graph most such hand-offs become a nameless "result of step X" node. After changing the instructions, the share of hand-offs with a name went from 4–40% to 99–100% for Claude and Copilot, and link F1 went from 0.71 to 0.84 for Claude and from 0.68 to 0.79 for Copilot. `gpt-oss-120b` did not change.

## How I measured

| | |
|---|---|
| Papers | The same seven CC-BY paper PDFs as before (text taken out of the PDF). Plus, as a check, five MatPROV few-shot texts (short synthesis paragraphs). The benchmark's sample text was left out of the check set, because it has been used to develop the extraction instructions. The five check texts were used to find side effects of the intermediate versions |
| Models | Claude Opus 5, GitHub Copilot's `gpt-5.6-luna`, `gpt-oss-120b`. Two runs each. English output |
| Scoring by meaning | Prediction and reference become lists of operation, entity and condition nodes. A judge model (Claude Opus 5) only produces a mapping: which reference node each predicted node denotes, or that it is out of scope (measurement / characterization). Links are then scored in code, after replacing predicted ids with the mapped reference ids |
| Predicted links | Built to approximate the app's graph: a material with the same name as another step's output is that output. The app looks for the name only in the earlier step the material points to, and links to that step's only output even when the names differ. The scoring does not reproduce that, so it is an approximation |
| In-scope F1 | Precision is over predictions that were not judged out of scope, or that matched. Measurement and characterization steps are outside the reference, so they leave the denominator. Recall counts distinct reference nodes |
| Distinct precision | Distinct reference nodes hit, divided by in-scope predictions. It drops when a prediction copies the same thing many times. In-scope F1 counts every prediction mapped to one reference node as correct, so it cannot show copying; this measure was added for that |
| Judge audit | A separate AI auditor checked four model × run × paper mappings, 160 decisions, against the reference: one clear error, no misses. The audit also pointed out lenient parts of the scoring formula, which were fixed |

## Exact match versus meaning (before the fix, seven PDFs, F1)

| Model | | Operations | Materials | Instruments | Links | Conditions |
|---|---|---|---|---|---|---|
| Claude Opus 5 | exact | 0.54 | 0.34 | 0.26 | 0.20 | 0.24 |
| | by meaning (in-scope F1) | 0.88 | 0.93 | 0.82 | 0.71 | 0.67 |
| Copilot gpt-5.6-luna | exact | 0.67 | 0.37 | 0.20 | 0.26 | 0.34 |
| | by meaning (in-scope F1) | 0.93 | 0.95 | 0.75 | 0.68 | 0.59 |
| gpt-oss-120b | exact | 0.55 | 0.32 | 0.16 | 0.17 | 0.30 |
| | by meaning (in-scope F1) | 0.78 | 0.74 | 0.44 | 0.52 | 0.51 |

For operations, much of the rise comes from taking measurement and characterization steps out of the denominator: Claude's operations, counted with them, score 0.58. For materials, absorbing wording differences counts for more: Claude's materials, counted with characterization, score about 0.74. What stayed low by meaning was links, conditions, and `gpt-oss-120b`'s instruments.

## The weak spots

- **Intermediate products had no name.** The instructions put products on the last step only. What a middle step made (the mixed powder, the calcined sample) was reached by the next step only as "the thing from the previous step", with no name on the step that made it. When the earlier step has no output, the app's graph fills the gap with a nameless "result of step X" node, so a product the paper names never appears in the graph.
- **A purity given once landed on the last material only.** When the text gives "purity 99.5%" once for five elements, the purity was attached to the nearest element only. The seven PDFs' reference has 9 purities; over two runs each (18), Claude found 9, Copilot 1 and `gpt-oss-120b` 5.

## What changed

- A product a later step uses gets an output mark in the step that makes it, with the same name the later step uses. No steps are added just to produce a hand-off. Name alignment keeps both sides of a hand-off identical.
- A purity or form given once is written after each material.
- A series of compositions under the same conditions (such as x = 0, 0.2, 0.4) is not copied per composition; it stays one chain with the values listed. If there are still 12 or more steps and three times as many steps as distinct headings, copying is suspected and the model is asked once to rewrite.

This took three stages.

1. **Hand-off names only.** Operations and materials dropped on the short check texts: steps were added just to name a hand-off, and `gpt-oss-120b` copied the whole procedure per composition (90 steps for ten compositions, on the benchmark's sample text).
2. **Guards added to the instructions:** no steps just for a hand-off, purity per material, one chain per composition series. But the added example sentences quoted the papers used for evaluation. Instructions and evaluation were not separate, so this version's numbers are not used.
3. **The current version.** The examples were replaced with ones that appear in none of the evaluation texts, a check that detects copying and asks for one rewrite was added, and everything was measured again. "After" below is this version.

## Results

Hand-offs that carry a name:

| Model | Before (seven PDFs / five check texts) | After (all twelve) |
|---|---|---|
| Claude Opus 5 | 40% / 33% | **100%** |
| Copilot gpt-5.6-luna | 4% / 11% | **99%** |
| gpt-oss-120b | 79% / 96% | **97%** |

In-scope F1 (before → after). Distinct precision in brackets.

| | Model | Operations | Materials | Instruments | Links | Conditions |
|---|---|---|---|---|---|---|
| Seven PDFs | Claude Opus 5 | 0.88 → 0.88 (0.54 → 0.53) | 0.93 → 0.92 (0.44 → 0.62) | 0.82 → 0.93 | 0.71 → **0.84** | 0.67 → 0.71 |
| | gpt-5.6-luna | 0.93 → 0.87 (0.72 → 0.69) | 0.95 → 0.90 (0.70 → 0.83) | 0.75 → 0.83 | 0.68 → **0.79** | 0.59 → 0.69 |
| | gpt-oss-120b | 0.78 → 0.70 (0.62 → 0.52) | 0.74 → 0.75 (0.70 → 0.64) | 0.44 → 0.42 | 0.52 → 0.51 | 0.51 → 0.54 |
| Five check texts | Claude Opus 5 | 0.81 → 0.88 (0.70 → 0.81) | 0.89 → 0.90 (0.74 → 0.86) | 0.74 → 0.73 | 0.63 → **0.74** | 0.73 → 0.83 |
| | gpt-5.6-luna | 0.85 → 0.81 (0.48 → 0.86) | 0.80 → 0.76 (0.49 → 0.86) | 0.78 → 0.62 | 0.59 → **0.67** | 0.69 → 0.64 |
| | gpt-oss-120b | 0.80 → 0.82 (0.63 → 0.72) | 0.79 → 0.74 (0.67 → 0.70) | 0.47 → 0.53 | 0.64 → 0.66 | 0.60 → 0.55 |

Purities found (seven PDFs, 9 in the reference × 2 runs = 18): Claude 9 → **18**, Copilot 1 → **11**, `gpt-oss-120b` 5 → 0.

Extractions flagged as copying (out of 24 runs on the seven PDFs and five check texts): in the second-stage version, `gpt-oss-120b` 2 and Claude 1; in the current version, `gpt-oss-120b` 1 and Claude 2. All three in the current version are the same paper, which has three compositions × three calcination temperatures; branches for different temperatures are legitimate, so not all of them are errors.

- **Links clearly went up for Claude and Copilot,** on the PDFs and on the check texts. `gpt-oss-120b` did not change.
- **Of the other 24 differences, 15 are within ±0.05.** Of the larger moves, most of `gpt-oss-120b`'s operations on the PDFs (0.78 → 0.70) is one paper: in one run it wrote co-precipitation, filtering, drying and calcination once per composition, adding steps the reference (only separation and co-precipitation) does not have; without that paper the drop nearly disappears. Copilot's instruments on the check texts (0.78 → 0.62) mostly move with one paper that has two synthesis routes. Why some measures rose (Claude's instruments on the PDFs +0.11, Copilot's conditions on the PDFs +0.10, …) was not checked.
- **Claude and Copilot now catch purities.** `gpt-oss-120b` went down instead: it hardly writes purities any more. Why was not checked.

## What I learned

- **Extraction was weak at links and conditions, not at catching operations or materials.** Exact-match numbers hid this; matching by meaning showed it.
- **The better numbers and a better graph should point the same way.** With named hand-offs, the intermediate products a paper describes appear in the graph under their own names. The graph of a note imported with the new instructions has not been checked in the app yet.
- **Added instructions help a smaller open model less.** `gpt-oss-120b` already named its hand-offs, yet its links did not improve and its purities went down.

## Limits

- Seven PDFs and five short texts, two runs each. One paper can move the numbers a lot (without the paper above, `gpt-oss-120b`'s operations on the PDFs go from 0.70 to 0.79).
- The judge is Claude Opus 5. Whether it is lenient toward Claude's own output was not checked. 160 decisions were audited.
- In-scope F1 counts every prediction mapped to one reference node as correct, including one value per step against a reference list of values (850, 900, … °C). Copying is shown by distinct precision, but condition F1 would be lower under a stricter count.
- The reference has gaps too (the calcining above).
- An older example in the instructions, "Cu (shot, 99.999%)", matches the wording of one check text (and of the benchmark sample that was left out).
- Only English output was measured. The same instructions apply to Japanese headings, but their accuracy was not measured. Keeping hand-off names identical during name alignment is covered by unit tests only.
- The changed instructions ship in the release after this measurement.
