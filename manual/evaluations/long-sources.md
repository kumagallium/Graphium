# Reading a long source in windows <Badge type="info" text="Measured 2026-09 · v0.79" />

**Question.** When a source becomes a topic page, the AI used to read it in one go, and anything after the first 80,000 characters was cut off. Does reading a long source in overlapping windows give more statements that the source actually supports? And does it help to let the AI skip windows that look unrelated?

**Short answer.** On the one long source I tried, a 111,000-character thesis, the share of supported statements went from 40% to 84%, and almost half of them came from text that used to be cut off. Skipping "unrelated" windows saved nothing, because every window was judged related. Since [v0.80.0](/faq) a long source is read in 4,000-character windows that overlap by 400, with a short map of the whole source, and nothing is skipped.

## How I measured it

| | |
|---|---|
| Conditions | W0: the whole text in one call (as before). W1: revise the page window by window. W2: W1 plus a short map of the whole source. W3: W2, but let the AI skip windows it judges unrelated |
| Sources | Short: 6 research documents, up to 18,000 characters (17 windows). Long: one 115-page thesis, 111,240 characters (32 windows) |
| Writer | `gpt-oss-120b`. The short set was run three times per condition, the long one once |
| Scoring | An AI checked each statement on the finished page against the source, five statements at a time: supported, wrong or not in the source, or cannot tell |

## Results

Short sources (average of 3 runs):

| Condition | Statements | Supported | Wrong or not in source | Cannot tell | Supported share | Input characters | Time |
|---|---|---|---|---|---|---|---|
| W0 one call | 12.3 | 9.3 | 2.0 | 1.0 | 77% | 88,511 | 88 s |
| W1 windows | 31.0 | 18.7 | 3.7 | 8.7 | 61% | 187,411 | 337 s |
| W2 windows + map | 50.7 | 34.3 | 4.0 | 12.3 | 68% | 183,426 | 316 s |
| W3 + skipping (1 run) | 61 | 40 | 9 | 12 | 66% | 201,360 | 476 s |

The long source (one run):

| Condition | Statements | Supported | Wrong or not in source | Supported share | Supported by text past 80,000 characters | Time |
|---|---|---|---|---|---|---|
| W0 one call | 10 | 4 | 6 | 40% | 0 | 19 s |
| W2 windows + map | 50 | 42 | 5 | 84% | 20 of 42 | 590 s |

## What I take from it

- **Windows pay off for long sources.** The page got five times as many statements, most of them supported, and it finally used the part of the source that used to be cut off.
- **For short sources they cost more.** With windows and a map (W2), the page had 3.7 times as many supported statements (9.3 to 34.3) and wrong statements fell from 16% to 8% of the page. But the share that could be confirmed dropped, because more statements could not be judged, and it took about 3.6 times as long with twice the input. So windows are used only when a source does not fit in one window.
- **The map helps.** Adding a short map of the whole source (W2) raised both the number and the share of supported statements over plain windows (W1).
- **Skipping saved nothing.** All 17 and all 32 windows were judged related, so I left skipping out.
- Most new errors came from numbers and units garbled when text was extracted from PDFs, not from the windows themselves.

## Limits

- The long-source result comes from one source and one run.
- Runs of the short set varied by about ±15 points, so a single run cannot rank close conditions.
- **Changing the AI grader changed the results a lot.** Partway through, the grader had to change model. Every condition was then graded again by the same grader, and all numbers above come from that second grading.
- The sources were my own research documents.
