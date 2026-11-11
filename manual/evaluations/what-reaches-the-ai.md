# Do topics and insights reach the AI's answers? <Badge type="info" text="Measured 2026-11-10 · v0.129" />

**Question.** Chat answers seemed to cite claims every time. Are topics and insights dropped at the search step? Do they reach the AI and go uncited? Or does it depend on how the question is asked?

**Short answer.** In these measurements it depended on which page the question names. When a question contained a topic's title, the body of that topic reached the AI in 32 to 36 of 40 questions. When it contained a claim's title, the AI received 7.5 to 8.0 claims and 0.4 to 0.5 topics per question. When it contained an insight's title, that insight ranked first in all 40 questions. Asking "What is X?" or "Is it true that X?" made little difference. In the questions where the target page arrived, the answer cited it almost every time (citations were checked on a subset of the questions). I did not change the search or citation rules. The measurement turned up two small gaps, and one of them was fixed after this measurement.

## How I measured it

On 2026-11-10 I used my own library, read-only. It holds 2,624 knowledge pages (1,885 claims, 442 topics, 183 insights and 114 older-format summaries), which split into 5,485 sections, the unit that search works on.

What I measured is the cross-search that runs when the grounding scope is **Internal** or **External** (and when you chat without a note open). With the default scope, **This note**, that search does not run.

**What reaches the AI.** Section extraction, the full-text index, rank fusion and the step that packs passages into 2,000 characters were called from the app's own code (v0.129.4). For the search by meaning, I embedded the 5,485 sections again with `bge-m3`, the app's default. As [How search works](/how-search-works) describes, the top 20 by words and the top 20 by meaning are fused, and passages are taken from the top until 2,000 characters are full.

**What the AI cites.** Each context built that way was sent once to the same endpoint the chat uses (v0.129.6), with no tools and with "research before answering" off. I counted the citation numbers in each answer against the type of the passage each number stood for. The models were `gpt-oss-120b` (80 questions) and Claude Opus 5 (32 questions).

**Questions.** They were generated mechanically from the titles of randomly chosen pages.

| | Pages they came from | Form of the question | Reach step | Citation step (gpt-oss / Opus) |
|---|---|---|---|---|
| A | 40 topics | "What is (title)?" | 40 questions | 20 / 8 |
| B | The same 40 topics | "Summarize what is known about (title)." | 40 questions | 20 / 8 |
| C | 40 claims | "Is it true that (title)? Give the evidence too." | 40 questions | 20 / 8 |
| D | 40 insights | Same form as C | 40 questions | 20 / 8 |
| E | The same 40 claims as C | Same form as A ("What is (title)?") | 40 questions | — |
| F | The same 40 topics as A | Same form as C ("Is it true that (title)? …") | 40 questions | — |

In bread-making terms, A is like "What is rye sourdough starter?" and C is like "Is it true that a starter ferments faster at 28°C?" E and F swap the pairing of title and form. I added them to separate the effect of the form from the effect of the type of title. The citation step used only the first questions of each set. The questions were asked in Japanese.

## Results

**Reach step: passages handed to the AI per question (mean of 40 questions each).**

| | Topics | Claims | Insights | Summaries | Questions where the body of the target page arrived |
|---|---|---|---|---|---|
| A Topic title, concept form | 3.0 | 2.1 | 0.0 | 0.1 | 36 / 40 (ranked first after fusion in 34) |
| B Topic title, summary form | 2.5 | 1.2 | 0.0 | 1.3 | 33 / 40 (first in 28) |
| C Claim title, fact form | 0.4 | 7.5 | 0.1 | 0.3 | — (at least one topic arrived in 13 / 40) |
| D Insight title, fact form | 0.1 | 2.8 | 3.7 | 0.7 | 40 / 40 (first in all) |
| E Claim title, concept form | 0.5 | 8.0 | 0.1 | 0.1 | — (at least one topic arrived in 11 / 40) |
| F Topic title, fact form | 2.4 | 1.6 | 0.1 | 1.2 | 32 / 40 (first in 30) |

With the same form, a claim's title brought claims (A and E) and a topic's title brought topics (C and F). What matters is not the form but which pages the words of the question overlap with.

In C, there were 3.5 topics per question among the fused candidates. But a claim is short (a median of about 150 characters), so seven or eight claims fit into 2,000 characters, and the packing often ended before it got down to where the topics ranked.

**Citation step: passages the answer cited, out of the passages handed over.**

| | `gpt-oss-120b` topics | claims | insights | Opus 5 topics | claims | insights |
|---|---|---|---|---|---|---|
| A | 34 / 64 | 26 / 53 | — | 11 / 18 | 16 / 25 | — |
| B | 35 / 50 | 24 / 26 | — | 10 / 16 | 12 / 12 | — |
| C | 0 / 3 | 104 / 155 | 1 / 3 | 1 / 1 | 55 / 59 | — |
| D | 0 / 2 | 19 / 55 | 44 / 78 | 2 / 2 | 17 / 26 | 19 / 21 |

Of the questions where the target page arrived, these are the ones where the answer cited it.

| | `gpt-oss-120b` | Opus 5 |
|---|---|---|
| A (topic) | 18 / 19 | 8 / 8 |
| B (topic) | 17 / 18 | 7 / 8 |
| D (insight) | 20 / 20 | 8 / 8 |

A target topic that arrives is nearly always cited. Counted by section, 50 to 70% of the topic sections that arrived were cited, about the same as the claims in the same questions. In C and D, topics arrived in only 5 questions (`gpt-oss-120b`) and 3 questions (Opus 5) in total, so whether they were cited there says nothing.

**The effect of length.** The "Key points" section of a topic had a median of 566 characters, and 69 of 437 (16%) were longer than 2,000. When a passage does not fit into the 2,000 characters, the current code stops packing at that point. That is why the target topic did not arrive in 2 questions of A and 3 of B.

**Gaps found.**

- **Stopping at a long section (fixed).** When a section did not fit into the 2,000 characters, packing stopped there. If the section ranked first after fusion was long, no knowledge reached the AI at all. That happened in 6 of the 240 questions.
- **A topic's References section gets matched (not fixed).** That section is only a list of source names. It matched the search and arrived in place of the body of the target topic in 1 question of A and 3 of B.

**The size of the context.** The input for one answer had a median of 64,074 tokens (`gpt-oss-120b`) and 84,749 tokens (Opus 5). Besides the passages chosen by search (up to 2,000 characters), the AI also receives a list of the titles of every knowledge page. For 2,624 pages that list was 88,577 characters, which was most of the context. Opus 5 often cited claims from that list by title alone (59 claims over 32 questions; `gpt-oss-120b` cited only 2 topic titles that way over 80 questions).

## Decision

- **The search and citation rules stay as they are.** No per-type quota, and no priority for topics. With the current rules, the type that fits the question already ranks at the top.
- **To have a topic cited, ask by the topic's name.** When the question had the words of a topic's title in it, that topic arrived whatever the form. Asking with a sentence that states one fact brings the claims close to that sentence. [AI chat & ask](/ai-chat-and-ask) now links to this record.
- **Stopping at a long section gets fixed.** See "Fixed afterwards" below.
- **The References section and the size of the title list were measured again separately.** Just dropping References sections from the search results did not bring the body of the target topic in more questions, and in the questions where that section was the only match, the topic's title stopped arriving. The follow-up is in "The two items left open, measured again" below.

## Fixed afterwards

A section that does not fit is now cut at 700 characters and tried again, and if it still does not fit it is skipped and packing goes on to the next section. A section that fits as it is does not get cut. These are the same 240 questions packed with the code before and after the fix.

| | Before | After |
|---|---|---|
| Questions where the body of the target topic arrived (A / B / F, 40 each) | 37 / 33 / 32 | 39 / 37 / 36 |
| Questions where no knowledge arrived at all (of 240) | 6 | 0 |
| Passages handed over per question (range of the means of A to F) | 5.1 to 8.7 | 6.6 to 9.6 |
| Sections that arrived before the fix and no longer arrive | — | 0 of 1,596 |

This table counts by matching titles, so "Before" for A is one question higher than in the table above (36, counted by ID). 46 sections were cut across the 240 questions. The rest of a cut section does not arrive. When you need it, let the AI read the whole page with "research before answering", or cite the page with `@`. The citation step was not measured again with the fixed code.

## The two items left open, measured again

On 2026-11-11 I measured the two open items again with the same 240 questions. The search rules and the list itself stay as they are. Only the way the list is sent changed.

**The References section.** Today 123 References sections arrive over the 240 questions. I repacked with two other ways of handling them.

| | Today | Drop it when the same topic's body is among the candidates | Drop it, or swap it for the body |
|---|---|---|---|
| Questions where the body of the target topic arrived (120 questions in A, B and F) | 111 | 111 | 113 |
| Sections that newly arrive | — | 92 | 92 |
| Body sections that arrive today and would stop arriving | — | 44 | 47 |
| Pages whose title would stop arriving altogether | — | 46 | 50 |
| Passages per question (A) | 6.7 | 6.0 | 6.0 |

A short References section gets replaced by a long body, so fewer passages fit and other sections are pushed out. The passages are reshuffled, and the target body barely arrives more often. The handling of this section stays as it is.

**The title list.** Of the roughly 89,000 characters in the list, claim titles take 74,000 (1,885 claims). The rest is topics at 9,000 (442), insights at 6,000 (183) and source summaries (14). Going back over the 32 Opus 5 questions, 57 pages were cited from the list by title alone (in 13 questions, 55 of them claims). That is the "59 claims" above with repeats inside one answer removed. Another 9 citations named a title that is not in the library. Of those 57, only 8 were in the top 20 sections of the semantic search, and 37 even when widened to the top 200. Opus 5 was finding claims in the list that search had not picked up. `gpt-oss-120b` did that twice, both in 1 of its 80 questions. I did not measure how answers change with a shorter list, but most of the pages Opus 5 cited from the list were not among the search candidates, so I expect those citations to drop. The list is not shrunk.

**How the list is sent.** For Claude models, the part that does not change (the instructions through the title list) and the passages that change with each question were sent as one block. When the question changed, the whole block became different, so a request almost always wrote to the cache without reading from it (31 of the 32 questions above: about 84,000 tokens written, 0 read. The remaining one got the same passages as the question before it, and the whole prompt was read). The block is now split in two right after the title list. Not one character of the text sent has changed. With the fixed code I sent four different questions in a row to Opus 5.

| Question | Input tokens | Of which read from cache | Of which written to cache |
|---|---|---|---|
| 1st | 83,234 | 0 | 83,213 |
| 2nd | 83,241 | 83,213 | 0 |
| 3rd | 84,902 | 80,204 | 4,649 |
| 4th | 84,889 | 80,204 | 4,645 |

The 2nd question happened to get the same passages as the 1st, so the whole prompt was read (this also happens without the fix). In the 3rd and 4th, everything through the title list (80,204 tokens) was read and only the per-question part was written. Counting a read at 0.1 times the normal price and a write at 1.25 times, the input cost of the 3rd and 4th questions is about 13% of what it was before. The 1st question costs the same as before.

- The cache expires after 5 minutes. A question asked more than 5 minutes after the previous one costs the same as before. When knowledge pages are added, removed or updated the list changes, and the next question is a write. A question that brings in a legacy Idea page is also a write, because one line of explanation is added (no Idea page was in the contexts used here).
- The four questions were measured by sending prepared contexts straight to the API. Questions asked from the app screen were not measured.
- Only the way prompts are sent to Claude models changed. How prompts are sent to other models is unchanged (`gpt-oss-120b` read 0 over its 80 questions before the fix).
- The size of the list itself has not changed. More pages mean more input. For a model with a small context, the list will eventually stop fitting, and that is still open.
- That answers do not change was checked by the text sent being identical (a test). I did not run a measurement comparing answers.

## Limits

- The questions contain the title string itself. That is the easiest condition for every type. I did not measure reworded questions, or questions from someone who does not know the titles. Which type arrives for a question that overlaps with no page title is unknown.
- The ranking shifts slightly each time the embeddings are made again (about 0.1 passages in the means of the table). The reach table is from the last run, and the citation step used the contexts built in the first run.
- One library, and one answer per question. Opus 5 had 8 questions per set, which is too few to compare rates.
- Only knowledge pages went into the full-text index. The real app puts notes and assets into the same index, so word weights differ a little. The passages from notes and assets (a separate 1,600 characters) were left out of the context.
- The embeddings the app has stored could not be read, so they were made again with the same model. With an API embedding model the ranking would differ.
- Some citations could not be matched to a number or title that was handed over: 10 from Opus 5 and 1 from `gpt-oss-120b`. I did not look into them.
- I did not check whether the citations are right (whether the cited passage supports the sentence). I counted only which type was cited.
