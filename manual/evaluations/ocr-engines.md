# Can a downloaded model read handwriting that the built-in OCR cannot? <Badge type="info" text="Measured 2026-11-18 · v0.141" />

**Question.** Graphium reads text in images with tesseract.js. If I replaced it with a small downloaded model or the OCR that comes with the OS, would it read handwriting, and would accuracy improve?

**Short answer.** The current OCR (tesseract.js) picked up none of the 160 handwritten phrases. Detection and recognition models of about 22 to 180 MB (PP-OCR) improve photos and tables a great deal and printed text a little, but on handwriting they get as far as dates and numbers and cannot read sentences. The ones that found most of the handwritten phrases I checked (the answer key is my draft and the notebook's owner has not confirmed it yet) were macOS's built-in Vision and a vision-language model built for OCR that takes gigabytes (glm-ocr). **This measurement has not changed the default OCR.** Which engine to ship is undecided, Windows was not measured, and the licence and distribution form of glm-ocr are unchecked.

## How I measured it

| | |
|---|---|
| Machine | Apple M1 Max, macOS 27.2. Times are from this machine only |
| Engines | tesseract.js 7 (the same as now: jpn+eng, `4.0.0_best_int`). PP-OCRv5 (mobile about 22 MB, server about 180 MB) and PP-OCRv6 Japanese (small about 31 MB, medium about 139 MB for detection and recognition), run with rapidocr 3.10.0 and onnxruntime 1.32.0. Apple Vision (`VNRecognizeTextRequest`, accurate, ja-JP and en-US; macOS only, nothing to download) |
| Vision-language models | Run on ollama 0.40.6 on the same day, with the image shrunk to 2000 px on the long side and temperature 0: glm-ocr (2.7 GB), deepseek-ocr (6.7 GB), gemma3:4b (3.4 GB), qwen3-vl:4b (3.3 GB) |
| Synthetic data | 16 images generated for this: printed text, small text, tables, dark screens, vertical writing and photo-like degradation, on a bread-baking theme. The answer key is the full text |
| Handwriting | 7 photos supplied by a user: 6 pages of a lab notebook and 1 memo, taken on an iPhone (3024 × 4032) with only the orientation corrected. The answer key is 160 phrases I could read with confidence in a reduced image, not the full text. **The draft of the key was made by me with an AI's help, and the owner has not checked it yet** |
| Scoring, synthetic | Character error rate (CER) after NFKC normalisation and removing spaces. I also looked at errors that ignore reading order (F1 on the multiset of characters) |
| Scoring, handwriting | Whether each phrase appears anywhere in the output (edit distance to the best-matching substring divided by the phrase length). A phrase counts as found at 0.2 or below |

The handwriting content is not shown here, and the sentences and numbers it contains are not quoted.

## Results

**Synthetic, 16 images (average CER; lower is better).**

| Category | tesseract.js | PP-OCRv5 mobile | PP-OCRv5 server | PP-OCRv6 small (Japanese) | PP-OCRv6 medium (Japanese) | Apple Vision | glm-ocr |
|---|---|---|---|---|---|---|---|
| Printed text | 0.029 | 0.001 | 0.014 | 0.000 | 0.000 | 0.008 | 0.002 |
| Small text | 0.082 | 0.028 | 0.054 | 0.003 | 0.003 | 0.016 | 0.045 |
| Dark screen | 0.039 | 0.000 | 0.000 | 0.000 | 0.000 | 0.010 | 0.000 |
| Photo-like | 0.537 | 0.141 | 0.026 | 0.004 | 0.066 | 0.072 | 0.003 |
| Table | 0.821 | 0.000 | 0.011 | 0.007 | 0.034 | 0.000 | 0.000 |
| Vertical writing | 0.927 | 0.780 | 0.780 | 0.780 | 0.780 | 1.000 | 0.000 |
| ms per image | 374 | 289 | 2628 | 361 | 1383 | 140 | 1447 |

- glm-ocr's CER over all 16 images was 0.007.
- Apple Vision returned empty output for the one vertical-writing image.

**Handwriting, 160 phrases (share found; higher is better).**

| Engine | Size | Overall | Dates (30) | Japanese phrases (88) | Numbers and units (42) | Exact match | Seconds per image |
|---|---|---|---|---|---|---|---|
| tesseract.js | bundled | 0 % | 0 % | 0 % | 0 % | 0 % | 20.0 |
| PP-OCRv5 mobile | about 22 MB | 40 % | 83 % | 12 % | 67 % | 21 % | 1.4 |
| PP-OCRv5 server | about 180 MB | 47 % | 93 % | 19 % | 71 % | 30 % | 11.2 |
| PP-OCRv6 small (Japanese) | about 31 MB | 45 % | 93 % | 18 % | 67 % | 32 % | not tallied |
| PP-OCRv6 medium (Japanese) | about 139 MB | 48 % | 93 % | 19 % | 76 % | 33 % | not tallied |
| Apple Vision | 0 (macOS only) | 69 % | 93 % | 70 % | 50 % | 38 % | 0.5 |
| glm-ocr | 2.7 GB | 69 % | 97 % | 52 % | 86 % | 54 % | 27.9 |
| deepseek-ocr (not measured fairly) | 6.7 GB | 32 % | 77 % | 8 % | 50 % | 24 % | about 24 |
| gemma3:4b | 3.4 GB | 16 % | 33 % | 6 % | 26 % | 8 % | about 18 |
| qwen3-vl:4b (not measured fairly) | 3.3 GB | 9 % (5 of 7 images gave empty output) | 13 % | 5 % | 14 % | 7 % | about 127 |

For qwen3-vl:4b and deepseek-ocr, I did not tune the prompt or the handling of thinking tokens. The empty outputs of the first and the garbled output of the second (table tags, unrelated words) do not show what the models can do. Treat these two as not measured. The prompts used were `Text Recognition:` for glm-ocr, `Free OCR.` for deepseek-ocr and a plain instruction to transcribe Japanese for the other two.

## What I learned

- **The PP-OCR errors on vertical writing and on tilted photos came from the order the runner stitched lines in.** It read columns from the left and bundled tilted lines in its own way. The characters themselves were read: ignoring order, the error on the vertical image was 0.04 to 0.06, and on the photo-like images 0.02 or less.
- **Vision and glm-ocr are strong in opposite places.** Vision is better on Japanese sentences (70 % against 52 %). glm-ocr is better on numbers and units (86 % against 50 %) and on exact matches (54 % against 38 %). Overall they tie at 69 %.
- **glm-ocr sometimes drops a line and closes the sentence with other words.** For example, the second half of a sentence that spans two lines goes missing and the sentence ends in a different word. The result is a readable sentence, not garbled characters, so it is hard to notice.
- **A general small model (gemma3:4b) invented words and numbers that were not written.** It does not suit OCR.
- **PP-OCRv5's Chinese model mixes in simplified characters.**
- PP-OCR picks up dates and numbers in handwriting but almost none of the Japanese phrases in running script. tesseract.js produced no meaningful characters from handwriting.

## Limits

- The handwriting is one person's, on 7 images. The answer key leans toward phrases that are easy to read.
- The answer key was drafted by me with an AI's help, and the owner has not confirmed it yet.
- The synthetic data is easier than real photos. Vertical writing and dark screens are one image each.
- Times are from an M1 Max only. Windows was not measured. Apple Vision exists only on macOS.
- The vision-language models were given the image shrunk to 2000 px on the long side. Results may differ at other sizes.
- Not measured: an AI you have already connected to Graphium.
- Not checked: the licence and distribution form of glm-ocr (whether it can be turned into ONNX, whether it runs without ollama). The sources and licences of the PP-OCRv6 models are not written down yet either.

## What I decided

- At the time of the measurement nothing was changed: Graphium still used tesseract.js, and which engine to add, and for which platform, was not decided. What followed is in the next section.

## What I changed afterwards

- **v0.142.0: the desktop app reads images with PP-OCRv6 small.** The model is fetched in the background the first time an image is read; until then, on failure and in the browser version, tesseract.js reads as before. Rewritten in Rust on the ONNX Runtime the app already ships, the engine gave the same output as the Python runner on the 16 synthetic images except vertical writing, which it now reads from the right column (CER 0.780 → 0.049). Detection input is capped (long side 1600 px before detection), which kept the handwriting hit rate in the same range (42–46 %) while the peak memory fell from 4.75 GB to 1.13 GB.
- **A thin, tall image could exhaust memory.** While reviewing the change from an attacker's point of view, I found that a 1×20000 px image made the detection input about 10 GB. The size of the detection input, the request size, the number of jobs running at once and the time are now bounded. It was fixed before the release.
- **On macOS, the reading from the OS's own text recognition is kept as well, for finding only.** The two engines are strong at opposite things, so I measured what happens when a phrase counts as found if either reading has it. The text shown, copied, exported and given to an AI stays the PP-OCR reading; the second reading goes only into search. This is in the release after v0.142.0.

| Reading used for finding (160 handwritten phrases, engines as built into the app) | All | Dates | Japanese phrases | Numbers and units |
|---|---|---|---|---|
| PP-OCRv6 small alone | 44 % | 90 % | 16 % | 71 % |
| OS text recognition alone | 72 % | 93 % | 76 % | 48 % |
| Either of the two | 82 % | 97 % | 80 % | 79 % |

The limits above still apply: one person's handwriting, 7 photos, and an answer key the notebook's owner has not confirmed. Windows has no second reading.
