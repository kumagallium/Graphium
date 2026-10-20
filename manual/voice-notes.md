# Voice notes <Badge type="tip" text="Added in v0.91.0 (2026-10-20)" /> {#voice-notes}

A meeting is full of decisions that nobody wrote down. A **voice note** records a meeting — or just your own voice — on your computer, turns it into text there, and lets you walk from a decision in the summary back to the sentence someone actually said.

- **No bot joins the call.** Graphium records what your computer plays and what your microphone hears, so it works the same for Zoom, Teams, Gather, or a browser tab.
- **Audio never leaves your computer.** Recording and transcription both run locally; the only network use is the one-time download of the speech model. See [the FAQ](/faq) for the numbers behind this.
- **It is a block in a note.** The transcript sits in your note like any other block, so you can write around it, summarize it, and link to it.

::: info Desktop app only
Voice notes need the [desktop app](/desktop-app). In the browser and on a phone, a voice note block shows **Recording isn't available on this device** or **Can't be read on this device** — the note itself still opens, and the block comes back to life when you open it on the desktop.
:::

## Starting a voice note {#starting}

There are two ways in.

| Where | What happens |
|---|---|
| **+ Note ▾** → **Voice note** | Creates a new note titled "Voice note …" with the voice note block at the top |
| `/audio` in any note | Inserts the block at your cursor (the slash menu entry reads **Audio (transcribe at this spot)**) |

![The menu behind the arrow of + Note: Blank note, Voice note, From a template…](/screenshots/new-note-menu.png)

Either way, the block is placed **ready, not recording**. It shows a **Voice note** header with **Start recording**, and nothing is captured until you press that button. A ready block can wait in a note for as long as you like — start it when the meeting does.

## Recording {#recording}

Before the first sentence, the block shows what you are agreeing to:

- **By starting, you confirm that all participants have agreed to being recorded and transcribed.** Tell people. Graphium records the call quietly; asking is your job.
- **Also record the other side (for online meetings)** is on by default. Turn it off to record only your own voice — the block then says **Only your own voice will be turned into text**, which suits dictating thoughts or an in-person chat.
- **Headphones keep the other side's voice out of your microphone.** Use them for online meetings. Without headphones, the speakers' sound reaches the microphone too and the same words are transcribed twice.

Press **Start recording** and the header changes to **Recording** with a running timer. Press **Stop** when you are done: the recording is saved to your **Audio** materials ("Meeting …", a `.wav` file) and the block fills in the rest. A recording also stops and saves itself at the three-hour limit, and when you close the window.

### Permissions {#permissions}

| Platform | What the first recording asks for |
|---|---|
| **macOS** | **Screen recording permission** to hear the other side (System Settings → Privacy & Security → **Screen & System Audio Recording** → allow Graphium), and **microphone** access for your voice |
| **Windows** | Microphone access, if Windows asks |

On macOS, if the permission is missing Graphium says **Screen recording permission is needed** and offers **Open Settings**. After you allow it, **restart Graphium** (the **Restart** button in the same message) — macOS only applies the permission to a freshly started app.

If the microphone cannot be used, Graphium keeps recording the other side, and when you stop it says which side is missing — for example **Recording saved to Assets (your voice isn't included)**.

## The transcript block {#transcript-block}

![A finished voice note block: the transcript with Others / Me labels, Play, Expand to paragraphs and Summarize](/screenshots/voice-note-block.png)

While you record, lines appear in the block with a delay of about **one minute**: Graphium transcribes the audio in windows as they fill, and finishes the rest after you stop. The header shows **Transcribing · N utterances** while it works and the block settles to **Transcript** when it is done.

- **Others / Me.** Each line starts with a `[mm:ss]` time and **Others** (the people on the other side) or **Me** (your microphone). The two sides are kept apart from the start, so the labels are not a guess.
- **Play, and click a time.** **Play** plays the recording; clicking a `[mm:ss]` time plays from that line (**Play from this line**). The audio loads the first time you press play. Playback mixes both sides to the center.
- **Fold / Open, Show all.** A long transcript shows the most recent 20 lines; **Show all (N more)** reveals the rest and **Fold** hides the block's body.
- **Expand to paragraphs.** Turns each line into an ordinary paragraph below the block, so you can fix a misheard word, add context, or select lines as the source for a summary. The block shrinks to a header (**Expanded (N utterances)**), and **Show original** keeps the untouched transcript one click away.
- **If it stops partway.** **Transcription stopped partway** means the speech model did not finish. What was transcribed is kept; open the recording in your [materials](/materials-and-citations) and use **Transcribe** to run it again.

The words themselves live with the recording in your materials, not inside the note file, so a long meeting does not make the note heavy. If you share the note, the recording has to be shared too.

## Summary and provenance {#summary}

Once the lines are paragraphs, **Summarize** asks your AI model for what mattered and writes it into the note right after the block:

- **Decisions**, **To-dos** (with **Owner** and **Due** when the conversation named them), and **Open questions**, each as a short bullet.
- One line under the **Summary** heading — **Summarized by AI. Follow each item's link to see where it came from** — marks the text as machine-written.
- **Every item links back to the paragraphs it came from**, so you can check the AI against what was said, and from there play the audio.

Press **Summarize again** to redo it; it replaces the previous summary. If you edited that summary by hand, Graphium asks first (**You've edited the previous summary. Replace it?**), and a result with nothing in it never replaces what you have. A very long meeting — more than 1,500 utterances or 60,000 characters — is too large to summarize in one go.

Summaries need an AI model; set one up in [Setting up AI](/ai-setup). The summary is written in the language Graphium is displayed in, even if the meeting was mixed. Transcription itself needs no AI model and no account.

The chain is recorded as [provenance](/labels-and-provenance): **summary item → paragraph → transcript block → transcription → recording**. In the [PROV-JSON-LD export](/labels-and-provenance#exporting-prov-json-ld) you can follow it end to end. The transcription step is a system step, so it does not appear in the Step panel as if you had written it.

## Models and settings {#settings}

![Settings → AI → Meeting recording and transcription: model, language, frequent terms, transcribe while recording](/screenshots/voice-note-settings.png)

Open [Settings](/settings) → **AI** → **Meeting recording and transcription** (desktop app only).

| Setting | What it does |
|---|---|
| **Model** | **High accuracy, recommended (large-v3-turbo)** — 574 MB, the most accurate, and the default. **small** (488 MB, lighter, for low-spec computers) and **base** (148 MB, the lightest) trade accuracy for speed. Each one has **Download**, **Cancel** while downloading, and **Delete** once downloaded. |
| **Language** | **Auto**, **Japanese**, or **English**. If you know the meeting's language, fix it — it is more reliable than Auto. |
| **Frequent terms (hints for transcription)** | Comma-separated terms, up to 200 characters — product names, people, jargon. The model hears them more reliably. The note's title is used as a hint too, so name your voice note after the topic. |
| **Transcribe while recording** | On by default. Off means no lines appear during the meeting; after you stop, run **Transcribe** from the recording's material preview. |

The model is downloaded once, the first time you need it, and kept on your computer. Until it is downloaded Graphium says **The transcription model isn't downloaded yet, so only the recording will be made** — the recording is still saved, and you can transcribe it after downloading.

## Limits to know about {#limits}

- **Mixed languages.** Auto detects Japanese or English for each stretch of speech. A sentence that switches language in the middle can lose the minority-language words. Fix the language in Settings when you can.
- **Homophones and names.** The model chooses between words that sound alike by context, so technical terms and names can come out wrong. Add them to **Frequent terms**, and fix the rest after **Expand to paragraphs**.
- **Without headphones, the other side is heard twice** — once from the call and once through your microphone.
- **Two sides only.** Everyone on the call is **Others**. Graphium does not tell individual remote speakers apart.
- **Windows runs on the CPU.** Transcription on Windows is slower, so the text can trail further behind than a minute. Nothing is skipped — Graphium transcribes what has piled up together.
- **Quiet or silent stretches.** Silence is skipped on purpose so the speech model does not invent text over it; very quiet speech can be skipped with it.

These are deliberate choices rather than bugs; the thresholds are listed in [the FAQ](/faq) (search for "Meeting transcription").
