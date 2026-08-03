# Materials & citations

Research rarely starts from a blank page — it starts from a paper, a web page, a photo of a whiteboard. Graphium keeps those external sources as **materials**: first-class items with their own gallery, reader view, memos, and graph, so every note you write can point back to the evidence it came from. This page covers bringing material in, reading and quoting it, extracting text from images, translating PDFs, and citing materials and knowledge inside your notes.

## The material gallery

The sidebar has a **Materials** section with one entry per type: **Images**, **Documents** (PDFs and Word files), **Videos**, **Audio**, and **URLs**. Click any of them to open the gallery. Memos have their own gallery — the **Memos** entry next to Notes.

Inside the gallery you can:

| Control | What it does |
|---|---|
| **Gallery** / **List** | Switch between thumbnail cards and a table with **Name**, **Date**, **Used in**, and **Size** columns |
| Search box | Filter materials by name |
| **Upload** | Upload a file of the current type |
| **Add URL** | Register a web page as a URL bookmark |
| **Add PDF** / **Add Word** | Add a PDF or Word file as a material — no note is created |
| Checkboxes | Multi-select for bulk download, delete, or bulk AI actions |

The **Used in** count tracks which notes reference each material. When you try to delete a material that notes still use, Graphium recommends **Archive (recommended)** instead — archiving hides it from the library while keeping existing references working.

![The material gallery showing documents](/screenshots/material-gallery.png)

## Bringing material in

There are several routes, all ending in the same library:

| Route | How |
|---|---|
| Drag & drop or paste | Drop a file into a note (or paste an image from the clipboard). It is uploaded to your library and inserted as a block |
| Slash menu | Type `/` and pick **Image**, **Video**, **Audio**, or **Document** ("Upload new or insert existing PDF / Word"). The picker offers **Upload from file** and an **Insert as** choice: **Embed** (content expands inline) or **Link** (an @-link; content stays collapsed) |
| Paste a URL | Pasting a URL into a note opens a small menu: **Link** ("Paste as inline text") or **Bookmark** ("Display as a card with preview"). Either way the URL is registered in the **URLs** gallery |
| Slash menu **Bookmark** / **PDF** | Insert a URL card or an embedded PDF viewer directly as a block |
| Gallery buttons | **Upload**, **Add URL**, **Add PDF**, **Add Word** — add materials without touching any note |
| Markdown import | In the note list, the **Import files** button offers **Import Markdown (.md)** and **Import Obsidian Vault folder**. `[[wikilinks]]` are resolved to note links where possible |
| Mobile capture | Photos and memos captured on your phone land in an inbox — see [Mobile](/mobile) |

Word files get extra care: the built-in preview converts formats browsers cannot show (EMF and TIFF, common in documents with pasted Excel charts), and the material menu's **Extract embedded images** pulls the embedded images out of a PDF or Word file and registers them as image materials of their own.

## Reading materials: side peek and reader view <Badge type="tip" text="Added in v0.9.2 (2026-05-26)" />

Clicking a material opens it in a side peek next to your note, so you can read without leaving what you are writing. Use **Open in full view** for a full-screen reading layout.

- **PDFs** render with a selectable text layer, zoom controls, and page navigation.
- **URLs** open in Reader Mode — a cleaned-up article view fetched from the page. Reader images can be saved into your library with **Save image**.
- **Word files** (.docx) get an inline preview.

Select text in a PDF, Word preview, or URL reader and a small pill appears: **Save as memo**. The selection becomes a quote memo with its source attached — collect quotes while reading, then insert them into notes later via the `/` menu's **Memo** item ("Insert from saved memos"). When inserting, Graphium asks whether to **Insert and keep memo** or **Insert and delete memo**. Quote memos with a source are inserted as quote blocks with a "— source" attribution line.

![Selecting text in the PDF reader to save a quote memo](/screenshots/pdf-reader-quote.png)

## Per-material memos, chat, and graph

Every material carries its own workspace. In full view, the right panel has four tabs:

| Tab | What it shows |
|---|---|
| **Memos** | Memos attached to this material — quotes you saved plus anything you write in the box |
| **Asset graph** | A graph of the notes that use this material; click a node to open the note |
| **Metadata** | File details, and per-type actions like **Extract embedded images** |
| **Ask AI** | A chat scoped to this material — ask questions about the document (needs AI) |

Everything except **Ask AI** works without any AI setup.

## Turning materials into notes and knowledge (AI)

The menu on a PDF, Word, or URL material offers three AI-powered conversions. All of them need a configured model — see [AI setup](/ai-setup).

- **Extract steps into a note** — reads the source and builds a structured note with steps, labels, and highlights already in place, ready for the [provenance graph](/labels-and-provenance).
- **Translate into a note** <Badge type="tip" text="Added in v0.14.0 (2026-06-05)" /> — translates the full PDF or web page into your display language, page by page, keeping the original structure. A glossary is extracted first so terminology stays consistent, and embedded figures are placed back near their captions in the translated note.
- **Add to Knowledge** — distills the source into your [Knowledge layer](/knowledge-layer).

Bulk versions of these appear when you multi-select materials in the gallery. Memos have an equivalent: select memos in the Memos gallery and turn them into Knowledge in one step.

## Reading text from images (OCR) <Badge type="tip" text="Added in v0.21.0 (2026-07-26)" />

Graphium can read the text inside any image — instrument screenshots, plots, photos of labels — entirely on your device using Tesseract. No LLM is involved and no AI setup is needed; the image never leaves your machine (only the OCR engine and its language data are fetched from the web).

Three ways in:

1. Click an image block — the toolbar shows **Read text from image**.
2. The same item lives in the block's drag-handle (⠿) menu.
3. Images newly added while a note is open are read automatically, with a progress toast so nothing runs silently.

Once extracted, the text works for you in several places: note search matches it (results show an **image text** badge), and you can view and **Copy** the raw text from the image toolbar.

![Reading text from an image block](/screenshots/image-ocr.png)

## Citing knowledge in a note <Badge type="tip" text="Added in v0.12.3 (2026-05-29)" />

Under the `/` menu's "Existing knowledge" group, **Claims** and **Insights** open a picker over your [Knowledge layer](/knowledge-layer) entries. Search by title, select several at once, and press **Insert** (`⌘Enter`, `Ctrl+Enter` on Windows/Linux). Each citation is inserted as an @-link and recorded as a reference, so the note's **Graph** tab shows an edge from your note to the cited knowledge.

Citing itself calls no AI — it just links existing entries. AI features like the [Composer](/ai-chat-and-ask) then use those citations as context.

## @-mentions of materials

Type `@` in a note and the mention menu lists notes to link — plus a **Document materials** group with your PDFs and Word files. Mentioning a material inserts an @-link and registers the document as cited by the note, which means the Composer and AI chat can read its full text and your highlight memos when answering questions about that note. (Choosing **Link** in the media picker does the same thing.)

The mention is a plain link — no AI runs until you actually ask something.

## Block-anchored memos <Badge type="tip" text="Added in v0.19.2 (2026-07-23)" />

Sometimes a thought belongs to one specific block — a doubt about a measurement, a reminder to re-run a step. Open the block's drag-handle (⠿) menu and choose **Add memo** to attach a memo to that exact block.

Anchored memos appear in the note's **Memos** panel with a **Linked block** chip showing the block's current text — the chip follows the block as you edit it. Click the chip to scroll to and highlight the block. If the block is later deleted, the chip keeps the last text it saw, so the memo still tells you what it was about.

## Everything points back to its source

Lineage is the quiet thread through all of this — nothing you derive loses track of where it came from:

- A note created by **Extract steps into a note** or **Translate into a note** gets a **Source** tab in its right panel, holding the original document.
- Knowledge entries list their origins in a **Derived from** section — source notes, PDFs, URLs, Word files, chats, and memos alike. Clicking a source opens the material in a side peek.
- Quote memos carry their source attribution into any note they are inserted into.
- Material nodes in the note graph and network graph open the material directly.

::: tip
This is the same PROV-DM provenance model that powers step labels — see [Labels & provenance](/labels-and-provenance) for the full picture.
:::
