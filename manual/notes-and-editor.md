# Notes & editor

This page covers everything about writing in Graphium: creating notes, finding them again, the block editor — block types, the slash menu, math, media, templates, index tables, note links — and how saving, history, and versions work. Step blocks and the provenance graph they feed have their own page: [Labels & provenance](/labels-and-provenance).

![A plain Graphium note: headings, lists, a quote, and a table](/screenshots/editor-plain.png)

## Creating a note

Click **+ Note** at the top of the sidebar ("Open a new note"). A blank note opens with the cursor in the title field ("Note title"). The note file is created on first save — start typing and autosave does the rest.

![A new note: a title and plain lines — nothing else required](/screenshots/first-note.png)

::: info No ⌘⇧N shortcut
Graphium deliberately does not bind `⌘⇧N` (`Ctrl+Shift+N` on Windows/Linux) to "new note" — browsers reserve that combination for a new incognito window. The **+ Note** button is the entry point. See [Shortcuts](/shortcuts) for what is bound.
:::

## The notes list

**All Notes** shows every note as a table with a search box ("Search notes...") and a live count ("12 / 40 notes"). The sidebar also keeps a **Recent Notes** section for quick jumps back to what you last opened, with **Show all** leading to the full list.

| Control | What it does |
|---|---|
| **Sort by modified** / **Sort by created** / **Sort by title** / **Sort by outgoing links** | Reorders the list. The default is by creation date. |
| **Filter by label** | Show only notes that contain a given provenance label. |
| **Filter by author** | Filter by who wrote the note — and which LLM assisted. |
| **Filter by context** | Filter by [context tags](#context-tags). |
| **Clear filter** | Back to everything. |

Selecting rows lets you act in bulk: move notes to trash, archive them, or add a context tag to all of them at once. Archived and trashed notes live in the **Trash & Archive** view — archiving shelves a note while links and citations to it keep resolving.

![The notes list with link counts, labels, and context columns](/screenshots/notes-list.png)

## Editor basics

The editor is block-based: every paragraph, heading, or table is a block you can drag, style, and convert. Press `/` on an empty line to insert a block, or select text for the formatting toolbar. The standard building blocks are paragraphs, headings (three levels), bulleted, numbered, check and toggle lists, quotes, code blocks, and tables.

### The turn-into menu <Badge type="tip" text="Added in v0.18.0 (2026-07-15)" />

Hover a text block and open the drag-handle (⠿) menu; **Turn into** converts the block in place:

**Text** · **Heading 1** · **Heading 2** · **Heading 3** · **Bulleted list** · **Numbered list** · **Check list** · **Toggle list** · **Quote** · **Code**

### The drag-handle (⠿) menu

The full menu, top to bottom:

| Item | What it does |
|---|---|
| **Turn into** | Convert a text block to another type (see above). |
| **Delete** | Remove the block. |
| **Color** | Text and background color. |
| **Align** | **Align left** / **Align center** / **Align right** — works even for tables, audio, and file blocks. |
| **Label** | Mark a table or media block as an Entity in the provenance graph — see [Labels & provenance](/labels-and-provenance). |
| **Read text from image** | On-device OCR for image blocks — see [Materials & citations](/materials-and-citations). |
| **📝 Add memo** | Attach a memo to this block; it shows up in the Memos panel. |
| **🔗 Derive new page** | Fork a new note that records where it came from. |
| **🤖 AI Assistant** | Ask AI about this block (headings and steps pass their whole section). Hidden until AI is set up — see [AI setup](/ai-setup). |

![The drag-handle menu on a paragraph](/screenshots/drag-handle-menu.png)

## Slash menu reference

Typing `/` shows the standard blocks plus four Graphium-specific groups:

![The slash menu showing the Advanced and Existing media groups](/screenshots/slash-menu.png)

### Advanced

| Item | Description |
|---|---|
| **Index Table** | "Insert a table for data management" |
| **Log Table** | "A table that timestamps each new record" — see [The log table and charts](#the-log-table-and-charts) |
| **Chart** | "Visualize a table in this note" — see [The log table and charts](#the-log-table-and-charts) |
| **Template** | "Insert a plan or experiment template" |
| **Callout** | "Insert a note box with an icon" |
| **Step** | "A step that holds text, tables and images inside" — the container behind the provenance graph; see [Labels & provenance](/labels-and-provenance#step-blocks) |
| **Columns** | "Place blocks side by side in two columns" — see [Columns](#columns) |
| **Formula** | "Show a formula on its own line (LaTeX)" |
| **Inline formula** | "Put a formula inside a sentence (LaTeX)" |

### Existing media

| Item | Description |
|---|---|
| **Image** | "Upload new or insert existing image" |
| **Video** | "Upload new or insert existing video" |
| **Audio** | "Upload new or insert existing audio" |
| **Document** | "Upload new or insert existing PDF / Word" |
| **Bookmark** | "Display URL as a card" |
| **PDF** | "Embed a PDF file" |
| **Memo** | "Insert from saved memos" |

### Existing knowledge

| Item | Description |
|---|---|
| **Claims** | "Cite existing claim notes (multi-select)" |
| **Insights** | "Cite existing insight notes (multi-select)" |

These cite notes from your [Knowledge layer](/knowledge-layer).

### Notes

| Item | Description |
|---|---|
| **New note** | "Create a named note and link it here" |

## Math <Badge type="tip" text="Added in v0.24.0 (2026-07-30)" />

**Formula** inserts a display equation on its own line; **Inline formula** drops one into a sentence ("Click to edit"). Both open an editor with two modes you can switch between at any time:

- **Write with symbols** — a visual math editor: type `x/y` to get a fraction, with a symbol palette for the rest.
- **Write in LaTeX** — edit the LaTeX source directly ("Enter a formula (LaTeX)").

Your last-used mode is remembered on this device. Formulas are stored as LaTeX and rendered with KaTeX, so they survive export as plain LaTeX math delimiters.

![The formula editor in visual mode, with a toggle to LaTeX](/screenshots/math-editor.png)

## Columns <Badge type="tip" text="Added in v0.27.0 (2026-08-03)" />

**Columns** places blocks side by side — observations next to their discussion, a table next to the photo it describes. Insert one from the slash menu (`/columns`) and you get two columns, each holding any blocks you like: paragraphs, headings, tables, images, even steps.

- **Create by dragging** — grab a block by its handle (⠿) and drop it on the **left or right edge** of another block: a vertical drop cursor appears and the two become columns. Dropping on the edge of an existing column (or in the gap between columns) adds a new column there instead.
- **Resize** — drag the gap between two columns to change their widths.
- **Move blocks in and out** — drag a block by its handle (⠿) into a column, or use Backspace / Delete at a column edge to merge content across the boundary. Dragging the last block out of a column dissolves the column.
- **Narrow layouts stack** — when the note is too narrow to fit the columns side by side (the side peek, a phone), they stack vertically on their own. Nothing is hidden.

Columns are layout only: search, the outline, AI chat, and Markdown export all read the content inside them just as if it were written top to bottom.

::: warning Update all your devices first
Opening a note that uses columns in an **older version of Graphium** silently removes the columns *and everything inside them* on the next save — older versions do not know the block type. If you use Graphium on several devices, update all of them before you start using columns.
:::

## Callout, bookmark, and PDF

- **Callout** is a note box with an icon; pick a variant: **Note**, **Info**, **Success**, **Warning**, or **Danger**.
- **Bookmark** shows a URL as a card ("🔗 Enter a URL"); inserting one opens a picker so you can reuse an already-registered URL.
- **PDF** embeds a PDF right in the note ("Drag & drop a PDF file, or insert one from the slash menu").

## Inserting media

**Image**, **Video**, **Audio**, and **Document** all open the same picker: choose **Upload from file** for something new, or select a material you have already imported. The **Insert as** switch controls the result — **Embed** ("Expand the content inline in the note") or **Link** ("Insert as an @link (content stays collapsed)"). Everything you upload also lands in the material library — see [Materials & citations](/materials-and-citations).

## Templates

**Template** opens the **Insert Template** modal with two built-in layouts:

| Template | What you get |
|---|---|
| **Plan Template** | "Comparison plan with an index table linking items to detail notes" |
| **Run Template** | "Per-item record with PROV-labeled steps and prev-step linking" |

The modal is searchable and lists each template's **Source** (**Official** or **User**) and **Tags**. The two templates are designed as a pair: plan the comparison in one note, then generate a Run note per row of its index table.

![The Insert Template modal with the Plan and Run templates](/screenshots/template-picker.png)

## The index table

**Index Table** inserts a table built for managing a list of samples, runs, or items, with **Name**, **Condition 1**, and **Condition 2** columns you can rename and extend. Each row can own a note:

- Fill the first column, then click the row's icon ("Create note for A-01") to generate a linked note for that row. An empty first column shows "Enter the note title in the first column" instead.
- Typing `@` inside a row's first column links the row to an existing note instead.
- Linked rows offer **Open note** and **Side peek** — the side peek opens the row's note next to the current one, so you can update a run without leaving the plan.

![An index table with Name and condition columns](/screenshots/index-table.png)

## The log table and charts

**Log Table** inserts a table for recurring, time-stamped observations — a headache diary, a growth log, repeated measurements on the same setup. It starts with **Date/Time**, **Value**, and **Note** columns you can rename and extend. There is no special button: add rows the way you add rows to any table (the + strip under the table, or pasting), and the current date and time is filled into the first column automatically.

The timestamp is ordinary cell text. You can edit it afterwards (recording last night's episode the next morning is fine), and because the whole thing is a standard table, it exports to Markdown and PDF unchanged. A caption above the table names it; unnamed log tables show an automatic *Table 1*, *Table 2*, … in document order, and charts use that name as the reference label.

A log table is not a separate kind of table — it is an ordinary table with this behavior switched on. Any existing table can become one (and stop being one) from the drag-handle (⠿) menu: "**Turn into log table**".

**Chart** turns any table in the note into a graph, drawn in a publication style — a framed plot area with inward ticks, axis labels, and an A-series (√2:1) aspect ratio — so the figure looks at home in academic writing. Insert it, pick a table, and open **Settings** in the top-right corner. The panel has three tabs:

- **Type & Series** — the chart type (**Line**, **Bar**, **Scatter**, or **Histogram** — the distribution of a numeric column) and the series. A series is the unit that knows its data: expand one to set its display label, its **data assignment** (the source table — picked by caption, e.g. *Table 1* — and the X/Y columns), its own chart type (mix a bar series into a line chart), a color, and which Y axis it belongs to. Series can point at **different tables**, so two logs can be overlaid on one figure, and assigning a series to the **right** axis gives it its own scale: pain 0–10 on the left, pressure around 1000 hPa on the right.
- **Axes** — the X-axis scale type (**Auto** / **Time** / **Numeric** / **Category** — auto-detection can be overridden), axis labels, min/max ranges for the X axis and for the left — and, when in use, the right — Y axis, and vertical/horizontal grid lines. Line and scatter axes fit the data range; bars always start at zero.
- **Appearance** — a figure caption shown under the chart, the aspect ratio, the legend (above the plot aligned to its frame, inside any of the four corners, or below; horizontal or vertical), and the plot frame.

The table stays the source of truth: edit a cell or add a record and the chart follows. If the referenced table is deleted, the block shows "The referenced table was not found in this note" and lets you pick another one.

## Linking notes with @

Type `@` anywhere in the text to open the link menu. Candidates are grouped:

| Group | Contains |
|---|---|
| **This note** | Headings inside the current note. |
| **Other notes** | Your other notes, most recent first. |
| **AI Knowledge** | Knowledge-layer notes, labeled like "🤖 Summary: …". |
| **Document materials** | Imported PDF / Word materials, for citing sources. |
| **New** | **Create a new note…** — name it in a dialog, and it is created and linked in one step. |

Mentions are live references, not plain text: rename a note and every `@mention` of it updates in the notes that refer to it. <Badge type="tip" text="Added in v0.16.10 (2026-07-03)" />

![The @ menu grouped by other notes, AI knowledge, and create-new](/screenshots/at-mention.png)

## Selecting multiple blocks

Drag across several blocks to select them together. A floating toolbar appears with **Delete**, **Color**, and **Ask AI about selection**, so you can clean up or question a whole passage at once.

## Finding text in a note <Badge type="tip" text="Added in v0.15.2 (2026-06-08)" />

`⌘F` (`Ctrl+F` on Windows/Linux) opens the **Find in note** bar. Matches are highlighted with a counter ("2/7"); `Enter` jumps to the next match, `Shift+Enter` to the previous, **Match case** toggles case sensitivity, and `Esc` closes the bar.

![The find-in-note bar with a highlighted match](/screenshots/find-in-note.png)

## Inserting saved memos

**Memo** in the slash menu opens the **Select memo** picker with everything you have captured — quick memos (`⌘⇧M`, `Ctrl+Shift+M` on Windows/Linux) and notes-to-self from your phone. Pick one to drop its text into the note. See [Mobile](/mobile) for capturing on the go.

![The Select memo picker](/screenshots/memo-picker.png)

## Saving

Graphium autosaves three seconds after you stop editing; the header shows **Unsaved**, **Saving...**, and **Saved** so you always know where you stand. `⌘S` (`Ctrl+S` on Windows/Linux) saves immediately.

## History and versions

Every save is kept. The **History** tab in the right panel lists what changed (blocks, labels) and who changed it: human edits carry the name and email from your author profile ([Settings](/settings) → **Storage**), AI edits carry an **AI** badge and the model that made them, with entry types like **Edit**, **Derive**, **AI Generate**, and **Template**.

![The history panel with a pinned version and the revision list](/screenshots/history.png)

### Version snapshots <Badge type="tip" text="Added in v0.18.0 (2026-07-15)" />

Automatic history is fine-grained; sometimes you want to pin a moment on purpose — "the state we submitted." Press `⌘⇧S` (`Ctrl+Shift+S` on Windows/Linux; `⌘⌥S` works too, for keyboards where `⌘⇧S` is taken) or click **Save version** at the top of the **History** tab.

Saved versions are listed in the same panel. Each one offers:

| Action | What it does |
|---|---|
| **Open** | View the version side-by-side, marked **Read-only** |
| **Fork from here** | Create a new note from this version, with lineage back to the original |
| **Rename** | Give the version a meaningful name |
| **Delete** | Remove the version (the note itself is untouched) |

Forking is how you explore a different direction without losing the original: the new note records where it came from, and that link shows up in the [lineage graph](/labels-and-provenance#graph-views-beyond-one-note).

## Context tags

Under the title of every note sits a **Context** button. Context tags are free-form categories or themes ("battery project", "reading notes") — type to add one, or pick from tags you have used before. They are the fastest way to slice the notes list (**Filter by context**) and to color the global graph by project.

## Empty-note hints

A brand-new note shows a quiet row of hints below the editor: "Start writing, or try one of these:" — **Ask AI** ("Ask AI about your note, or insert its answer"), **Link a note** ("Type @ inline to reference another note"), and **Slash menu** ("Type / in an empty line for blocks and tools"). The **Ask AI** chip only appears once AI is [set up](/ai-setup). The hints disappear as soon as the note has content.
