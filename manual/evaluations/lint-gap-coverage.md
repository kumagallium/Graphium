# Checking a "gap" against existing topics before showing it <Badge type="info" text="Measured 2026-11-28 · v0.173.8" />

**Question.** A Full (AI analysis) check reports a **Gap**: a subject that several pages touch on but that has no page of its own. I measured how often such a gap is right, and whether the wrong ones can be reduced.

**Short answer.** Most subjects the old check named as "has no page" already had a topic about them. So a check against the titles of all topics was added before a gap is shown. Within what was measured, gaps that already had a topic were dropped, and gaps with no topic were kept.

- In the check before the change, subjects named as "has no page" came up 9 times in total (7 distinct subjects). In 6 of those 9, a topic about that very subject already existed.
- The number of gaps swung from run to run (0, 3 and 3).
- When the added check was run 3 times on each of the 6 gaps that came out, it dropped 4 and kept 2, with the same verdicts all 3 times.
- The extra input is about 1.5% of the input of one Full check.

## How I measured it

Run on 2026-11-28 with `gpt-oss-120b`.

| | Detail |
|---|---|
| Knowledge | The developer's own. 3,865 pages shown (988 topics, 2,561 claims, 198 insights, 117 summaries of the old type, 1 answer) |
| Check | Three Full checks. Each was sent in 8 parts. 125 to 158 seconds, about 800,000 input tokens |
| Added check | Only when one or more gaps come out, the AI is shown the titles of all topics once more (titles only) and asked whether a topic is about that very subject. A gap judged covered is removed from the result. A topic that covers only one aspect ("X's Y") does not remove it |

## Results

**The check before the change (3 runs).**

| Run | Gaps | Worth investigating | Of those, questions of the "no summary page" kind |
|---|---|---|---|
| 1 | 0 | 12 | 4 |
| 2 | 3 | 17 | 0 |
| 3 | 3 | 27 | 0 |

Subjects named as "has no page", counting gaps and questions together, came up 9 times (7 distinct subjects). In 6 of those 9, a topic about that very subject already existed. In 1, a broader topic existed (the added check does not drop this shape). Of the remaining 2, one was a subject with 7 topics in the "X's Y" form but no page for X itself, and the other was a subject whose name appears in only 2 claims (counted by matching the name as text).

**Counted without AI.** Counting topics titled "X's Y" by X, there were 18 values of X with 3 or more topics in a row. Of these, 5 had no page for X itself. Of those 5, the AI named only 1, once, across the 3 checks. This is the same shape that [Group pages by thing](/knowledge-layer#group-pages-by-thing) in Upkeep deals with.

**The added check.**

| What I tried | Result |
|---|---|
| The check, 3 times on each of the 6 gaps from the 3 checks | Dropped 4 of 6 and kept 2. The same verdicts all 3 times |
| The check, 3 times on each of 4 examples I built | The 2 that should stay (subjects with "X's Y" topics in a row but no page for X) were kept all 3 times. The 2 that should be dropped (subjects with a topic titled after them) were dropped all 3 times |

Each of the 4 dropped gaps did have a topic about that subject. One of them was a remark that "values are not consistent", and a question with the same content also appeared in Worth investigating in the same run. The 2 kept were a subject whose name appears in only 2 claims and a subject narrower than an existing topic.

The extra input was about 11,700 tokens for 988 titles (usage reported by the model; about 8,400 by Graphium's estimate), about 1.5% of the input of one Full check.

## What I decided

- **A gap is checked against the titles of the existing topics before it is shown.** If the check fails, or the list of titles does not fit in about 72,000 tokens, nothing is removed and the gaps are shown as they are. The numbers are in the [FAQ](/faq).
- **I did not adopt adding a count of supporting pages to a gap.** I also did not adopt adding a "make a topic" button to a gap. Almost no gap was left that would have been worth making a topic for.
- **For "X's Y" topics in a row with no page for X, [Group pages by thing](/knowledge-layer#group-pages-by-thing) catches more than the AI check does.**

## Limits

- One model and one knowledge base (the developer's own).
- The check was run on 6 gaps and 4 examples I built. The questions of the "no summary page" kind inside Worth investigating (the 4 in the first run) were not subject to this check.
- Which gaps "should be dropped" and "should stay" was decided by the developer from the titles. Like the check itself, that judgement leans on titles, so it is not an independent ground truth. Whether dropping the "values are not consistent" gap is right is open to argument.
- I counted only the subjects the AI named and the "X's Y" shape. Concepts that do not appear in a title were not measured.
- The measurement did not pass the last 7 days of activity log, so the ordering of Worth investigating is not the same as in the app's check.
