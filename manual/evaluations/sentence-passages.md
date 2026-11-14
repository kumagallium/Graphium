# Keeping the source passage behind each topic sentence <Badge type="info" text="Measured 2026-11-14 · v0.132" />

**Question.** A topic page rewrites what its sources say in its own words, so a sentence can't simply be matched against the source text. What if the AI that writes the sentence also copies, inside the citation, the passage of the source it is restating, word for word? Graphium could then check that passage against the source with a plain string match, the same result every time. A passage that isn't there would expose a citation that points to the wrong place. A passage that is there would tell you where in a PDF to look. Can the model copy passages exactly, and what does it cost?

**Short answer.** Yes, mostly. With the final instructions, 99% of the passages (72 of 73) were found in the source text. The one that wasn't had a word "corrected" by the model. Asking for passages did not consistently reduce the number of points on the page. There were more cited sentences with passages in runs 1 and 2 and fewer in run 3 (231 without and 252 with, over three runs). It did cost about 1.5 to 1.8 times the output tokens. Topic and Q&A page revisions now ask for a passage on every citation. Before the page is saved, Graphium removes any passage it can't confirm.

## How I measured it

All runs were on 2026-11-14 with `gpt-oss-120b`. Two copies of Graphium ran side by side on the same input. Both were v0.132 with the change that keeps another source's sentences when a topic is revised. One of them also had the passage instructions. Only the step that rewrites a topic from one source was called. Routing and the map of a long source were not used.

| | |
|---|---|
| Sources | 6 from my own library: 3 long machine-learning papers (PDF, the first 3 windows of each) and 3 notes (about 2,700 to 21,000 characters) |
| Topics | For each source, 2 existing topics that cite it (12 chains) |
| One chain | Start from an empty page and revise it with each window of the source in turn |
| Runs | 3. The third used the final instructions, which add "copy one continuous stretch, never skip words with …" and say that passages are checked before saving |

The same string match the app uses decided whether a passage was "found". It ignores case, spacing and line breaks, and full-width versus half-width characters and ligatures (Unicode NFKC). It also ignores dash shapes and any hyphen between two Latin letters, so a word split at the end of a PDF line still matches. Reference numbers such as [8] are ignored too, and so is `. , ; : ! ?` at the very end of the passage. It does not ignore rewording or text skipped with "…". The length is counted after all this; a passage under 8 characters is never counted as found.

## Results

| | Run 1 | Run 2 | Run 3 (final) |
|---|---|---|---|
| Cited sentences: without / with passages | 67 / 83 | 81 / 98 | 83 / 71 |
| Citations that carried a passage | 100% (85/85) | 100% (98/98) | 100% (73/73) |
| Passages found in the source | 94% (80/85) | 97% (95/98) | 99% (72/73) |
| Sentences with numbers whose numbers all appear in the passage | 93% (43/46) | 81% (30/37) | 74% (26/35) |
| Passages the model kept word for word when the next window was folded in | 97% (72/74) | 97% (72/74) | 98% (61/62) |
| Output tokens: without / with passages | 30,520 / 53,975 | 34,564 / 60,789 | 35,321 / 51,483 |

- The number of points swung more between runs than between the two conditions. Run 3 alone had fewer cited sentences with passages (71 against 83), so a small loss can't be ruled out at this number of runs.
- No citation in either condition pointed to a source other than the one being read.
- Some calls failed in both conditions equally (10 or 11 of 28 each). All of them were PDF windows that had nothing about the topic. The model returned an empty page, as instructed. During ingestion this doesn't happen, because a topic is only revised with the windows the routing step picked for it. When a topic is rebuilt from its sources, every window is read, and a window like this is skipped.
- What the model changed in the passages that weren't found: twice it used "…" in runs 1 and 2 (once to join two places), which the final instructions stopped. It also merged two places into one sentence, and in run 3 it "corrected" an apostrophe. Formatting differences were absorbed by the matcher: PDF line-break hyphens, dash shapes, a dropped reference number, a changed final comma.

**Fixed while measuring.** Passages from papers often contain brackets, as in "[12]". The first version of the citation pattern couldn't read a citation whose passage had a "]" in it, or one whose passage ended with "]". In the app, such a citation would have been lost from the page or cut short. The pattern now reads both. The only thing a passage can't contain is the closing "]]".

**Fixed after review.** A long source is read one window at a time. A passage copied from an earlier window isn't in the next window's text, so the first version of the check removed it at the next window. Now a passage that was already on the page for the same source is kept. Merging topics didn't check passages at all. Now a merge keeps a passage only if it was on one of the merged pages.

## What I decided

- Topic and Q&A page revisions ask for a passage on every citation, on by default, with no setting. Before saving, each passage new to the page is checked against the source text that was read, and the ones that can't be found are removed. The citation itself stays, and the source check judges that sentence as before.
- A passage stays with its sentence through later revisions and merges, as long as the model copies it unchanged. A passage it changes is removed, because it can no longer be confirmed. So every passage on a page was found in its source when it was first written.
- Clicking the `@source` mention after a sentence opens a PDF at that passage. In the source check, the stored passage becomes the quote when three things hold. The AI returned no quote. The verdict is not *Not in source*. And the passage is found in the source text. The verdict itself is not changed.
- Because of the token cost, only these revisions ask for passages. Source summaries and the first write of a Q&A page from a chat answer don't ask for them.


**Changed later.** In the next release, a passage that can't be found is no longer removed. It is kept with a mark, the page shows *(the passage the AI copied isn't in the source)* after the sentence, and the source check details show it. Passages are now also checked against the source's whole text, so a passage from a note that was edited afterwards is caught too.

## Limits

- One model only (`gpt-oss-120b`). Claude and Copilot models were not measured.
- 6 sources, 12 chains, 3 runs. The PDFs were three machine-learning papers, first 3 windows only. Heavy tables and two-column layouts were not tested separately.
- Whether a passage is the right evidence for its sentence was not measured directly. As a stand-in, I checked whether the sentence's numbers appear in the passage: 74% to 93%.
- The run counts above are what the model wrote. The fixes after review change what the app keeps, not what the model writes.
