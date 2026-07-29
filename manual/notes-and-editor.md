# Notes & editor

This page covers everything about writing in Graphium: creating notes, finding them again, and the block editor — block types, the slash menu, the step block, math, media, templates, index tables, note links, and saving. Labels and the provenance graph have their own page: [Labels & provenance](/labels-and-provenance).

![The Graphium editor with the provenance panel open](/screenshots/editor-with-graph_en.png)

## Creating a note

Click **+ Note** at the top of the sidebar ("Open a new note"). A blank note opens with the cursor in the title field ("Note title"). The note file is created on first save — start typing and autosave does the rest.

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

## Slash menu reference

Typing `/` shows the standard blocks plus four Graphium-specific groups:

![The slash menu showing the Advanced and Existing media groups](/screenshots/slash-menu.png)

### Advanced

| Item | Description |
|---|---|
| **Index Table** | "Insert a table for data management" |
| **Template** | "Insert a plan or experiment template" |
| **Callout** | "Insert a note box with an icon" |
| **Step** | "A step that holds text, tables and images inside" |
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

## The step block <Badge type="tip" text="Added in v0.23.0 (2026-07-28)" />

The step block is the editor's only container: it holds text, tables, and images that belong to one procedural step, and each step becomes an *Activity* in the provenance graph. New steps are titled **Step 1**, **Step 2**, … automatically; the title is the activity name.

![A step block with a Prev step chip in the header and a Next step chip at the bottom](/screenshots/step-block.png)

- The **Prev step** chip in the header links this step to the one it follows. Loops are refused ("Blocked: this would create a cycle").
- The **Next step** chip at the bottom jumps ahead: with no successor it creates one (**Create new**) pre-linked to the current step; with successors it opens a picker to link, unlink, or add.

Chained steps give you the run order for free — see [Labels & provenance](/labels-and-provenance) for what the graph does with it.

## Math

**Formula** inserts a display equation on its own line; **Inline formula** drops one into a sentence ("Click to edit"). Both open an editor with two modes you can switch between at any time:

- **Write with symbols** — a visual math editor: type `x/y` to get a fraction, with a symbol palette for the rest.
- **Write in LaTeX** — edit the LaTeX source directly ("Enter a formula (LaTeX)").

Your last-used mode is remembered on this device. Formulas are stored as LaTeX and rendered with KaTeX, so they survive export as plain `$$ … $$` math.

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

## The index table

**Index Table** inserts a table built for managing a list of samples, runs, or items, with **Name**, **Condition 1**, and **Condition 2** columns you can rename and extend. Each row can own a note:

- Fill the first column, then click the row's icon ("Create note for A-01") to generate a linked note for that row. An empty first column shows "Enter the note title in the first column" instead.
- Typing `@` inside a row's first column links the row to an existing note instead.
- Linked rows offer **Open note** and **Side peek** — the side peek opens the row's note next to the current one, so you can update a run without leaving the plan.

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

## Selecting multiple blocks

Drag across several blocks to select them together. A floating toolbar appears with **Delete**, **Color**, and **Ask AI about selection**, so you can clean up or question a whole passage at once.

## Finding text in a note <Badge type="tip" text="Added in v0.15.2 (2026-06-08)" />

`⌘F` (`Ctrl+F` on Windows/Linux) opens the **Find in note** bar. Matches are highlighted with a counter ("2/7"); `Enter` jumps to the next match, `Shift+Enter` to the previous, **Match case** toggles case sensitivity, and `Esc` closes the bar.

## Inserting saved memos

**Memo** in the slash menu opens the **Select memo** picker with everything you have captured — quick memos (`⌘⇧M`, `Ctrl+Shift+M` on Windows/Linux) and notes-to-self from your phone. Pick one to drop its text into the note. See [Mobile](/mobile) for capturing on the go.

## Saving

Graphium autosaves three seconds after you stop editing; the header shows **Unsaved**, **Saving...**, and **Saved** so you always know where you stand. `⌘S` (`Ctrl+S` on Windows/Linux) saves immediately. If you want a named, restorable version of the note — not just a save — press `⌘⇧S`; versions are covered with the rest of note history in [Labels & provenance](/labels-and-provenance).

## Context tags

Under the title of every note sits a **Context** button. Context tags are free-form categories or themes ("battery project", "reading notes") — type to add one, or pick from tags you have used before. They are the fastest way to slice the notes list (**Filter by context**) and to color the global graph by project.

## Empty-note hints

A brand-new note shows a quiet row of hints below the editor: "Start writing, or try one of these:" — **Ask AI** ("Ask AI about your note, or insert its answer"), **Link a note** ("Type @ inline to reference another note"), and **Slash menu** ("Type / in an empty line for blocks and tools"). The **Ask AI** chip only appears once AI is [set up](/ai-setup). The hints disappear as soon as the note has content.
