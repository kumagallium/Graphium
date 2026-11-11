# Claims stay inside what the note supports <Badge type="info" text="Measured 2026-11-11 · v0.129" />

**Question.** Should the AI generalize at the claim step? If the instruction is rewritten as "one claim each, readable without the note, never beyond what the note supports", does claims stretching beyond the note go down, and does readability hold up? I measured this with two models.

**Short answer.** The first version reduced claims stretching beyond the note but increased copies of the note's record. The second version, a two-layer "point, then record", raised the number of outputs passing every criterion from 4 of 20 to 10 of 20 with gpt-5.6-luna, and cut claims stretching beyond the note from 20% to 3%. With gpt-oss-120b the improvement was small. I adopted the second version. For both models, one run per condition was judged, and the second version's outputs were judged in a later round than the old and first-version outputs (see [Limits](#limits)).

## How I measured it

- **Input.** 20 made-up cooking notes (curry and bread). Ingestion was called once per note.
- **Models.** gpt-5.6-luna and gpt-oss-120b.
- **Conditions.** Three.

| Condition | Instruction |
|---|---|
| Old | Unchanged |
| First version | Added a scope rule: "write a single trial as something that happened" |
| Second version (adopted) | Two layers, "point, then record". Write a single trial so that the wording shows it is one trial. Do not turn a one-line record into a claim |

- **Grading.** Outputs were made into packets with the model and condition hidden, and Claude Sonnet marked each against 7 criteria as pass or fail. The criteria were fixed before measuring. Only the first run's outputs were graded. For the second and third runs of gpt-oss-120b I looked only at automatic counts: the number of claims and the number of empty results.
- **Grader noise.** I had a second grader re-grade 10 outputs from the old condition. The pass/fail verdicts agreed on 62 of 70. For the "not a copy" criterion, they agreed on 7 of 10, the lowest of the seven.

## Results

For the 20 outputs of the first run: how many passed every criterion, and how many passed each one. An output with zero claims counts as failing every criterion. The "per claim" table after it uses only the claims of outputs that could be judged as its denominator.

| Condition / model | Empty | Faithful | Scope | Readable alone | One claim each | Not a copy | Point | States kept apart | All criteria |
|---|---|---|---|---|---|---|---|---|---|
| Old / gpt-5.6-luna | 0 | 14 | 10 | 14 | 18 | 17 | 17 | 18 | 4 |
| First / gpt-5.6-luna | 0 | 16 | 15 | 16 | 19 | 9 | 19 | 18 | 3 |
| Second / gpt-5.6-luna | 0 | 19 | 17 | 13 | 18 | 19 | 18 | 19 | 10 |
| Old / gpt-oss-120b | 0 | 7 | 6 | 16 | 16 | 11 | 17 | 19 | 2 |
| First / gpt-oss-120b | 2 | 8 | 7 | 14 | 13 | 6 | 16 | 16 | 1 |
| Second / gpt-oss-120b | 0 | 8 | 8 | 14 | 18 | 14 | 18 | 17 | 3 |

Rates per claim.

| Condition / model | Claims in total | Statements not in the note (per claim) | Stretched beyond the note | Not readable alone | Packed together | Copies |
|---|---|---|---|---|---|---|
| Old / gpt-5.6-luna | 102 | 0.07 | 20% | 12% | 2% | 5% |
| First / gpt-5.6-luna | 128 | 0.03 | 8% | 4% | 1% | 24% |
| Second / gpt-5.6-luna | 102 | 0.01 | 3% | 13% | 2% | 2% |
| Old / gpt-oss-120b | 120 | 0.19 | 24% | 8% | 6% | 23% |
| First / gpt-oss-120b | 124 | 0.16 | 19% | 5% | 8% | 34% |
| Second / gpt-oss-120b | 120 | 0.12 | 20% | 8% | 2% | 13% |

Old against new on the same notes (better / worse / same).

| | Faithful | Scope | Readable alone | One claim each | Not a copy | Point | States kept apart |
|---|---|---|---|---|---|---|---|
| gpt-5.6-luna old→first | 6/4/10 | 6/1/13 | 4/2/14 | 2/1/17 | 0/8/12 | 2/0/18 | 1/1/18 |
| gpt-5.6-luna old→second | 6/1/13 | 8/1/11 | 3/4/13 | 1/1/18 | 3/1/16 | 2/1/17 | 1/0/19 |
| gpt-oss-120b old→first | 4/1/13 | 3/1/14 | 2/3/13 | 2/3/13 | 1/5/12 | 1/0/17 | 0/2/16 |
| gpt-oss-120b old→second | 2/1/17 | 4/2/14 | 2/4/14 | 3/1/16 | 5/2/13 | 1/0/19 | 1/3/16 |

What I read from it.

- **The first version backfired.** Claims stretching beyond the note went down (20% to 8% with gpt-5.6-luna). But "write only what happened" was read literally, and the body became just one sentence of the record. Copies rose from 5% to 24%; on the same notes, none got better and 8 got worse. The number of claims also went up, and one point split into fragments of fact.
- **The second version worked with gpt-5.6-luna.** Outputs passing every criterion went from 4 to 10, claims stretching beyond the note from 20% to 3%, and statements not in the note from 0.07 to 0.01. Copies went from 5% to 2%. On the same notes, "not a copy" got better for 3 outputs and worse for 1.
- **With gpt-oss-120b the second version helped only a little.** Copies went from 23% to 13%, packed-together claims from 6% to 2%, and statements not in the note from 0.19 to 0.12. Claims stretching beyond the note barely moved (24% to 20%), and outputs passing every criterion went from 2 to 3. On the other hand, passes on "readable alone" fell from 16 to 14, and on "telling states apart" from 19 to 17.
- **"Not readable alone" did not improve** (12% to 13% with gpt-5.6-luna). Phrasing such as "in this prototype" or "this time" in the second version was judged to lean on the note in some cases.
- At the start I had assumed gpt-oss-120b packs everything into one claim, but that was a hasty conclusion from a single trial. Over three old-condition runs the average was around 6 claims per note, and packed-together claims were 6%.

## What I decided

- **Claims go as far as splitting them apart and making them readable without the note.** Generalizing across situations is the job of insights.
- **The body starts with the point in the first sentence, then gives the note's record.** I adopted the second version's form.
- **A single trial is written in a way that shows it is a single trial.**
- **This rule is not applied to memos (scribbled notes).**

## Fixed afterwards

- **Broken JSON in the AI's reply.** When one place in the reply broke, every claim for that note was thrown away. The empty results from gpt-oss-120b came from this. It now tries a mechanical repair. In the second run of the second version, it rescued 1 and failed to rescue 2.
- **Phrasing like "in this prototype".** Since it was judged to lean on the note, I added one sentence to the instruction that names the situation. **I have not measured this.**

## Limits

- 20 made-up cooking notes. Research notes may behave differently.
- gpt-5.6-luna ran once per condition. For gpt-oss-120b too, only the first run was graded.
- One line of graders. The packets for the second version were graded in a separate round (by a separate agent) from the old and first-version packets. Agreement on the 10 re-graded outputs was low for "not a copy" (7 of 10), so the copy rates are a rough guide.
- The old-condition gpt-5.6-luna outputs came from another measurement taken at a different time (same server-side code, same input).
- Memos (scribbled notes) and ingesting outside sources were not measured. The scope rule is not applied to memos.
- The one sentence added after the measurement (naming the situation) has not been measured.
