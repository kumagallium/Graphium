# Do claims from other sources reach the insights that already exist? <Badge type="info" text="Measured 2026-11-11 · v0.129.11" />

**Question.** An earlier look showed that insights were not merging across sources: two insights said the same rule, and their sources did not overlap. Where does the merge break off? If I fix that, do claims from other sources get added to the existing insight, and how many of the added ones are wrong?

**Short answer.** Before the fix, the entry that decides whether a claim is compared with an existing insight (closeness of wording) never opened: 0 of 10 candidates in the 12-bundle test. After the fix, the AI names the existing insight for a claim, and only claims that pass a separate check are added. In a replay that rebuilt insights from nothing, insights that span two or more sources went from 26 (13%) to 68 (35%), and claims used by insights went from 314 (21%) to 660 (44%). Of the 180 added or rejected pairs sampled from the replay's 514, the grader called 1 of 122 added pairs wrong (1%). The check also rejected many pairs that were right: of the 58 rejected pairs graded in the replay, 37 were right. I have not run this from the app's screens.

## How I measured it

- **Models.** The insight-building model and the check were both `gpt-5.6-terra` (via Copilot), which is the model users build insights with. The grader was Claude Sonnet, a separate setup. It saw pairs without knowing the condition, and the same way in every condition.
- **Data.** A read-only copy of a real library: 1,515 valid claims and 200 insights. Nothing was written to the real data.
- **Breaking down the cause (before the fix).** I took 12 insights (11 pairs) that the earlier look had confirmed as "the same rule, sources do not overlap". For each pair I kept one insight as the existing one (E) and removed the other (T). Then I ran insight building on a bundle of 50 claims that included the claims T had rested on (C). I ran it in two ways: with the existing insights' titles shown to the model (the current flow), and without (a control).
- **Embeddings.** The app's entry uses embeddings, so I reproduced the on-device `bge-m3` with the same ONNX model and measured similarity between insights, the make-up of bundles, and how many E claims land in a bundle.
- **Replay from nothing.** With the same 1,515 claims, the same bundle order (31 bundles) and the same model, I rebuilt insights from zero, before and after the fix. State was kept in memory only. The entry that decides whether to compare with an existing insight was closeness of characters, as in the MCP route.
- **Grader.** Claude Sonnet read each pair (an insight and a claim) with the condition hidden and marked it right, borderline or wrong. It read each pair once.

## Results

**1. Where it broke (before the fix, 12 bundles).**

| Step | What I looked at | Existing titles shown (current flow) | Not shown (control) |
|---|---|---|---|
| 1 | A candidate that pulls in C appeared | 10 / 12 | 10 / 12 |
| 2 | That candidate hit an existing insight at the entry (character bigram similarity 0.2 or more) | 0 / 10 (similarity 0.03 to 0.11) | 0 / 10 |
| 3 | Skipping the entry and pairing it with E, the judge said "same" | 2 / 10 | 4 / 10 |
| - | Candidates per bundle (average) | 4.7 | 8.3 |

| Embedding check | Value |
|---|---|
| Cosine similarity of 15 insight pairs that state the same rule with non-overlapping sources | 0.61 to 0.80 (none above 0.9) |
| Pairs among today's 200 insights with cosine above 0.9 | 0 (maximum 0.88) |
| Sources in one 50-claim bundle | Median 19 (min 9, max 31). A character-bigram bundle also had a median of 20 |
| Share of claims from the same source as the seed | Median 12% |
| Bundles seeded from T's claims that include 1 or more E claims | 6 / 12 |

| Hypothesis | Result |
|---|---|
| 1. "Do not output what overlaps existing insights" leaves no candidates | No difference for the 12 named cases (10/12 vs 10/12). Across whole bundles, though, candidates fall from 8.3 to 4.7, and the claims behind the dropped ones neither reach an existing insight nor are kept |
| 2. The entry is closeness of wording, so it never hits | Confirmed. 0/15 for embeddings, 0/10 for character bigrams. In the 12 bundles, the entry never opened |
| 3. Bundles lean on one source | Not confirmed. 19 sources per bundle, 12% from the seed's source |

**2. Before and after (replay from nothing).**

| Measure | Before | After |
|---|---|---|
| Insights | 193 | 197 |
| Insights with exactly 1 claim | 131 (68%) | 81 (41%) |
| Insights with 2 or more claims | 62 (32%) | 116 (59%) |
| Insights spanning 2 or more sources | 26 (13%) | 68 (35%) |
| Insights spanning 3 or more sources | 3 (2%) | 27 (14%) |
| Claims added to existing insights | 0 | 345 (343 by naming, 2 by duplicate check) |
| ...of which from a source other than the insight's original | 0 | 159 |
| Insights that gained support | 0 | 93 |
| Naming offers (claims) | - | 512 (169 rejected by the check) |
| Claims used by insights | 314 (21%) | 660 (44%) |
| Pairs that reached the duplicate check | 6 (same: 0) | 7 (same: 2) |
| HTTP calls (atomize + judge) | 36 | 65 |

**3. Claims added by mistake (grader's marks).**

| Target | Pairs | Right | Borderline | Wrong |
|---|---|---|---|---|
| Replay, added (122 of 180 sampled from 514 pairs) | 122 | 116 | 5 | 1 (1%) |
| Replay, rejected by the check (58 of the same 180) | 58 | 37 | 12 | 9 |
| 12 bundles (existing = real insights), added (all) | 107 | 95 | 11 | 1 (1%) |
| 12 bundles, rejected by the check (all) | 38 | 9 | 13 | 16 |
| Before the fix, added | 0 | - | - | - |

After the fix, in the 12 bundles, 175 claims were offered (114 from another source). 129 passed the check (77 from another source), across 66 insights. The pair from the earlier look (C to E) was named in 0 of 12. That pair is the one-step-more-abstract kind (see Limits), so not adding it is the correct side.

## What I decided

- **The AI names the existing insight.** Existing insights are shown with a reference. If a claim in the bundle is an instance of an existing insight's rule, the AI names that insight and returns the claim's id, instead of creating a new insight or dropping the claim.
- **Only claims that pass a separate call's check are added.** That call lays the insight's title, shape and body next to the claim and chooses again whether the claim is an instance of the rule as written. If the check cannot be obtained, nothing is added.
- **Closeness of wording is not an entry.** The existing route (candidate, then closeness, then same / contradiction / different) stays as it is.
- **The app's route and MCP are built the same way.**

## Limits

- The replay follows the MCP route (bundles and the entry both use character bigrams). The app builds bundles with embeddings. I counted the embedding entry separately (none above 0.9), so "0 added" before the fix points the same way in the app. But I did not run the replay on the app's bundles.
- One run each. I did not measure how much the model varies, and only one model builds the insights.
- The grader is one model that read each pair once. For the replay it was a sample of 180 out of 514 pairs.
- The check is strict. Of the pairs it rejected, the grader said "right" for 37 of 58 in the replay, and for 9 of 38 in the 12 bundles (13 borderline, 16 wrong). Pairs that should have been added are left out. I leaned toward fewer wrong additions.
- Claims contain many paraphrases (the same statement comes out of different notes many times). "A claim from another source" includes a paraphrase from another note by the same person.
- Adding does not rewrite the insight's body or its "Source Claims" list. This is the same as the earlier support-adding, and regenerating updates them.
- I have not run this from the app's screens (automatic discovery after ingesting, and "Discover Insights"). The route was run with a real model, and I checked saving through MCP with tests.
- Pairs that agree only one step more abstract than the insight's wording do not merge. For example, one insight says something happens under condition A and the other says it happens under condition B. The judge reads the insight as written and says "different" (same: 2 of 10). Adding a claim there would misstate its support. Generalizing the existing insight is a separate matter, and I did not handle it here (13 pairs from the earlier look).
