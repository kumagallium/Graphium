# Why the desktop app's window was using 5 GB twenty minutes after launch <Badge type="info" text="Measured 2026-11-11 · v0.129" />

**Question.** On a vault with about 2,700 knowledge pages and 627 PDFs, the process that draws the window (the web view) was using about 5 GB some twenty minutes after the desktop app started. What was holding it, and can it be reduced?

**Short answer.** The strongest suspect was restoring the full-text index at startup. Restoring an index of the same size in the same JavaScript engine took the process from 0.6 GB to about 4 GB by itself, and the memory did not come back. The live index is about 0.5 GB; the rest is throwaway allocation made while restoring. With a storage format that avoids the throwaway work, the same replay sits at about 0.7 GB right after the restore and about 1.4 GB after 200 searches (about 4.6 GB before). Round-trip tests check that the index contents and search results come out the same as before. The real app has not been measured after the fix yet.

## How I measured it

| | |
|---|---|
| Machine | M1 Max, 10 cores, 64 GB, macOS 27.2 |
| Real app | The released v0.129.8 in ordinary use; the web view process read from outside with `footprint`, `vmmap` and `heap`, ten times a minute apart, then twice more. The app was not driven or restarted |
| Replay | The JavaScriptCore shell that ships with macOS (the same engine as the web view), running the app's own word breaker and the same index library. Input: 39,358 passages built read-only from the vault (1,296 from notes, 4,246 from knowledge pages, 33,816 from materials; PDF text taken with `pdftotext` as an approximation) |
| Compared | Before: restore from the index library's own storage format. After: restore from a format packed into typed arrays. Both: restore → save three times → search 200 times |
| Recorded | After each step, two garbage collections, a 10-second wait, then the process's memory |

## Results

**Real app.** The web view stayed between 5.0 and 5.6 GB (flat, not growing). The peak the process had recorded was 7.1 GB.

| Part | Size |
|---|---|
| JavaScript engine heap | 4.9–5.4 GB (97% of the total) |
| of which 220,394 blocks of 16 KB (the unit objects are kept in) | 3.6 GB |
| Images and graphics / WebAssembly / JIT | 53 MB / 17 MB / 9 MB |

There was no single large buffer (the largest was 17 MB). This is many small objects, not images or storage.

**Replay.** Process memory in MB.

| Step | Before (library format) | After (packed format) |
|---|---|---|
| Stored form read | 633 | 195 |
| Restored | 3,823 | 688 |
| After three saves | 3,960 | 862 |
| After 200 searches | 4,570 | 1,376 |
| Live heap (after restore) | 487 | 518 |

The restore took 141 ms after the change (not timed before).

**Other candidates.** Live size when held alone in the same shell.

| Candidate | Live size |
|---|---|
| All 2,920 notes and knowledge pages held as objects | 73 MB |
| One read of 6,727 embeddings × 1,024 dimensions | 87 MB (28 MB as `Float32Array`) |

## What I learned

- **The weight was in how the index is restored, not in the index.** The library's format keeps "which passage has which word how many times" as plain objects keyed by passage number — 3.38 million entries here. Restoring expands all of that, creates each key as a string, and inserts every word back into a tree one at a time. Measured step by step, re-inserting the words alone reached 0.9 GB, and rebuilding the occurrence tables alone reached 1.1 GB.
- **The throwaway part does not come back.** In the replay, memory stayed at 3.9 GB even after the index was dropped. That matches the real app sitting flat at 5 GB. How much of the real app's 3.6 GB was live and how much was unreturned was not checked directly.
- **Live size differed by about two times between engines.** Building the same index in Node.js (V8) took 229 MB of heap; restored in JavaScriptCore, its live size was 487 MB. The gigabytes are in the throwaway part, not the live part.
- **The packed format builds the final shape directly.** Occurrences are two numeric arrays, and the word tree is written out in order as it is. The stored size also went from 92.7 MB in the real app to 29 MB of numeric arrays plus 31 million characters of text in the replay.

## What I decided

- The full-text index is now stored in the packed format. A snapshot in the old format is read once the old way and written back, so PDF text is not extracted again. In exchange, the first launch after updating goes through the old restore (that one launch was not measured).
- The app reads every embedding each time it searches by meaning (the 87 MB in the table above) and rewrites the whole index whenever it changes. Neither was changed here.

## Limits

- One machine, one vault, one run per condition.
- The numbers after the fix come from the replay only. The real app reads from browser storage by structured clone and the replay reads from files, so the read step does not weigh the same.
- The shell used for the replay returned almost no freed memory to the system. The table shows how far memory grew; the real app may come down from there.
- The real app's index had 34,262 passages and the replay 39,358 (PDF text is extracted differently).
- The 200 searches include broad queries that match thousands of passages each — heavier than everyday searching.
- Not measured on Windows or in the web version (Chrome).
