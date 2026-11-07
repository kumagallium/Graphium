# Which AI feature needs which size of model? <Badge type="info" text="Measured 2026-11-07 · v0.124.1" />

**What we checked.** Graphium splits the jobs it gives an AI into five assignment slots (Default, Chat, Insight, World grounding, and the clean copy and summary of voice notes), and lets you pick a different model for each. But we had never measured which slot needs which size of model. The settings text described the default model as "a fast, cheap model is fine". So we listed every feature that calls an AI, slot by slot, and ran the same inputs through five models, from a top cloud model down to a ~10B model running on this computer, and compared them.

**In short.** The size needed differed clearly by slot.

- **Chat** (answers, checks, source checks, titles) is mostly fine at any size as far as quality goes. Even the ~10B model gave answers that could be shown as they are in 10 of 10. But the ~10B model is slow: titles and source checks take several minutes.
- **Default** handles Knowledge making, and also procedure extraction from papers, plan building and the plan's grounding check. `gpt-oss-120b` broke down on procedure links and plan building.
- **Insight** and the **voice-note clean copy** also needed a strong model.
- **World grounding** is the exception: the ~30B model on this computer scored the same as Claude Opus 5.

Based on this, the same change that adds this record reorganizes the assignment slots from per-feature into three tiers by how hard the work is (Default, Standard, Precise). See "Decision" at the end.

## How we measured

| | |
|---|---|
| Models | Claude Opus 5, Copilot's `gpt-5.6-luna`, `gpt-oss-120b` (through an OpenAI-compatible API), and on this computer `qwen3.6-35b-a3b` (~30B, MoE) and `qwen3.5-9b` (~10B). The models on this computer ran in LM Studio, loaded one at a time with a 65,536-token context and one parallel request |
| Machine | Apple M1 Max, 64 GB |
| Features | 18 kinds of work done by the five slots (table below). Inputs were copies of my own working notes and Knowledge (194 notes), 3 published papers, 3 meeting transcripts and so on. 1–16 items per task, once per model |
| Scored automatically | Tasks where mistakes were planted and we count how many were caught (checks, source checks, the plan's grounding check, insight duplicate detection, topic merging, world grounding), and tasks with a correct answer (procedure extraction from papers, name alignment). Procedure extraction used the [scoring by meaning](/evaluations/extraction-accuracy-by-meaning) |
| Scored by an AI | Making Knowledge, topic sorting and revision, insight extraction, translation, plan building, chat answers, clean copy, summaries, titles. The five outputs were shown as A–E with model names hidden, and an AI grader (Claude Sonnet) compared them with the source: faithfulness and coverage on a 1–5 scale, whether anything not in the source was asserted, and whether the output could be shown as it is. Failures (empty output, timeouts) were kept in the denominator as "cannot be shown" |

In the model guide in Settings, Opus 5 and `gpt-5.6-luna` count as "Top cloud" and `gpt-oss-120b` as "Open large".

## Results

Number of outputs that could be shown as they are (AI grading), and automatic scores.

| Slot | Task | Opus 5 | gpt-5.6-luna | gpt-oss-120b | ~30B | ~10B |
|---|---|---|---|---|---|---|
| Default | Making Knowledge | 5/5 | 5/5 | 4/5 | 3/5 | 2/5 |
| Default | Topic sorting and revision | 8/8 | 7/8 | 5/8 | 4/8 | 6/8 |
| Default | Procedures from papers (links F1, within range) | 0.77 | 0.78 | 0.31 | 0.56 | 0.45 |
| Default | Name alignment (of 25 pairs that should merge, how many merged) | 19 | 10 | 13 | 10 ¹ | 11 |
| Default | Translation | 3/4 | 4/4 | 3/4 | 3/4 | 1/4 |
| Default | Plan from an answer | 2/2 | 2/2 | 0/2 | 0/2 | 0/2 |
| Default | Plan's grounding check (planted mistakes) | 6/6 | 6/6 | 5/6 | 6/6 | 3/6 ² |
| Chat | Answers | 10/10 | 10/10 | 10/10 | 8/10 | 10/10 |
| Chat | Checks and source checks (planted mistakes) | 12/12 | 11/12 | 11/12 | 12/12 | 10/12 |
| Chat | Topic merging (planted duplicates) | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| Chat | Note titles | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 |
| Insight | Extracting findings | 4/4 | 4/4 | 0/4 | 2/4 | 0/4 ³ |
| Insight | Duplicate detection (12 pairs) | 12/12 | 12/12 | 11/12 | 12/12 | 12/12 |
| World grounding | Correct answers on 16 general-knowledge claims | 15 | 8 | 9 | 15 | 13 |
| Voice | Clean copy | 2/3 | 3/3 | 0/3 | 0/3 | 0/3 |
| Voice | Summary | 2/3 | 3/3 | 1/3 | 1/3 | 2/3 |

1. The ~30B model made 68 merges that are not in the answer key (it merged 1 of the 8 pairs that must not be merged). Merges not in the key were not penalized, but we have not checked whether they are reasonable. The same "10" means something different from `gpt-5.6-luna`'s.
2. One of the 6 did not finish in 15 minutes and was cut off.
3. All 4 did not finish in 15 minutes and were cut off. This is a matter of time, not quality.

**Time.** The median for making one piece of Knowledge was 74 s for Opus 5, 21 s for `gpt-5.6-luna`, 15 s for `gpt-oss-120b`, 104 s for the ~30B model and 205 s for the ~10B model (medians of successful calls only; for the ~10B model, the 3 left after excluding 1 empty output and 1 cut off). Compared with the ~30B model, the ~10B model took 1 to 56 times as long depending on the task (chat answers about the same, titles and name alignment about 50 times). The measurement set a 15-minute limit, and 8 calls of the ~10B model were cut off there.

## What we found

- **The Default slot covers a wide range and includes work that needs quality.** Despite the name, it handles procedure extraction from papers, name alignment, plan building from answers and the plan's grounding check. `gpt-oss-120b` was fine for making Knowledge and translation, but in procedure extraction it grew the operations in one paper to 33 and the links F1 (within range) fell to 0.31. Neither plan it built from an answer reached a quality that could be shown as it is.
- **The Chat slot is fine with a small model as far as quality goes.** For answers that open a note and ask a question, even the ~10B model gave 10 of 10 that could be shown as they are, and it did not make things up on the questions whose answer is not in the note (5). The ~30B model's 8/10 is one numeric error and one case where it answered "not there" about something that was in the note. Checks and source checks also caught 8 to 10 in 10 of the planted mistakes. But the ~10B model took about 3 minutes for a title and about 4 minutes for a source check.
- **Even so, Insight, World grounding, and clean copy and summary used the chat model when left empty.** Making chat a small model would also break finding extraction (~10B: all 4 timed out) and the clean copy (0/3). So the place an empty slot falls to is now the default model.
- **The clean copy changes what people said unless the model is strong.** `gpt-oss-120b` and the ~30B model replaced mishearings with other words or added things nobody said (one of the ~30B model's was cut off at the output limit). The ~10B model barely corrected anything in 2 of them, and 1 did not finish in 15 minutes. Even with Opus 5, the clean copy of the longest meeting (213 utterances) was cut off at the output limit. `gpt-5.6-luna` gave 3 of 3 that could be shown as they are, but in places it made guessed corrections or turned hesitant wording into flat statements.
- **World grounding is fine with the ~30B model on this computer.** The ~30B model judged 15 of 16 correctly, the same as Opus 5. `gpt-5.6-luna` and `gpt-oss-120b` marked 7 of 16 as "cannot judge". No model took a wrong claim as correct.
- **Size alone does not decide it.** Among cloud models, `gpt-5.6-luna` matched Opus 5 on many tasks while `gpt-oss-120b` broke down on procedures and plans. The model guide in Settings is shown by size class, but there are differences within a class.

## Problems found while measuring

- **If LM Studio is left at its default load settings, the Default slot's jobs do not run.** The ~10B model was loaded with an 8,192-token context and 4 parallel requests (about 2,000 tokens each), and even short inputs like name alignment failed with "context too small". Topic sorting passes every existing topic (414 in this measurement, about 40,000 tokens), so it does not run unless the context is widened.
- **There are paths where a failure looks like "nothing found".** Insight extraction, duplicate detection, checks and source checks can return an empty result when the AI call fails, so the caller does not notice the failure. There was also a case where the ~30B model's Knowledge making returned an empty output as a success. Topic merging returns failures in different ways depending on the case.
- **Failures of models on this computer come back as raw English text.** Model-swap conflicts and context shortages show only "Bad Request" or "Internal Server Error", with no cause.
- **The clean copy of a long meeting is cut off at the output limit even with a strong model.**
- **With a slow model, the clean copy and summary may be cut off at 5 minutes.** On the measuring tool's side, calls failed at the response wait limit (5 minutes), and we raised the limit and measured again. We have not yet checked whether the same happens on the path inside the app.

## Limits

- The number of items per task is small (1–16), once per model. In many tasks a one-item difference swaps the ranking.
- **We measured in two rounds.** In the first round, four groups of tasks used the same LM Studio at once, so many models on this computer failed. So we re-measured only the two models on this computer, loading one at a time. In the table, the automatic scores and times for the three cloud models are from the first round, and those for the two models on this computer are from the re-measured round (the inputs are the same; the cloud models were not re-measured). For AI grading, after the re-measurement we lined up all outputs again and graded everything again.
- **We changed the instructions to the AI grader in one place after seeing the first round's grading.** The change is that a generalization or interpretation drawn from the source does not count as made up if it is written so that it reads as inference (in the first round, 4 of Opus 5's 5 Knowledge outputs were marked as made up for this reason).
- **Some things were not fully hidden from the grader.** A failed output is shown as "failed", so the model can be guessed. The AI grader (Claude Sonnet) is in the same family as the Claude Opus 5 we measured, and the semantic matching for procedure extraction is also judged by Claude Opus 5. It may be lenient on Claude's output.
- **Some tasks have easy plants.** The check plants are rewrites of copied original pages, so they are easier to find next to the original. The 6 "same" pairs in duplicate detection are easy examples I made by rewording. Topic merging was a perfect score for all five models, a difficulty that does not separate them (this does not mean their ability is equal).
- **We did not check false alarms.** For the plan's grounding check, we did not audit whether the items raised on plans with no planted mistakes (5 for Opus 5, 7 for `gpt-5.6-luna`, 13 for `gpt-oss-120b`, 10 for the ~30B model) are real. In checks, the ~30B model raised a false alarm on 1 of 2 control pages, and in source checks the ~10B model did on 1 of 3 control places.
- **The answer key for name alignment was built from the merges of the previous extraction (which included Claude).** It may favor Opus 5.
- **The world-grounding claims are 16 pieces of general knowledge on bread-making, cooking and materials science.** Judgment also uses Wikipedia and OpenAlex search results, as the app does, so results can change with the time of search. We have not separated whether the many "cannot judge" results from the two mid models come from the models or from how they work with search.
- The 15-minute cut-off is a limit on the measuring side, not the app's limit.
- The values for models on this computer are for an M1 Max (64 GB). On a computer with less memory, the ~30B model will not run or will be slower.
- Most inputs are my own materials research notes. Results may differ in other fields.
- "Look into it carefully before answering" is not in this measurement (see [a separate measurement](/evaluations/research-before-answering)).

## Decision

- The slots are now three tiers by difficulty instead of per feature. **Default** is light work (chat, checks, source checks, topic merging, titles, world grounding); **Standard** is Knowledge making, translation, topic routing and revision, and type tagging; **Precise** is procedure extraction and name alignment, plans and their grounding check, insight discovery, and voice-note clean-up and summaries. Left empty, Precise uses the Standard model and Standard uses the Default model.
- Only chat can be overridden, under **Per feature** (left empty, it uses the default model). World grounding always uses the default model, since the ~30B model on this computer scored the same as the top models, so it counts as light work. Voice-note clean-up and summaries use the precise work model unless set separately. The insight model is gone, folded into the precise work model.
- The descriptions changed too. Default says "light work; a fast model, or one on this computer, is enough", and Precise says "a strong model is a good fit". This follows from the measurement: chat and world grounding were fine on small models, while procedure extraction, plans, insights and clean-up needed a strong one.
- Existing settings are moved over once. The old chat model becomes the new default, the old default becomes Standard (if it differed from chat), and the old insight model becomes Precise. Chat, checks, source checks, and the adding to Knowledge and translation the old default handled keep using the same model before and after the move. If you had set an insight model, procedures and plans now run on it too. If you had set a separate world-grounding model, world grounding now uses the default model. For voice note clean-up and summaries, anyone whose model would change gets the old model written into that field, so it stays the same.
- Under each tier in [Settings](/settings), a model guide (top cloud, open large, this computer ~30B, ~10B) shows good fit, conditional or poor fit.
- Of the problems found, the paths where a failure looks like an empty result, and the error text of models on this computer, will be fixed separately.
