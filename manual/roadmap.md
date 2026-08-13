# Feature roadmap

Graphium has shipped small releases since March 2026. This page is the retrospective view: the milestones that changed what you can do, in order, with links into the manual. It is deliberately selective — for every pull request in every release, see the [release history](/release-history).

::: tip Reading the versions
Feature pages carry a badge like <Badge type="tip" text="Added in v0.18.0 (2026-07-15)" /> next to the section that describes them. If your app is older than a badge, [update it](/desktop-app#updating) to get the feature.
:::

## 2026 Q1–Q2 · Foundations: editor and provenance

| Version | Date | Milestone |
|---|---|---|
| **v0.1.0** | 2026-03-26 | First release: a block editor on BlockNote, provenance labels, derived notes, and a network graph of how notes relate. |
| **v0.2.0** | 2026-04-08 | **PROV-JSON-LD export** — provenance leaves Graphium in a W3C standard format. Plus the PDF block and an audit trail of note edits. |
| **v0.3.0** | 2026-04-12 | Two turning points: notes work **without an account** (local IndexedDB storage), and the **desktop app** arrives (Tauri shell, bundled AI backend, auto-updater). AI chat gains history. |
| **v0.3.10** | 2026-04-25 | Pick your own [storage folder](/storage-and-sync#changing-the-storage-folder) — point it at a synced folder and sync comes for free. |
| **v0.5.0** | 2026-04-30 | [Inline labels](/labels-and-provenance#inline-labels) become first-class: highlight a span and mark it Input / Tool / Parameter / Output from the toolbar. macOS builds are signed and notarized. |
| **v0.6.0** | 2026-05-05 | [Team-shared storage](/storage-and-sync#sharing-notes-with-your-team) — publish a note to a shared folder and fork what others shared. |

## 2026 Q2 · From sources to knowledge

| Version | Date | Milestone |
|---|---|---|
| **v0.7.0** | 2026-05-21 | The [Knowledge layer](/knowledge-layer) gets its full scaffolding: notes distil into claims, and claims generalize into insights, each citing its sources. |
| **v0.8.0** | 2026-05-21 | [World grounding](/ai-grounding) — position a claim against outside knowledge instead of trusting it blindly. **Windows** desktop builds start here. |
| **v0.9.2** | 2026-05-26 | [Reader view and side peek](/materials-and-citations#reading-materials-side-peek-and-reader-view) for PDFs and web pages — read a source beside your note and quote from it. |
| **v0.12.0** | 2026-05-28 | The [Usage tab](/ai-setup#the-usage-tab): tokens and estimated cost per feature, so AI spending is never a surprise. |
| **v0.12.3** | 2026-05-29 | [Cite your own knowledge](/materials-and-citations#citing-knowledge-in-a-note) from the slash menu — `/claims` and `/insights` with multi-select. |
| **v0.13.6** | 2026-06-04 | [MCP servers](/ai-setup#mcp-servers) connect directly, so the AI can call external tools — web search, your own APIs. |
| **v0.14.0** | 2026-06-05 | [Translate a PDF or web page into a note](/materials-and-citations#turning-materials-into-notes-and-knowledge-ai), page by page, with figures placed back where they belong. |

## 2026 Q2–Q3 · Steerable AI, traceable answers

| Version | Date | Milestone |
|---|---|---|
| **v0.15.2** | 2026-06-08 | [Find in note](/notes-and-editor#finding-text-in-a-note) (`⌘F`). |
| **v0.16.0** | 2026-06-19 | Use a Claude subscription — AI with **no API key**, through the `claude` CLI you already signed into. *(Removed in a later release: Anthropic's terms do not permit third-party apps to use subscription auth — see [Setting up AI](/ai-setup).)* |
| **v0.16.5** | 2026-06-29 | The [global graph](/labels-and-provenance#graph-views-beyond-one-note): every note, source, and knowledge entry in one layered view. |
| **v0.16.6** | 2026-06-30 | [Web search in chat](/ai-chat-and-ask#web-search-in-chat) — answers can reach past your own notes, and say which is which. |
| **v0.16.8** | 2026-07-02 | Two related steps: a [three-way grounding scope](/ai-chat-and-ask#choosing-what-grounds-the-answer) (external / internal / this note), and [turning a chat into knowledge](/knowledge-layer#saving-chat-findings-as-knowledge) through a candidate picker. |
| **v0.16.10** | 2026-07-03 | [Edit, regenerate, and fork](/ai-chat-and-ask#editing-regenerating-and-forking) any message in a chat. `@mentions` follow renamed notes. |
| **v0.17.1** | 2026-07-06 | [Chats stay with the note and keep running](/ai-chat-and-ask#chats-stay-with-the-note-and-keep-running) — switch away mid-answer and it still lands in the right place. |
| **v0.17.3** | 2026-07-13 | [Knowledge growth becomes provenance](/knowledge-layer#provenance-of-knowledge): every generation step is recorded as a PROV activity. |

## 2026 Q3 · More entry points, more structure

| Version | Date | Milestone |
|---|---|---|
| **v0.18.0** | 2026-07-15 | [Version snapshots](/notes-and-editor#version-snapshots) — pin a state, reopen it read-only, or fork a new note from it. The **Turn into** menu lands the same day. |
| **v0.19.2** | 2026-07-23 | [Block-anchored memos](/materials-and-citations#block-anchored-memos): a memo can point at one block, not just the note. |
| **v0.21.0** | 2026-07-26 | [Read text from images](/materials-and-citations#reading-text-from-images-ocr) on your own device — photographed labels and screenshots become searchable. |
| **v0.23.0** | 2026-07-28 | [Step blocks](/labels-and-provenance#step-blocks) — a real container for one action, with prev/next links that give the graph its order. |
| **v0.23.1** | 2026-07-29 | [Capture on your phone, receive on your desktop](/mobile#sending-captures-to-your-desktop) through your own cloud storage. |
| **v0.24.0** | 2026-07-30 | [Write formulas without knowing LaTeX](/notes-and-editor#math) — a visual editor with a symbol palette. [Mobile capture](/mobile) graduates from experiment to a standard feature, and [image OCR](/materials-and-citations#reading-text-from-images-ocr) runs on upload and in bulk. |
| **v0.25.0** | 2026-07-30 | This manual goes live at `/Graphium/manual/`, in English and Japanese. |
| **v0.26.0** | 2026-07-30 | [Voice memos](/mobile) record inside Graphium on your phone — tap to record, play it back, then capture — instead of bouncing through the OS recorder. |
| **v0.27.0** | 2026-08-03 | [Columns](/notes-and-editor#columns) — place blocks side by side. Insert from the slash menu, create by dropping a block on another's edge, resize by dragging the gap; narrow layouts stack on their own. |
| **v0.30.0** | 2026-08-09 | [Build procedures from the graph](/labels-and-provenance#editing-from-the-graph) — the flow view becomes a node editor. Add and rename steps, fill each step's inputs, tools, outputs, and parameters in a side panel, and every edit lands in the note's own tables. |
| **v0.31.0** | 2026-08-12 | [Cite shared entries in your notes](/storage-and-sync#cite-a-shared-entry-in-your-notes) — a **Cite shared entry** slash command inserts a citation card for a note, reference, or data file in the team's shared folder. Cards keep a lightweight snapshot so they render even offline, follow in-place updates, and flag major revisions instead of changing under you. |
| **v0.32.0** | 2026-08-13 | [A readable line width](/notes-and-editor#readable-line-width) by default — on wide screens the note body becomes a centered column, with a per-note **Full width** toggle for wide tables and charts. |
| **v0.33.0** | 2026-08-13 | [Run AI on a GitHub Copilot plan](/ai-setup#adding-a-model) — no API key, through the `copilot` CLI you already signed into. This is also the release that removes the Claude subscription provider. |
| **v0.34.0** | 2026-08-13 | [The time-series table and charts](/notes-and-editor#the-time-series-table-and-charts): rows stamp their own date and time, and a chart block draws any table in the note in a publication-ready style — several tables in one chart, two Y axes when units differ. Time-series and note-per-row become toggles on the one table type, and [reading-color presets](/settings) join the fonts. |

## Requests welcome

Graphium grows with the people who use it. If something you need is missing — or something already here gets in your way — please tell me: [@kumagallium on X](https://x.com/kumagallium), or open an [issue](https://github.com/kumagallium/Graphium/issues) on GitHub.
