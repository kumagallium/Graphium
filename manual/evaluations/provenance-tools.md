# Provenance tools: do they answer step and lineage questions? <Badge type="info" text="Measured 2026-11-05 · v0.120.4" />

**Question.** With [Research before answering](/ai-chat-and-ask#letting-the-ai-search-again) on, the AI can search again by words and meaning and read whole pages. It can also follow what is recorded about where things came from, with three provenance tools: find the notes that label a given material or tool, read a note's steps in order, and trace what a note was built from and what was built from it. Do these tools give better answers than searching again alone?

**Short answer.** On a copy of my own notes, Claude Opus 5 went from 16 to **22 out of 22**. The gain was on questions like "which notes used this instrument or material?". Searched by words, those notes are buried among many others. From the labels, they come straight back. The other two models were within 1 point of search again. On the sample notes, every model at first left out recorded links when asked about a note's lineage. After I changed how @ links are read, the links Claude left out with provenance went from 5 to 0. For the other two models, no clear change showed.

## How I measured it

| | |
|---|---|
| Notes | Two sets. (1) A copy of my own working notes: 180 notes and 2,375 knowledge pages. Most of the notes with step and material labels are experimental procedures brought in from papers. Because they are private, the questions and answers are not published here. (2) The samples that come with the app (curry and bread, 24 notes and 167 pages). Their questions are listed below |
| Version | My own notes were measured on v0.120.0, the samples on v0.120.4 (after the change to how @ links are read). The samples were also measured on v0.120.0, to compare before and after. Only the 5 questions on @ connections between my own notes used a copy taken the next day (189 notes and 2,392 pages), with embeddings for every page, on the development build with #1509 |
| Search | Words (BM25) plus meaning with `multilingual-e5-large` through an API |
| Conditions | Three. **Off** = only the single search that always runs first. **Search again** = only the tools that search by words and meaning and read pages. **With provenance** = search again plus the provenance tools (the same as turning the setting on in the app). Each question was asked three times in a row in new chats, and the order of the conditions changed from question to question |
| Questions | 11 on my own notes: notes that used a tool or material (3), step conditions (2), order of steps (1), comparison (1), tools used (1), what was made (1), answer not in the notes (2). 11 on the samples: lineage and its upstream and downstream (5), step conditions (2), comparison (2), answer not in the notes (2). The questions on my own notes are all in Japanese; the samples have 6 in Japanese and 5 in English |
| Models | Claude Opus 5, GitHub Copilot `gpt-5.6-luna`, and `gpt-oss-120b` (an open model used through an OpenAI-compatible API) |
| Grading | The three answers were shown as A, B and C, without saying which condition each came from. A separate AI grader checked them against the original notes. 2 = correct with nothing missing, 1 = partly correct, 0 = wrong, no answer, or empty. Lineage questions were graded on whether every recorded link was named. An answer that left out a recorded note, even for a plausible reason, got 1. Answers that stated things the notes do not say, and answers that left out recorded links, were also flagged |

## Results

**My own notes (11 questions, 22 points)**

| Model | Off | Search again | With provenance | Stated things not in the notes (off → search again → with provenance) | Median time (with provenance) |
|---|---|---|---|---|---|
| Claude Opus 5 | 8 | 16 | **22** | 0 → 0 → 0 | 21 s |
| Copilot gpt-5.6-luna | 11 | **19** | 18 | 1 → 0 → 0 | 11 s |
| gpt-oss-120b | 13 | 18 | **19** | 5 → 3 → 1 | 8 s |

By kind of question (off / search again / with provenance):

| Kind | Claude | Copilot | gpt-oss |
|---|---|---|---|
| Notes that used a tool or material (3) | 0 / 1 / **6** | 0 / 3 / 4 | 0 / 3 / 3 |
| Step conditions (2) | 0 / 4 / 4 | 2 / 4 / 4 | 4 / 4 / 4 |
| Order of steps, comparison, tools used, what was made (4) | 4 / 7 / 8 | 5 / 8 / 6 | 5 / 7 / 8 |
| Not in the notes (2) | 4 / 4 / 4 | 4 / 4 / 4 | 4 / 4 / 4 |

**Samples (11 questions, 22 points; measured on v0.120.4, after the change to how @ links are read)**

| Model | Off | Search again | With provenance | Recorded lineage links left out (off → search again → with provenance) |
|---|---|---|---|---|
| Claude Opus 5 | 17 | **21** | 20 | 4 → 1 → **0** |
| Copilot gpt-5.6-luna | 15 | **18** | 16 | 4 → 2 → 3 |
| gpt-oss-120b | 15 | 14 | **16** | 3 → 3 → 3 |

Before the change, on v0.120.0, Claude scored 16 to 17 in all three conditions and left out recorded lineage links 5 times in each.

**@ connections between my own notes (5 questions, 10 points; measured on the development build after v0.120.8, with #1509)**

These are everyday links, such as meeting notes that point back to the previous meeting with @. The questions asked what a note was based on, or which notes were written from it.

| Model (after the fix for missed links, #1518) | Off | Search again | With provenance |
|---|---|---|---|
| Claude Opus 5 | 0 | 5 | **6** |
| Copilot gpt-5.6-luna | 0 | 3 | **7** |
| gpt-oss-120b | 0 | 1 | 0 |

Before the fix (same questions): Claude 0 / 3 / 6, Copilot 0 / 4 / 3, gpt-oss 0 / 0 / 0.

These scores are far lower than on the other questions. One reason was that the tool missed links (see "Found along the way" below). Before the fix, of the 13 answers that scored 0 or 1 with provenance, about half read as the tool missing links. In the rest, the model could not find the note by its title (3 answers), added notes that are not recorded, or followed the links the wrong way. Questions that go back two steps stay hard even after the fix, because the tool returns connections only one step away.

After the fix, the question whose links had been missed went from 0 to 2 for Claude and Copilot with provenance. A loss that stood out was an answer that named the connections and then concluded there was nothing upstream. An @ connection has no direction, so when asked "which notes is this based on?", the model has to decide the direction from dates or text, and it sometimes would not call them the source.

## What I learned

- **The provenance tools can help where words cannot reach.** On the three questions of the form "which notes used this instrument or material?", Claude scored 0 with search off and 1 with search again. With provenance, it got all three. Copilot (3 → 4) and gpt-oss (3 → 3) hardly changed. The names of instruments and materials appear in many notes, so a word search buries the ones you want. The labels lead straight to them.
- **On my own notes, `gpt-oss-120b` stated fewer things the notes do not say.** It did so 5 times with search off, 3 times with search again, and once with provenance. When the steps arrive as recorded, the model may have less room to fill in the gaps. On the samples, though, it did not go down (3 → 5 → 3), and the other models were at 0 or 1 to begin with.
- **How the AI reads lineage depends on what the links mean.** In the samples, lineage is written as @ links in the note body. The app used to read an @ link as "this note was derived from that one", so pointing back to an earlier trial with @ turned the direction around. The AI then said there was nothing upstream, or listed upstream notes as downstream. Now an @ link is passed as a "connection" without direction. Only derivations and step links carry a direction. After the change, the links Claude left out went from 5 to 0 with provenance and from 5 to 1 with search again. For Copilot and gpt-oss, no clear change showed. Each question was asked once, so do not read much into the gap between 0 and 1.
- **Models sometimes put their own judgement above the record.** One answer with search off, using no tools, left a recorded trial out of the lineage because it had burned and was a failed branch. It sounds reasonable, but it disagrees with what is recorded.
- **With Copilot, adding the provenance tools did not help.** Search again alone already reached 19, and with provenance it answered some questions while hardly calling any tools.
- **It is not much slower.** On my own notes, the median time with provenance was a little shorter than with search again (Claude 28 → 21 s, Copilot 12 → 11 s, gpt-oss 10 → 8 s). I think that is because when one tool call reaches the target, the AI searches again less. On the samples, Copilot (6 → 10 s) and gpt-oss (5 → 7 s) took a little longer.

So the provenance tools stay part of Research before answering. With a model like Claude Opus 5 and many notes with labeled steps, I expect there are times they help.

## Sample questions

The samples are the same notes as the app's sample mode (curry in Japanese, bread in English).

| | Kind | Question |
|---|---|---|
| d01 | Lineage | 「試作6 トマトを2個に増やす」は、どの試作を元にしていますか？最初の試作までさかのぼって挙げてください。 |
| d02 | Downstream | 「試作3 玉ねぎを45分炒めて飴色に」を元にして書かれたノートをすべて挙げてください。 |
| d03 | Step conditions | 試作7 で玉ねぎを炒めた工程の条件（火力・時間・差し水）を教えてください。 |
| d04 | Comparison | 試作3 と試作7 は、工程の条件と材料のどこが違い、仕上がりはどう違いましたか？ |
| d05 | Upstream | 「読書メモ スパイスの香りと加熱」は、どの試作のノートを元にしていますか？ |
| d06 | Not in the notes | 試作3 で使った調合スパイスの中身（クミンなど各スパイスの量）を教えてください。 |
| d07 | Lineage | Which trials does "Trial 6 - replacing 30% with whole wheat" build on? Trace it back to the first trial. |
| d08 | Downstream | Which notes were written on top of "Trial 3 - 75% hydration, bread flour"? List them all. |
| d09 | Step conditions | What were the bulk fermentation conditions in Trial 3? |
| d10 | Comparison | How do Trial 3 and Trial 7 differ in process and ingredients, and what were the loaf heights? |
| d11 | Not in the notes | What brand and model of oven was used in Trial 4? |

## Limits

- There are not many questions (11 on my own notes, 11 on the samples). One question can move a total by up to 2 points, so read the totals as a trend. Each question was asked only once per condition.
- Asking again and grading again move a score by about 1 point. Search off uses no tools, so it should not be affected by the version. Between the two versions, it still moved by 1 point for two of the three models.
- The labeled notes in my own set are procedures brought in from papers. I have not yet measured whether the same holds for experiment notes I wrote myself.
- My own notes were measured before embeddings for search by meaning were in place for every page. The off scores may be lower than they would be with every page in place.
- The 5 questions on @ connections between my own notes were asked and graded separately before and after the fix. Each was asked once, so the difference also includes the variation from asking again.

## Found along the way (fixed since)

- **@ links were read in the wrong direction.** As described above. An @ link is now a connection without direction (v0.120.2).
- **When the AI used up its steps, the answer came back empty.** This happened twice with `gpt-oss-120b` in the measurement on my own notes (v0.120.0). It is the same fix as in [Research before answering: does it help?](/evaluations/research-before-answering): there is now one last turn that answers from what was found, without tools.
- **On a large set of notes, the tab crashed while rebuilding embeddings.** The rebuild now runs to the end (v0.120.4).
- **On a large set of notes, the tools went past the 30-second limit.** The first time I ran the 5 questions on @ connections between my own notes, 11 of 45 runs gave no answer because of it, and 1 more answered while saying a tool had timed out. The cause was not the tools' own work. When a large file was skipped, its connection was left open; these piled up each time a tab opened, and blocked the channel that carries the tools' results back. After the fix it happened in 0 of 45 runs (#1509).
- **The lineage tool missed the links of notes not yet opened.** The tool read the links a note makes to other notes from that note's content as loaded in the app. For a note not yet opened, it saw only the links coming in from other notes. So for some questions it said there were no links when links were recorded. It did not happen on the samples, which are small enough to be loaded in full. The tool now reads the links of notes not yet opened from the index (#1518).

The fixed versions are in the [release history](/release-history).
