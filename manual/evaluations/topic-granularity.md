# Naming topics after the thing itself <Badge type="info" text="Measured 2026-11-10 · v0.129" />

**Question.** Some topics came out as "X's Y" pages, such as one page per property of one material. One X could end up with many small pages. If the AI is told to name a new topic after the thing itself and to put what a source says about it in that page's sections, do those pages stop appearing? Can the same rule be used when Graphium tidies up existing topics? And what happens when the library already has many "X's Y" pages?

**Short answer.** In these measurements, with no existing topics, "X's Y"-type titles went from 9% of the titles the AI created to 0%. When the list of existing topics already had many "X's Y" pages, both rules sent most of the source to revisions of existing pages, and the difference in newly created titles was not clear at this number of runs ("X's Y" titles were created in 3 of 6 runs with the old rule and 1 of 6 with the new rule, but that one run created 7 at once). After [Group pages by thing](/knowledge-layer#group-pages-by-thing) had been applied to the list, "X's Y" titles were created in 2 of 9 runs with the old rule and 0 of 9 with the new rule. For tidying up existing topics, the rule was not usable: it pointed many titles at merge targets that did not exist. So the rule is used only when a source is ingested.

## How I measured it

All four measurements were run on 2026-11-10 with `gpt-oss-120b`. Graphium v0.129.1 plus the rule change was run side by side with v0.129.1 without it, on the same input. Only the step that decides which topics a source goes to was called. No page body was written. No map of the whole source was added. The list of existing topics shown to the model had titles and types only, with no one-line definitions. The app's step that turns a "same title" create into a revision of the existing page was not run.

| | Existing topics shown | Sources | Runs |
|---|---|---|---|
| Measurement 1 | Empty at the start. Titles created in one window were added to the list for the next | 6 sources from my own library: 3 with many topics today (34, 30 and 28) and 3 with fewer (9, 8 and 8). 1,037 to 80,090 characters, 1 to 23 windows. Two long machine-learning papers, one medium-length metallurgy supplement, three short materials-science sources | 2 per condition (12 per condition) |
| Measurement 2 | Not a routing test. The titles of 401 existing topics were sent once to the step that proposes which titles to merge. Mapping only, nothing merged | the 401 titles | 1 per condition |
| Measurement 3 | The same 401 titles, with many "X's Y" pages among them | The 3 short materials-science sources (each fits in one window) | 2 per condition (6 per condition) |
| Measurement 4 | 329 titles: the 401 with a grouping run applied, in which the 72 pages absorbed by 14 groups were removed and 3 groups of general words were left out. The list was computed; no pages were actually merged | The same 3 sources | 3 per condition (9 per condition) |

## Results

**Measurement 1: no existing topics (12 runs per condition).**

| | Old rule | New rule |
|---|---|---|
| Titles created | 213 | 201 (-6%) |
| Titles containing "of" or "in" in the "X's Y" sense | 19 (9%) | 0 (0%) |
| Failed calls | 0 | 0 |
| Input tokens | 338,792 | 340,434 |
| Output tokens | 99,638 | 91,717 |

"X's Y" titles appeared only for two of the three short materials-science sources and, once or twice, for one of the long machine-learning papers. Even with the new rule, one run created a title per composition, and several runs created titles for a property alone (a general property name, not tied to one material). The number of titles for a small source swung from run to run: one source gave 11 titles with the new rule and 5 with the old rule in its second run.

An example, made up in baking words: the old rule gave "Rye sourdough fermentation time" and "Rye sourdough acidity". The new rule gives "Rye sourdough", "Fermentation time" and "Acidity".

**Measurement 2: tidying up 401 existing topics (mapping only, one run each).**

| | Old rule | New rule |
|---|---|---|
| Titles proposed to merge into another | 17 | 117 |
| ...of which the merge target is not an existing title | 0 | 41 (11 distinct targets) |

Today's merge keeps the first page of a group when the target page does not exist, and does not change its title. So the page for one property would absorb a dozen or more pages. This is the main reason the new rule cannot be used for tidying up. Most of the 117 were the rule working as intended, gathering pages under the thing. Only one group (7 titles) was clearly a gathering of pages that are not closely related. Time and token counts survive only in terminal output, not in the raw data (old: 68 s, about 22,000 tokens; new: 85 s, about 25,000).

**Measurement 3: the 401 titles shown as existing topics (6 runs per condition).**

| | Old rule | New rule |
|---|---|---|
| Existing topics sent to revision | 46 (31 of them "X's Y") | 42 (32) |
| New titles created | 9 (5 "X's Y") | 15 (7) |

"X's Y" titles were created in 3 of 6 runs with the old rule (5 titles in all) and in 1 of 6 runs with the new rule (7 titles). In that one run the new rule followed the existing style and created 7 titles in the "material's property" form at once. In another run the new rule created 4 titles for a property alone. By count the new rule produced more, by runs the old rule did, so 6 runs cannot say whether the new rule helped or not. What can be said is this much: when the library already has many "X's Y" pages, the new rule sometimes follows that style, and sometimes mixes in titles for a property alone.

**Measurement 4: after grouping (9 runs per condition).**

| | Old rule | New rule |
|---|---|---|
| Existing topics sent to revision | 54 (8 "X's Y") | 55 (8) |
| New titles created | 22 (9 "X's Y") | 19 (0) |

The old rule created "material's property" titles in 2 of 9 runs (4 and 5 titles) and none in the other 7. The new rule created none in all 9. What the new rule created were titles for a property alone and for methods. After grouping, "X's Y" titles became rare even with the old rule, which suggests that the existing titles pull the naming of new ones. What the new rule adds on top is the difference between 2 of 9 and 0 of 9, which is small at this number of runs.

## What I decided

- **The new rule is used only when a source is ingested.** It names new topics after the thing itself.
- **Tidying up existing topics keeps the old rule.** That covers "Organize topics" in Settings and the first step of "Tidy up for me" in Upkeep.
- **Existing "X's Y" pages are not changed on their own.** To bring them together, use [Group pages by thing](/knowledge-layer#group-pages-by-thing) in Upkeep first. In these measurements, "X's Y" titles were less likely with either rule once the list had been grouped (measurements 3 and 4).

## Limits

- At most 6 sources (3 in measurements 3 and 4), 2 to 3 runs, one model and one library. Measurement 2 was one run each.
- I measured only how titles are chosen. I did not measure the page text: whether a page for a thing gets too long, or whether a page for a property alone becomes a mix across materials.
- The list in measurement 4 was computed, not a library that was actually grouped. The app's Group pages by thing only covers topics made from sources; this computation was applied to all topics.
- The 3 sources in measurements 3 and 4 were already in the library. The list of existing topics included the pages made from those sources (close to ingesting them again).
- I measured without the map of the whole source, without one-line definitions and without the same-title step. The app adds some of these.
- "X's Y" titles were counted with a regular expression only, on the Japanese words for "of" and "in" in measurement 1 and for "of" alone in measurements 3 and 4. Patterns such as "X dataset" and English titles were not counted.
- The one group in measurement 2 counted as "not closely related" was my own judgement by eye.
