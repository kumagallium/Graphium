# Merging pages by thing: join, don't summarize <Badge type="info" text="Measured 2026-11-10 · v0.129" />

**Question.** [Group pages by thing](/knowledge-layer#group-pages-by-thing) in Upkeep puts pages whose titles read "X の Y" with the same X into one page. How should the bodies be combined: pass them through the existing AI body merge, or join them as they are, one section per page?

**Short answer.** In the two larger of these 3 groups, the AI merge left far fewer source marks and numbers with units. In the 27-page group characters fell to about a quarter, source marks to about 30%, and 22 of 54 kinds of numbers with units remained in the same notation. In the 6-page group source marks and numbers fell to about half. The 4-page group changed little: source marks went from 5 to 4. Joining kept every source mark, number and original line in all 3 groups. So the grouping does not use AI: each absorbed page's body becomes a `## Y` section as it is.

## How I measured it

Measured on 2026-11-10 with Graphium v0.129.2 plus the unreleased work on this feature. The model for the AI merge was `gpt-oss-120b`.

- I took 3 groups (37 pages) from my own library and copied them, with the sources they cite, into an isolated copy. The copy was rebuilt for each method. The real library was only read.
- The 3 groups: 27 pages (a page titled just X exists), 6 pages (same), and 4 pages (no page titled X, so the kept page is retitled).
- The 3 groups were picked by rule, not at random: the largest group, a small group that needs retitling, and a mid-size group with an X page.
- I ran each group from the Upkeep screen and compared the bodies before and after.
- What I counted: characters, source marks (`[[source:…]]`), original lines kept word for word, kinds of numbers with units (found by a regular expression; units K, °C, ℃, %, eV, W, GPa, MPa, nm, μm, µV, mW, h, min, at, mm, rpm, cm) and how many of them remained, and the number of `##` sections. A "kind" is a distinct string; "remained" means the same string appears after the merge.
- AI merge: the pages to be absorbed were passed 6 at a time and merged in turn.

## Results

Each cell lists the groups of 27 / 6 / 4 pages, in that order.

| | Before | AI merge | Join (first version) | Join (final) |
|---|---|---|---|---|
| Characters | 22,325 / 4,589 / 448 | 5,863 / 2,313 / 360 | 22,410 / 4,605 / 458 | 22,688 / 4,658 / 494 |
| Source marks | 204 / 40 / 5 | 60 / 19 / 4 | 204 / 40 / 5 | 204 / 40 / 5 |
| Kinds of numbers with units remaining | 54 / 9 / 0 | 22 / 4 / 0 | 54 / 9 / 0 | 54 / 9 / 0 |
| Original lines kept word for word | 229 / 41 / 9 | 34 / 8 / 5 | 229 / 41 / 9 | 229 / 41 / 9 |
| `##` sections | - | 3 / 3 / 1 | 3 / 2 / 0 | 27 / 7 / 4 |

- **AI merge.** The AI wrote the merged body anew, so the sections were only the fixed headings (definition, key points, disagreements), not one per property. The count of lines kept word for word is not itself a measure of lost information, because the AI rewrites. I look at the drop in numbers and source marks instead. A number whose notation changed counts as not remaining (the AI output for the 27-page group had 28 kinds of numbers with units, 22 of them in the original notation).
- **Join, first version.** Nothing was lost, but the sections were fewer than the pages. The existing step that removes "empty headings" before saving treated a `## name` heading followed directly by `### …` sub-headings as empty and deleted it.
- **Join, final.** The empty-heading check now goes by heading level, and headings inside a page are moved down so they sit under the section. Everything remained, and each absorbed page became a `##` section (the kept page's body is placed first as it is, not as a section; the section count includes the `##` headings it already had). The added headings make the result slightly longer than the originals.
- **Time.** The AI merge took a few minutes for the 3 groups (7 AI calls). Joining took a few seconds (no AI call). I did not record exact seconds.

## What I decided

- **Grouping uses no AI.** The kept page's body comes first, and each absorbed page's body follows as it is, as a `## Y` section. Headings inside are moved down so they sit under the section.
- **Passing absorbed pages to the AI in batches was not adopted.** The measurement passed 6 at a time; joining does not need it.
- **The empty-heading check is now by heading level.** This is used wherever topics are saved, not only in grouping.

## Limits

- 3 groups from one library, one run each, one model. All 3 are from the same field and their pages were written by the same model. The groups were picked by rule and include the largest one.
- The 27-page group was merged in 5 turns of 6 pages. Part of the drop may come from rewriting several times over (the 6-page group, merged in one turn, also dropped).
- Numbers were found by a regular expression, so only numbers with the listed units were counted. Numbers without units were not counted. A number whose notation changed counts as not remaining, so 22 is on the low side.
- I did not read the AI merge's output to judge whether what disappeared was repetition that was fine to drop or information that was needed. What I can say is that the numbers and source marks decreased.
- I did not measure how readable a joined page is. 27 pages joined come to about 23,000 characters.
- I did not rewrite the AI merge's instructions for joining and compare again.
- I did not measure what the AI does to a joined page when a new source is ingested into it later.
