# How long does the screen freeze when a 230,000-row CSV is imported? <Badge type="info" text="Measured 2026-11-18 · v0.138" />

**Question.** Data tables were described as having no row limit, but the record of checking them stopped at 2,000 rows. How long does the screen freeze when a CSV of 233,000 rows and 188 MB is imported?

**Short answer.** Before the fix, the screen froze for up to about 16 seconds between dropping the file and the import screen opening. After splitting the import and display work into small slices, the longest freeze under the same conditions was about 0.5 seconds. I am not adding a row limit this time either. In the web version (Chromium), importing 233,000 rows now stalls the screen for about 0.5 seconds at most, so the manual states that range. The desktop app was measured afterwards ([Measured in the desktop app](#measured-in-the-desktop-app)).

- The longest single freeze got shorter in all four steps.
- The time from confirming to the data table appearing got longer (2.3–2.6 seconds to 4.1–4.3 seconds), because parsing is split into slices and the columns are read first. The screen does not stall in the meantime (the longest gap between frames was about 0.2 seconds).
- Memory use was not measured before and after.

## How I measured it

| | |
|---|---|
| Machine | Apple M1 Max, 64 GB, macOS 27.2 |
| Environment | The web version on the development server (vite dev, not a production build), saving to the server in an isolated folder. Driven with headless Chromium (Playwright) |
| Data | Synthetic CSV: 233,000 rows × 16 columns, 188 MB. Two of the columns were cells holding an array of 28 numbers inside quotes. Generated inside the page and fed in by dropping it on the editor |
| Freeze time | The lateness of a 10 ms timer is taken as the time the screen froze. I looked at the longest single delay and the sum of delays over 100 ms. For the fixed version I also checked the gaps between rendered frames, which showed the same trend |
| Runs | 2 before the fix, 5 after |
| Steps | Drop the file, confirm, type 31 characters in the body, save and reopen |

## Results

**Freeze time (longest single delay).**

| Step | Before (2 runs) | After (5 runs) |
|---|---|---|
| From dropping the file until the import screen opens | 16.3–17.1 s | 0.50–0.55 s |
| From confirming until the data table appears | 1.8–1.9 s | 0.06–0.20 s |
| Then typing 31 characters in the body | 1.5–1.6 s | 0.03 s or less (no delay counted as a freeze) |
| Saving and reopening until the table appears | 7.6–7.7 s (total 9.4–9.5 s) | 0.15–0.22 s (total 0.15–0.45 s) |

**Elapsed time (from the action to the display).**

| Step | Before | After |
|---|---|---|
| Until the import screen opens | 16.7–17.6 s | about 0.8 s |
| From confirming until the data table appears | 2.3–2.6 s | 4.1–4.3 s |
| Saving and reopening until the table appears (includes a fixed 2.5 s wait after saving) | 12.9–13.2 s | 7.3–8.1 s |

From confirming to the data table appearing, it takes longer than before.

**Preliminary measurement of the parsing functions alone.** The code from before the fix, run on Node, reading a real CSV file (155 MB, 233,103 rows × 16 columns). Estimating the settings took 11.2 s, parsing 5.0 s and reading the columns 1.6 s; process memory peaked at about 1.2–1.3 GB. The row and column counts matched a standard CSV parser (Python's `csv`).

## What I learned

Before the fix, four things froze the screen.

1. The import screen tried four candidate delimiters on every row.
2. All rows were converted into a table in one go.
3. Reading the data table's columns as numbers ran over every row on each edit of the body (0.25 seconds after it).
4. Comparing the result also turned the whole thing into a string each time.

## What I changed

- The settings are inferred from the first 5,000 lines; only the end row is decided from the end of the file.
- For a file over 20,000 lines, the import screen converts only the first 2,000 lines. Converting all rows happens in slices when the data table displays it.
- Reading the columns is done once and not repeated unless the asset changes. For an asset whose text is over about 2 million characters, parsing all rows and reading the columns are done in slices.
- The comparison skips looking inside when the two are the same object.

## What turned up during the measurement

- **In the chart's "From an asset's data", the confirm button could not be pressed for a file over 1,000 rows.** The row limit for document tables was also applied to this path, which does not create a table. I removed the limit.
- **If a data table was inserted before a new note's first save finished, the inserted table disappeared.** The editor is rebuilt when the save completes. It did not happen in the runs before the fix, probably because the first save finished while the screen was frozen. The faster import made it easier to hit. I reproduced it reliably by delaying the save by 3 seconds, made the insert wait for the first save, and confirmed the table stays under the same condition. After the fix the table went in 10 times in a row, including one run from a clean storage folder.
- **Using `scheduler.yield` to hand control back between slices produced no rendered frames during parsing (about 1.6 seconds).** Switching to `MessageChannel` made frames appear.

## Limits

- At this point the desktop app (its web view is WebKit) had not been measured. The later results are in [Measured in the desktop app](#measured-in-the-desktop-app).
- Not measured on a production build (development server).
- Memory use was not measured before and after. Keeping both the file's text and the parsed rows in memory is unchanged.
- What was measured is importing, viewing, editing the note and reopening. Scrolling and sorting the table and drawing charts were not measured.
- Only one shape and one size were measured (233,000 rows × 16 columns). Tables with more columns and larger files were not measured.
- When a data table has a computed column added, the column reading cannot be remembered and is redone on every edit (out of scope here).
- The path where a chart reads a large asset directly still converts all rows in one go (out of scope here).
- Assets over 128 MB are not checked for identical content (duplicate detection). This is existing behavior.
- The cost of limiting the inference to the first 5,000 lines: it can be wrong for a file whose preamble is longer than 5,000 lines, or one with a longer table further down. The end row and delimiter can be corrected by hand.
- 2 runs before the fix and 5 after.

## What I decided

- No row limit for data tables. In the web version (Chromium), importing 233,000 rows (188 MB) stalls the screen for about 0.5 seconds at most, so the manual states that range. The desktop app was measured afterwards.

## Fixed afterwards

- **The same cause also erased typed text when a new note's first save was slow.** With the save delayed by 3 seconds, text typed during that save disappeared too. I stopped rebuilding the editor when a new note gets its ID, which fixes it at the root. Text typed and a data table inserted during the save stayed on screen and after a reload.
- **The wait for the first save before inserting a data table is gone.** It is no longer needed.
- **A chart over 233,000 rows froze for 45 seconds or more while it was drawn.** Measured with a 4-column version of the same synthetic data (233,000 rows), read through the chart's **From a data asset**. The cost was drawing every point, not parsing, and once drawn, typing one character in the note took 52–153 seconds. A series with more than 4,000 points is now thinned for drawing only, and editing the note no longer redraws the chart. Confirming until the chart is drawn went from 45.3–50.0 seconds to 1.2 seconds (longest stall 0.4 seconds), and the delay per character is 0.064 seconds at most. Charts of 500 and 3,000 rows draw every point as before. Stacking and normalisation are computed from every point.
- **The asset preview rendered all rows of a 233,000 × 16 table at once.** It now renders the first 1,000 rows and 200 columns and states the size of the whole table. Sorting works on all rows. Opening took 3.3 seconds and sorting a text column 0.6–1.1 seconds (not measured before the change).

## Measured in the desktop app

After the measurements above, the same synthetic data (233,000 rows × 16 columns, 188 MB) was run through the desktop app, in a build with every fix so far. The desktop app before the fixes was not measured.

| | |
|---|---|
| Hardware | Apple M1 Max, 64 GB, macOS 27.2 |
| Build | Built with the same optimisation as a release. Only the identifier and the internal port were changed, to keep it apart from the installed app. Storage was a temporary folder |
| Driving it | A small hook, present only in this verification build, creates the synthetic data in the page and performs the drop, confirm, typing, save and reload by itself |
| Runs | 1 |

| Step | Time taken | Longest single stall |
|---|---|---|
| Dropping the file until the import screen opens | 0.7 s | 0.5 s |
| Confirming until the data table appears | 6.1 s | 1.0 s |
| Then typing 31 characters in the body | — | 0.01 s |
| Reloading until the data table appears | 6.0 s | 1.1 s |

- With 23,300 rows (19 MB), confirming until the table appears took 0.6 seconds and reloading until the table appears 0.8 seconds.
- The memory of the process that draws the window peaked at 3.2 GB during the import and was 2.1 GB after reopening.
- Confirming and reopening are slower than in the web version because saving and reading back an asset passes the whole file as a base64 string. For the 188 MB asset, reading back took 0.5 seconds to receive, 0.4 seconds to decode and 0.2 seconds to copy into bytes; saving took 0.6 seconds to encode and 0.9 seconds to send. The screen stalls during the decoding, copying and encoding.
- In an unoptimised development build, confirming until the table appears took 9.3 seconds and reloading 15.3 seconds. Numbers from a development build do not indicate what a release does.
