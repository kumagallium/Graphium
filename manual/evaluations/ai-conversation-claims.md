# Insights from AI conversations <Badge type="info" text="Measured 2026-11-18 · v0.141.2" />

**Question.** I measured this before building it, for an upcoming "AI conversations" import: putting a record of a conversation with Claude Code or a similar tool into Graphium as a source, and making insights from it. **The app at the time of measurement (v0.141.2) does not have this feature yet.** The intake screen came in afterwards ([Bring in AI conversations](/materials-and-citations#bring-in-ai-conversations)). Making knowledge from a conversation is not there yet. What follows are measurements of two things I wanted to settle before implementing it.

- If the claim instructions are changed only when the source is a conversation, do the claims come from the user's own words?
- How long does the excerpt of the AI's replies in the source need to be?

**Short answer.**

- Adding one section to the claim instructions raised claims grounded only in the user's own words from 69% to 85%. I decided to add it, and the app now uses it when the source is a conversation.
- The AI excerpt stays at the first 200 and last 300 characters. Shortening it showed no readable difference in how many of the user's points were picked up, and fewer of the user's lines could still be understood.
- The one short conversation with a single user line gave 0 claims in all 6 combinations.
- Each combination was run once, and run-to-run variation is large, so read the differences as rough guides ([Limits](#limits)).

## Shape of the source

- The user's own lines go in verbatim and in full.
- The AI's replies go in as an excerpt of the reply just before, only to recover what the user was responding to.
- In this measurement, lines longer than 700 characters were left out of the source, to keep requests written by another conversation from being counted as the user's own. That also drops long lines the user did type, so the implementation revisits this rule.

An example, made up in baking words:

```
## 2026-10-05

- AI (excerpt of the previous reply): Rye sourdough turns sour after about 8 hours at 25°C. You can also stop at 6 hours. Which would you like?
- Me (09:12): I want it mild, so I will stop at 6 hours
- AI (excerpt of the previous reply): I changed the fermentation to 6 hours. Shaping comes next. Shall I go on?
- Me (09:20): Please go ahead
```

"I want it mild, so..." is a judgment with a reason. "Please go ahead" is an instruction only.

## How I measured it

Three axes, 2 × 3 × 3 = 18 runs, one run per combination.

| Axis | Conditions |
|---|---|
| Claim instructions | A = as they are (the v0.141.2 task unchanged) / B = A plus one section |
| Length of the AI excerpt | first 200 + last 300 characters / last 200 / last 100 |
| Conversation | 3 conversations: one with 35 user lines (many), one with 6 (mid), one with 1 (few) |

**The section added in B has two points.**

1. Pick up the points that come from the user's own lines first. Use the AI's lines only to recover what the user was responding to.
2. A point whose only ground is an AI line is the AI's assessment, and is not written as the user's discovery or decision. If kept, the first sentence of the body says that the AI stated it, and the confidence level goes no higher than "interpretation".

**Procedure.**

- I made a copy of the vault and received the claim task in the copy from the bundled MCP (v0.141.2). Nothing was written to the real vault.
- 18 drafting agents, one per run, did the task and produced claims. Nothing was submitted (saved).
- One judging agent judged all 60 claims with the conditions (instructions and excerpt length) hidden: whether the ground is the user's lines or an AI line, the kind, whether the wording is appropriate, and which line's content the claim carries.
- A separate agent put a weight mark on each of the user's lines, seeing only the source and not the claims.
- Yet another agent judged, for each excerpt length, whether each of the user's lines can be understood: it read the 42 user lines of the 3 conversations, starting from the source with the shortest excerpts, and judged whether one can tell what the line responds to. This judgment is about the excerpt length itself, so the condition was not hidden.

| Weight mark | Meaning |
|---|---|
| 2 | A judgment with a reason |
| 1 | A judgment without a reason |
| 0 | An instruction only |

- The drafting and judging agents were Claude Sonnet, run inside Claude Code.

## Results

### Before and after the instruction

Summed over 6 runs each for the many and mid conversations. The few conversation gave 0 claims under every condition.

| | A as is | B added |
|---|---|---|
| Claims | 26 | 34 |
| Ground is the user's lines only | 18 (69%) | 29 (85%) |
| User's lines plus the content of an AI line | 8 | 5 |
| AI line only | 0 | 0 |
| Kind: the user's judgment | 20 (77%) | 27 (79%) |
| Kind: record of work | 6 | 7 |
| Wrote AI content as the user's | 5 | 2 |
| Marked AI content as the AI's | 3 | 3 |
| Picked up a heavy line (mark 2) | 16 / 18 | 18 / 18 |
| Picked up a line with a judgment (mark 1 or higher) | 24 / 39 | 31 / 39 |

- Looking at the many conversation alone by excerpt length, the direction was the same (user's lines only: 5→9, 4→7, 5→8; lines with a judgment picked up: 7→10, 7→9, 7→9).
- The mid conversation showed almost no difference.

### Length of the excerpt

The rows about claims are summed over 4 runs each for the many and mid conversations. The three "can be understood" rows are a judgment of the 42 user lines of the 3 conversations per source, and do not depend on the number of runs. The character rows are for the many conversation; the whole-task count is the instruction A version.

| | First 200 + last 300 | Last 200 | Last 100 |
|---|---|---|---|
| Claims | 23 | 19 | 18 |
| Ground is the user's lines only | 17 | 13 | 17 |
| User's lines plus the content of an AI line | 6 | 6 | 1 |
| Wrote AI content as the user's | 1 | 5 | 1 |
| Picked up a heavy line | 11 / 12 | 12 / 12 | 11 / 12 |
| Picked up a line with a judgment | 19 / 26 | 17 / 26 | 19 / 26 |
| The user's line can be understood (of 42) | 39 | 36 | 31 |
| Of the 29 lines that need context, understood | 26 | 23 | 18 |
| Cannot tell what it responds to | 0 | 2 | 2 |
| Characters in the source (many) | 18,433 | 9,341 | 6,039 |
| Share of the source that is the AI's text (many) | 93% | 85% | 75% |
| Characters in the whole task (many) | 78,206 | 69,646 | 66,443 |

### The conversation with a single line

One conversation with a single user line: a short work instruction with a brief remark attached, given weight mark 1 (a judgment without a reason). 0 claims in all 6 combinations of instruction and excerpt length. Adding the B section did not make a claim come out of this line. This is the result of one conversation.

## What I decided

| What | Decision | Why |
|---|---|---|
| Claim instructions | Add the B section (only when the source is a conversation). **The app now does this** | Claims grounded only in the user's words went up (69% → 85%), more lines with a judgment were picked up (24/39 → 31/39), and AI content written as the user's went down (5 → 2). The 0 claims for the single-line conversation held |
| Length of the AI excerpt | Keep first 200 + last 300 characters | Shortening showed no readable difference in how many of the user's points were picked up (19 → 17 → 19 of 26). But fewer lines could still be understood (of the 29 that need context, 26 → 23 → 18). Most of the cost is the fixed part of the task (about 60,000 characters), so shortening saves only 15% for the many conversation and 3% for the mid one |

## Where it differed from the earlier trial

Before this measurement I had run a small trial on the same kind of conversation. It differed in three ways.

- In the earlier trial the heaviest line was never picked up. This time it was picked up in 3 of 3 runs even before the instruction was added (A). What A missed was a different single line, twice.
- In the earlier trial all 4 claims from the 6-line conversation rested on an AI line. The same condition this time (mid, first 200 + last 300, A) gave 2 claims: 1 from the user's lines only and 1 from the user's lines plus an AI line. Claims whose only ground was an AI line were 0 of 60.
- **Run-to-run variation is large.** The task for the same conversation under the same condition gave 4 claims in the earlier trial and 2 this time. The earlier trial was judged by the writer reading it, which is a different yardstick from the judging agent this time.

## Limits

- One run per combination. The summed tables add across the other axis (the instruction comparison is 6 runs: 3 excerpt lengths × 2 conversations; the excerpt comparison is 4 runs: 2 instructions × 2 conversations).
- 3 conversations. Only the many conversation has heavy lines, 6 of them.
- The drafting agents were Claude Sonnet run inside Claude Code, which is not the same as the AI settings inside the app.
- One agent judged the claims (Claude Sonnet). The weight marks and the "can be understood" judgment were each made by a separate agent. I did not check by eye.
- B adds two sentences together. I did not separate which one helped.
- The copied vault holds 57 claims made by hand from the same conversations as existing claims. This is the same in every condition. No addition to an existing claim happened.
- That "wrote AI content as the user's" rose to 5 at the last 200 characters rests on 3 claims from one run (many, A). It cannot be called an effect of length.
