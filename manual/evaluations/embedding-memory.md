# Why the desktop app ate 11 GB while tidying up <Badge type="info" text="Measured 2026-11-05 · v0.120" />

**Question.** On a knowledge base of about 2,300 pages, **Tidy up for me** made the desktop app's main process grow to 11–12 GB within minutes (as reported from the Mac where it happened), and the whole machine started swapping. The memory was in the native process, not in the web view or the AI server. What was holding it, and how do we make it stop?

**Short answer.** The on-device embedding engine. With the ONNX Runtime that `fastembed` 7.5 bundles (1.31), embedding one page of 32 sections pushed the process past 39 GB on this Mac without finishing. With `fastembed` 5.13, which bundles ONNX Runtime 1.23, the same call takes 6.5 seconds and its large allocations peak at 1.4 GB (the process then sits at about 2.4 GB with the 600 MB model loaded). The fix is a dependency pin plus a smaller batch; no setting changed for you.

## How I measured it

| | |
|---|---|
| Machine | M1 Max, 10 cores, 64 GB, macOS 26 |
| Build | A debug build of the desktop app with a probe that calls the same native commands the app calls, in a loop, from the web view. Run against an isolated data folder, never the real one |
| Load | **Embedding:** 32 texts of about 3,000 characters (cut to 512 tokens each, what one revised page with 32 long sections sends), one such text alone, and 100 short texts of 300 characters. Models: `bge-m3` (the default) and `multilingual-e5-small`. **Reading files:** a 10 MB file fetched 180 times through the native command the first suspect uses — 120 times as 13 MB of base64 text, 60 times raw |
| Readings | The process's resident memory and `footprint`'s `MALLOC_LARGE` line every 3 seconds. A watchdog killed the process above 5–8 GB resident, because the first unguarded run took 25 GB of swap |
| Versions | `fastembed` 7.5 resolves to `ort` 2.0.0-rc.15 (ONNX Runtime 1.31.0); `fastembed` 5.13.0 to `ort` 2.0.0-rc.11 (1.23.2). Both read from `Cargo.lock`; the 1.23.2 string is also present in the built binary. A third build with `fastembed` 5.8.0 (1.22.0) behaved like 1.23 |

## Results

**What it was not.** Reading files over the native bridge was flat: 180 reads left the process between 170 and 260 MB.

**What it was.** The embedding engine, with its bundled runtime.

| Load | ONNX Runtime 1.31 (fastembed 7.5, before) | ONNX Runtime 1.23 (fastembed 5.13, after) |
|---|---|---|
| bge-m3, 32 sections × 512 tokens, one call | not finished after 40 s; large allocations at 39 GB and still growing (442 blocks) | 6.5 s; large allocations peak at 3.2 GB with 32 texts per batch, **1.4 GB with 8** |
| bge-m3, one section | resident 5 GB after 3 s, stopped by the watchdog (arena off) | not re-measured on 1.23 (0.7–1.0 s on 1.22) |
| e5-small, 100 short texts, 8 per batch | large allocations at 4.3 GB after 6 s, stopped (arena off) | 2.7 s, 395 MB |

The 39 GB row ran with the runtime's default memory arena; the other two 1.31 rows come from the knob tests below, which started from an arena-off build.

Things that did **not** change the 1.31 picture, each added on top of an arena-off run: one inference thread, disabling the KleidiAI kernels (this Mac has no SME unit, so they were probably not in use anyway), disabling weight pre-packing, disabling memory patterns. A stack sample during the run showed the allocations coming from ONNX Runtime's own per-node allocation plan, so they are ordinary intermediates; why they are not reused within the run I could not see from outside. A peak equal to the sum of every layer's intermediates fits the numbers.

Batch size on 1.23: 32 texts per batch and 8 texts per batch took the same 6.5 seconds for 32 sections, and 8 peaked at 1.4 GB instead of 3.2 GB. The app now uses 8.

## What I take from it

- **What changed between the two builds is the bundled runtime.** The model files, the tokenizer settings and the calls are the same in `fastembed` 5.13 and 7.5. The closest upstream report, microsoft/onnxruntime#29538, describes the same shape of retention on Apple Silicon from 1.24 on and was closed as stale without a fix for the matmul path; this measurement itself compared only 1.22, 1.23 and 1.31. Graphium pins `fastembed` to 5.13.0, and the repository records the measurement to repeat before moving it.
- **The peak stays after the run.** The resident size did not come down in the 8 seconds measured after each run. ONNX Runtime's arena does not shrink on its own, and the app unloads the model 10 minutes after its last use, so expect about 2.4 GB until then (the 10 minutes is the app's rule, not something measured here).
- **Smaller batches cost nothing here.** Same speed, less than half the peak.

## Limits

- One machine, one macOS version, one run per condition. The upstream report covers Apple Silicon; Windows was not measured here.
- The text used for the load is synthetic (repeated vocabulary), chosen to hit the 512-token cut. Real pages vary, so the table is a worst case for a 32-section page, not an average.
- The web view's own memory while re-reading PDF sources during tidy-up (2–4 GB on the same knowledge base) is a separate matter and was not changed.
