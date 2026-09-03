# Chat & Ask (Cmd+K)

Once [AI is set up](/ai-setup), Graphium gives you two ways to talk to a model without leaving your work: a chat panel that knows what note (or block) you are looking at, and the Composer — a `⌘K` (`Ctrl+K` on Windows/Linux) palette that combines note search with one-shot AI questions. This page covers both, plus how answers cite sources, how to reuse an answer, and how to steer the AI with skills.

::: info Which model answers
Chat and the Composer use the model assigned as **Chat & Insight model** in Settings → **AI** (falling back to the default model when unset). See [AI setup](/ai-setup).
:::

## The AI chat panel

Open the **Chat** tab in the right-side panel of a note (the robot icon). The tab appears once an AI model is registered. Type a question and press `⌘Enter` (`Ctrl+Enter` on Windows/Linux) to send; a **Stop** button cancels an in-flight answer.

![AI chat panel next to a note](/screenshots/chat.png)

By default the chat can see the note you have open. To focus it on a specific part of the note instead, start the chat from the editor:

| Starting point | What the conversation is about |
|---|---|
| **Chat** tab | The whole current note |
| Drag handle (⠿) → **🤖 AI Assistant** | That block — for a heading or a step block, everything under it is included as one unit |
| Select multiple blocks → **Ask AI about selection** | Exactly the blocks you selected |
| Select text → **Ask AI about selection** in the floating toolbar | The selected text |

Whichever starting point you use, the note you have open is passed as background as well. A quoted sentence that leans on the lines before it — a pronoun, an abbreviation, "at this temperature" — is still understood. The answer stays on the quoted part; the rest of the note is there only for context. It is re-read on every message, so edits you make mid-conversation are picked up. <Badge type="tip" text="Added in v0.29.0 (2026-08-05)" />

When a chat starts from blocks or a selection, the passed content stays visible at the top of the panel under **Quote**, so you always know what the conversation is about.

## Referencing notes and materials with @

Type `@` in the chat input to search your notes and knowledge pages and attach one as context — the input hints at this with "(@ to reference notes)". Attached items appear as chips above the input and are sent with your next message.

If the attached note was created from a PDF, web page, or Word document, Graphium prioritizes what you distilled from it — your memos and derived knowledge — and falls back to the original text, so the AI answers from your reading rather than a cold document.

Materials have their own chats too: open a material in full view and use **Ask AI** in its right panel to chat about that PDF or web page directly. These conversations are saved per material and are there when you come back.

## Choosing what grounds the answer <Badge type="tip" text="Added in v0.16.8 (2026-07-02)" />

The **Grounding** chip next to the input controls what evidence the AI draws on. The same chip appears in the Composer.

| Scope | Behavior |
|---|---|
| **External** | "Search the web and ground the answer in external sources — for investigating something new" |
| **Internal** | "Everything you cited, plus a cross-search of your accumulated knowledge — for ideation" |
| **This note** | "Only what this note cites, without a cross-search — for accurate writing and citations" |

**This note** is the default: answers stay pinned to what you explicitly cited, which is what you want while writing.

What the cross-search in **Internal** (and **External**) reads: your knowledge pages first, and a few short passages from your own notes and assets — image text read by OCR, URL excerpts, PDF text — that share words with your question. Those passages come from a full-text index kept on this device (see [Settings → Storage](/settings)); no embedding model is needed, and it works offline. The AI is told which passages are raw material rather than distilled knowledge, so it can say so when an answer rests on a note rather than on a knowledge page. Whole notes still enter a conversation the way they always have: cite them with `@`. <Badge type="tip" text="Added in v0.39.0 (2026-08-17)" /> On desktop, if a shared library is configured, its entries are cross-searched the same way unless you turn that off in [Settings → Storage](/storage-and-sync#shared-entries-in-search-and-ai-chat). <Badge type="tip" text="Added in v0.52.0 (2026-09-03)" />

## Web search in chat <Badge type="tip" text="Added in v0.16.6 (2026-06-30)" />

Choosing **External** forces a web search. To give Graphium one, register a search MCP server (such as Tavily) in Settings → **AI**.

So you can tell where a statement comes from, sources at the end of an answer are labeled **📓 From your notes** for internal citations and **🌐 Web sources** for pages found on the web. Clicking an internal citation opens what it points at — a knowledge page, a note in the side peek, or an asset in the material peek.

::: warning When no web search is configured
If you select **External** without a search MCP server, a dismissable banner appears above the input: "No web search is set up — External will answer without live web results. Add a search MCP server (e.g. Tavily)," with an **Open settings** shortcut. The question still runs — the answer just cannot include live web results.
:::

## Editing, regenerating, and forking <Badge type="tip" text="Added in v0.16.10 (2026-07-03)" />

Conversations are editable, not append-only:

| Action | Where | What it does |
|---|---|---|
| **Edit and resend** | Pencil icon under your own message | Rewrite the message and press **Resend**. As the note warns, "Resending replaces the conversation after this message." Attached notes are re-attached automatically. |
| **Regenerate response** | Circular-arrow icon under an AI reply | Asks the model to answer the same question again. |
| **New chat from here** | Fork icon under an AI reply | Starts a new chat carrying the conversation up to that reply, leaving the original intact. Forked chats show a **Forked** badge in the history list. |

## Chats stay with the note — and keep running <Badge type="tip" text="Added in v0.17.1 (2026-07-06)" />

Each note keeps its own chat history, saved with the note. In the panel header, **Chat history** lists past conversations (with message counts), **+ New chat** starts a fresh one, and **Clear chat** discards the current one.

Switching notes does not kill a running answer. The request keeps going in the background, the result is written back to the correct note's chat, and when you return to that note the **Chat** tab reopens on the conversation.

## Using an answer

Every AI reply has action buttons underneath:

| Button | What it does |
|---|---|
| **Insert into note** | Inserts the answer into the note as blocks |
| **Replace in note** | Replaces the source blocks with the answer (shown when the chat was started from specific blocks) |
| **Derive as note** | Creates a new note from the question and answer, with provenance linking back to the source note, and opens it in the side peek |
| **Make Knowledge** | Extracts knowledge candidates from the answer (below) |

### Extracting knowledge from a chat <Badge type="tip" text="Added in v0.16.8 (2026-07-02)" />

**Make Knowledge** turns a good answer into entries in your [Knowledge layer](/knowledge-layer) — without saving anything you didn't choose. Graphium shows "Extracting claims…", then "Generating insights…", and presents a picker titled **Knowledge candidates (select to save)**. Each candidate carries a **Claims** or **Insights** badge; use **Select all** / **Clear**, then **Save selected (n)** — or **Cancel** to keep nothing. Only the candidates you pick become knowledge pages.

## The Composer (⌘K)

Press `⌘K` to open the Composer — one input for both "find a note" and "ask the AI". The AI half needs a registered AI model; the search half does not. `Esc` closes it.

The placeholder says it all: **Find a note or ask AI...**

Both halves are live while you are editing a note. From any other screen <Badge type="tip" text="Added in v0.35.0 (2026-08-13)" /> — the note list, the materials gallery, the Knowledge hub — there is no open note for an answer to be about, so the Composer opens in a search-only form: the placeholder reads **Find a note or an asset...**, and the AI row, the suggestion cards, and the **Grounding** chip are absent. The same search-only form is what you get when no AI model is registered at all <Badge type="tip" text="Added in v0.39.0 (2026-08-17)" /> — the search half needs no AI, so `⌘K` still opens.

![Composer palette with the verb menu on a note with citations](/screenshots/composer-verbs.png)

### Finding notes

As you type, matching notes appear instantly, searched by title, headings, labels, and author — and by the words in the note body, through the same on-device full-text index the AI chat uses <Badge type="tip" text="Added in v0.39.0 (2026-08-17)" />. A body match shows an excerpt around the matched words under the title, so you can tell why a note is listed before opening it. Title and heading matches rank above body-only matches. Two filter tokens narrow the list, as the footer hints ("#label / @author to filter"):

| Token | Filters by |
|---|---|
| `#label` | Notes containing that label |
| `@author` | Notes by that author |

With an empty input you get **Recent notes**. Press `Enter` to open the highlighted note.

### Finding assets <Badge type="tip" text="Added in v0.35.0 (2026-08-13)" /> {#finding-images}

Assets are searched alongside the notes and listed under **Assets**. Images you have [read with OCR](/materials-and-citations#reading-text-from-images-ocr) match on their file name and on the words read out of them; PDFs, URLs, and documents match on their name and on their text (the text of a PDF, the excerpt and description of a URL) through the same full-text index <Badge type="tip" text="Added in v0.39.0 (2026-08-17)" />. Each row carries a thumbnail — or a type icon for non-images — and an excerpt around the match, so two similar screenshots, or two papers, are told apart before you open either.

Selecting one opens the materials gallery on that asset's tab, with the asset in the side peek — rather than jumping to a note. One asset can be used by several notes, or by none, and the peek lists the notes that use it.

Assets stay out of the empty-input view and out of `#label` / `@author` queries; both of those are about finding notes.

![The Composer listing a photographed furnace panel under Assets, found by the words inside it](/screenshots/composer-image-search.png)

### Asking the AI

The last row of results is always **Ask AI: "your text"** — select it, or press `⌘Enter` to send your input straight to the AI regardless of what is highlighted. The answer opens in the chat panel as a fresh conversation, and anything the current note cites with `@` (knowledge pages, document notes) is handed to the AI as context automatically. The Composer has the same **Grounding** chip and web-search warning as the chat panel.

### Verb buttons on notes with citations

On a note that cites claims or insights, opening the Composer with an empty input shows a set of one-click questions about the cited set, under the heading **Ask the AI (this note + N citations)**:

| Group | Buttons |
|---|---|
| Examine the cited set | **Find contradictions** · **Point out gaps** · **Next validation** |
| Broaden the direction | **Alternative approach** · **Counterexample** · **Analogies nearby** |

An optional text field ("Add a note to steer the AI (optional)") lets you add one line of guidance; clicking a verb fires immediately. These are the questions that get sharper as your citation set grows — a single LLM prompt can't check *your* claims against each other, but this can.

## Skills: saved prompt templates

A skill is a reusable instruction document — for example a writing-voice guide or a domain glossary — that Graphium can apply automatically. Open the **Skill** section in the sidebar to see them. Graphium ships with built-in system skills, which cannot be deleted but can be edited and restored with **Reset to default**.

Each skill's **Edit** dialog controls:

| Setting | Effect |
|---|---|
| Description | Shown as a label in the list ("not sent to the AI — the AI reads the prompt body") |
| **Language** | **All languages** / **Japanese** / **English** — "Applied only when the generation language matches." |
| **Auto-apply on Ingest** | When on, the skill's prompt is automatically appended as instructions when Graphium generates knowledge from your notes — and in AI chat conversations |

Skills are ordinary documents: click one to edit its prompt body like any note.
