# How much of a paper's procedure comes out of the PDF, and how well do the names line up? <Badge type="info" text="Measured 2026-11-06 · v0.120.8" />

**What I checked.** When you run **Extract steps into a note** on a paper's PDF, how closely do the steps, materials, instruments and conditions match the synthesis procedure the paper describes? And when you bring in several papers at once, how many names does [aligning extracted names with your library](/materials-and-citations#aligning-extracted-names) line up — and how many does it line up wrongly?

**In short.** Extraction caught 60–80% of the synthesis operations the papers describe. It also turns measurement and characterization into steps, so its precision against the reference is low. Name alignment increased the names shared by two or more papers and barely changed the match with the reference. The first version increased shared names by 20–60% but got nearly one merge in ten wrong. The current, more cautious version increases them by 10–20% with 3% wrong merges.

::: tip Later
The extraction was measured again with a scoring that matches by meaning instead of exact names, and its weak spot (the links) was improved for Claude and Copilot. See [Where is procedure extraction weak?](/evaluations/extraction-accuracy-by-meaning).
:::

## How I measured

| | |
|---|---|
| Papers | Seven papers from the evaluation split of [MatPROV](https://huggingface.co/datasets/MatPROV-project/MatPROV), a public dataset of materials-synthesis procedures — the ones published under CC-BY whose PDF I could download (thermoelectrics, magnetism, ferrites) |
| Reference | MatPROV's hand-made answers. They hold **only the synthesis procedure**, not measurement or characterization |
| Path | The same as the app: text taken out of the PDF in the browser, then sent to the procedure extraction. Output language English, because the reference is English. The library started empty |
| Name alignment | The app's two passes (fold spelling differences, then let the AI recognize the same thing), run over the seven papers one at a time, in order |
| Models | Claude Opus 5, GitHub Copilot's `gpt-5.6-luna`, and `gpt-oss-120b` (an open model used through an OpenAI-compatible API). Two runs each |
| Scoring | For operations, materials, instruments, links (which operation used which material) and conditions: the share of names that match the reference (precision P, recall R, F1) |
| Merge correctness | Each merge was classified by a separate AI judge as same thing / different things / depends on context |

## Extraction

Averages of the two runs, before name alignment (after alignment, see "Name alignment" below).

| Model | Operations P / R / F1 | Materials F1 | Instruments F1 | Links F1 | Conditions F1 | Time per paper |
|---|---|---|---|---|---|---|
| Claude Opus 5 | 0.41 / 0.80 / 0.54 | 0.34 | 0.26 | 0.20 | 0.24 | 2–3 min |
| Copilot gpt-5.6-luna | 0.57 / 0.80 / **0.67** | **0.37** | 0.20 | **0.26** | **0.34** | about 30 s |
| gpt-oss-120b | 0.51 / 0.61 / 0.55 | 0.32 | 0.16 | 0.17 | 0.30 | about 20 s |

- **Synthesis operations are caught well.** Recall for operations was 0.6–0.8.
- **Precision is low because extraction covers more than the reference.** The reference is synthesis only; extraction also makes steps of X-ray diffraction, magnetization measurement and electron microscopy. You want those steps in a note, so the gap is a difference in scope more than an error.
- **Claude catches the most.** Highest recall, lowest precision, and the most time and tokens (about 34,000 input tokens per paper).
- **Instruments score low.** Precision is 0.10–0.16; as with operations, I read most of it as extraction also catching measurement instruments (magnetometers, spectrometers) the reference does not hold. Some instruments are also named at a different level of detail than the reference ("planetary ball mill" versus "Fritsch Pulverisette P-5").

## Name alignment

Names that appear in two or more papers (the nodes that connect papers), and whether the merges were right. F1 moved by no more than ±0.03 for any model.

| | Shared names (before → after) | Merges | Same thing | Depends | Different things |
|---|---|---|---|---|---|
| First version | Claude 37 → 45–46, luna 21–22 → 28, gpt-oss 13–16 → 21–22 | 111 | 83 | 18 | **10** |
| Current version | Claude 37 → 41–44, luna 21–22 → 24–25, gpt-oss 13–16 → 16–18 | 72 | 66 | 4 | **2** |

- **Folding spelling differences was right every time** (7 merges): case, hyphens and plurals.
- **The first version's errors all came from merges the AI judged "the same".** Three patterns: dropping a qualifier to reach a generic name ("Measuring resistivity" → "Measuring"), merging samples that differ by a condition ("1 h ball-milled powder" → "ball-milled powder"), and swapping techniques (EDS, a spectroscopy, onto an X-ray diffractometer).
- **The current version merges more cautiously.** For step names and parameter keys, a merge that only drops words is rejected by a fixed rule. For materials and outputs, a merge that drops anything other than a form word such as "powder" or "solution" is rejected. Instruments are not stopped by the rule, because dropping a brand or model name to reach the general name is wanted; they are left to the AI's instructions (keep qualifiers; brand and model words are not qualifiers). Shared names grow less, but wrong merges went from 10 to 2.

## What I learned

- **All three models recalled 60–80% of the synthesis operations.** `gpt-5.6-luna` balances speed and F1 best; Claude takes its time and catches the most. Link and instrument F1 stay below 0.3 for every model.
- **Name alignment adds shared operations and instruments across papers.** The more it merges, the more it gets wrong, so it leans toward not merging when unsure: a wrong merge corrupts the graph, a missed one can be fixed later.

## Limits

- Seven papers, two runs each. One paper can move F1 a lot; read the numbers as a trend.
- The reference covers synthesis only, so extracting measurement and characterization lowers precision.
- Merges were judged from the names. For the current version, some doubtful ones were also checked against the paper text; the first version was judged from the names only.
- Alignment was measured among the seven papers of one batch only, not against an existing large library.
- Accuracy with Japanese headings was not measured (the reference is English). In Japanese I only checked that the flow runs end to end in the app.

## Found along the way (and fixed since)

- **Dropped qualifiers and swapped techniques.** As above: the AI gets two more instructions, and for steps, parameters, materials and outputs a merge that only drops a qualifier is rejected by a fixed rule. The "current version" row is after the fix.
- **An error that remains.** Two merges mapped a generic X-ray diffractometer (no model named) onto another paper's specific model. Merging from generic to specific is not blocked yet.

Running the whole flow in the app (seven PDFs → extract them together → ask the chat → experiment plan note) also turned up these, now fixed:

- **Values per row of a plan.** Run notes kept the first row's values. Extraction calls both the pre-heat and the calcination "temperature", so replacing by name would change both; the first row's value itself is now found and replaced.
- **Sentences that hold only for the first row.** When the first row was the unsubstituted sample, "no Co is added because x = 0" stayed in every row. The common procedure is now written to hold for every row's values.
