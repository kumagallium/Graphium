# Materials & citations

Research rarely starts from a blank page — it starts from a paper, a web page, a photo of a whiteboard. Graphium keeps those external sources as **materials**: first-class items with their own gallery, reader view, memos, and graph, so every note you write can point back to the evidence it came from. This page covers bringing material in, reading and quoting it, extracting text from images, translating PDFs, and citing materials and knowledge inside your notes.

## The material gallery

The sidebar's **Materials** tab has one entry per type: **Memos**, **Images**, **Documents** (PDFs, Word, PowerPoint, and Excel files), **Data** (the `.csv` / `.txt` / `.dat` files instruments write, [imported as tables](/notes-and-editor#importing-measurement-data)), **Videos**, **Audio**, and **URLs**. Click any of them to open the gallery.

<Badge type="tip" text="Added in v0.52.0 (2026-09-03)" /> Materials can go in folders too — the same folders your notes use. Open a material and use the **Folder** button under its name: type to create a folder or pick one you have used before, and click **×** on a folder to take the material out again. In the list view you can do the same from a row — click its folders, or hover a row that has none and click **Folder**. To file several at once, select them and choose **Add N to a folder**; folders that every selected material is already in show as checked, so unchecking one takes them all out of it. Use the **Folders** button above the list to show only what is in one. A material keeps its folder whether or not any note uses it yet, so you can file a PDF the day you download it. It also picks up the folders of the notes it is used in — put a photo in a note that lives in **Material X** and the photo shows up under **Material X** as well, shown in a lighter chip. Those follow the note: move the note out and the photo stops appearing there, while folders you set by hand always stay. A lighter chip has no **×** — to take the photo out of that folder, change the note's folders.

Inside the gallery you can:

| Control | What it does |
|---|---|
| **Gallery** / **List** | Switch between thumbnail cards and a table with **Name**, **Used in**, and **Date** columns (in **Documents**, a **Pages** column as well) |
| Search box | Filter materials by name (typing an extension such as `.m4a` works too) |
| **All** / **PDF** / **Word** / **Excel** / **PowerPoint** | In **Documents**, show one kind of file. Older `.doc` / `.xls` / `.ppt` files count with Word, Excel, and PowerPoint. Only kinds you have at least one file of are listed |
| **Upload** | In **Images**, **Data**, **Videos** and **Audio**: upload files of the current type. Like **Add PDF** below, they go through the intake sheet, so you see progress and a report |
| **Add URL** | In **URLs**: register a web page as a URL bookmark |
| **Link a file from a registered folder** | In the image, document, data, video, audio and URL galleries, desktop app only: link a file that lives in a registered linked folder without copying it — see [Link a file without copying it](#linked-files) |
| **Add PDF** / **Add Word** | In **Documents**, under the **⋯** menu at the top right: add PDF or Word files as materials — no note is created. They go through the same intake sheet as [Bring in what you already have](#bring-in-what-you-already-have), so you see progress and a report, and the work keeps going if you move to another screen |
| Checkboxes | Multi-select for bulk download, delete, or bulk AI actions — in either view. Drag across items, or shift-click, to select a range |

Checkboxes work in both views: in **Gallery** they sit in the top-left corner of each tile (hover a tile to reveal one; once anything is selected they stay visible on every tile), and the checkbox next to the sort buttons selects or clears everything currently listed. Either way the same selection bar appears above the materials, carrying the bulk actions — folder, download, delete, the AI actions, and **Share with team** where a [shared folder](/storage-and-sync) is set up. The selected count appears once at the left of the bar; the most used actions sit on the bar, the rest are under **More**, and delete is the trash button at the right end. <Badge type="tip" text="Added in v0.59.0 (2026-09-07)" />

The **Used in** count tracks which notes reference each material. When you try to delete a material that notes still use, Graphium recommends **Archive (recommended)** instead — archiving hides it from the library while keeping existing references working.

![The Documents screen in list view: 6 items with a search box, All / PDF / Word / Excel / PowerPoint filters and a Folders button, and a table of Name, Pages, Used in and Date for PDF, Word, Excel and PowerPoint files, some with folder labels](/screenshots/material-gallery.png)

### Seeing what is inside a data file <Badge type="tip" text="Added in v0.103.0 (2026-10-29)" /> {#data-file-contents}

In **Data**, each file shows what it holds without being opened. The thumbnail draws the shape of its numeric columns (up to four lines, the same preview the chart's data picker shows), and in the list view the line under the name gives the column names and the number of rows — for example **Columns: hour, dough_temp, room_temp · 48 rows**. The columns drawn as lines are coloured like their lines. A table with no numeric column keeps the table icon but still shows its columns and rows, and a file that cannot be read says **Could not be read**. Files are read as they scroll into view.

![The Data list with line thumbnails and column names](/screenshots/material-data-list.png)

Open a data file to see it in the side peek. **Table** shows it as Graphium reads it automatically, the same way [importing it into a note](/notes-and-editor#importing-measurement-data) starts out. A very large table shows its first 1,000 rows and 200 columns, and says how many rows and columns the whole table has. <Badge type="tip" text="Added in v0.141.1 (2026-11-18)" /> Sorting works on every row, and the first 1,000 rows of the result are shown. **Raw text** shows the file itself, the first 500 lines with line numbers, so you can check whether the automatic reading split it the right way. The line numbers are the ones the import dialog asks for as its start and end rows. If no table comes out at all, the side peek opens on **Raw text**.

![The Raw text tab of a data file's side peek](/screenshots/material-data-raw-text.png)

### Seeing and sorting by page count <Badge type="tip" text="Added in v0.89.0 (2026-10-14)" /> {#page-counts}

Under **Documents**, PDF, Word and PowerPoint files show how many pages they have: in the **Pages** column of the list view, and in the bottom-right corner of each card in the gallery view. Click **Pages** (the column, or the button in the gallery) to put the longest documents first; click again for the shortest. It lets you spot a very long document before you send it to [Knowledge](/knowledge-layer).

PDFs use their real page count, PowerPoint files their number of slides, and Word files the page count saved in the file. A `.docx` written by something other than Word may not carry one; those, Excel files and the older `.doc` / `.ppt` formats show **—**. Materials you already had are counted a few at a time in the background after the app starts, and the counts appear in the list in small batches. Hover **—** to see why there is no number: the kind is not counted, it has not been reached yet, or the file could not be read.

### Using the title inside the file as the name <Badge type="tip" text="Added in v0.89.0 (2026-10-14)" /> {#rename-from-title}

A document still called `scan_0012.pdf` or `Document1.docx` can be renamed from the title written inside it. This works for PDF, Word and PowerPoint files.

- **One at a time**: open the material and choose **Rename using the title inside the file** from the **⋯** menu at the top right. The title fills the name field; edit it if needed and press Enter (Esc cancels).
- **Several at once**: select them and choose **Rename by title** under **More** in the bar. Each file is listed as "current name → new name"; keep the rows you want checked, edit any new name in place, and click **Rename N**.

The title comes from the file's properties first. When that is empty or meaningless (such as "Microsoft Word - ….docx"), it is taken from the body instead: the largest line on the first page of a PDF, the Title or Heading 1 paragraph of a Word file, or the title of the first slide in PowerPoint. The original extension is kept. A title taken from the body can occasionally pick up something like a journal name, so take a look before you confirm.

### The date of a material <Badge type="tip" text="Added in v0.156.0 (2026-11-23)" /> {#material-source-date}

Like a note, a material can carry a **source date**: when the document itself is from, kept apart from the day you brought it in. It is written the same way as a note's ([Source date](/notes-and-editor#source-date)): a year, a year and month, or a full date.

- **Filled in for you** for Word, PowerPoint, Excel and PDF files. Graphium reads the creation date recorded inside the document, on your device. It does not use the date the document was last saved, or the file's modified date, because both change as soon as someone opens the file and saves it again. Materials you already had are read the same way in the background after the app starts. Images, text and other files with no recorded creation date are left empty.
- **Check it.** The recorded creation date is when the file was first made, which is not always when the source is from: a document started from an old template, or a PDF that was regenerated when it was downloaded, can carry a different date. A date filled in this way says **from the file's created date** in the material's details.
- **Setting or changing it.** Open the material: the **Source date** row of its details works like the date under a note's title. Changing or removing it there is final; the background pass never puts back a date you removed, and a new version brought back from Word keeps what you chose.
- **In the list.** Once a material in the list has a source date, a **Source date** column appears next to **Date**. Click it to sort; materials without one sit at the date they were brought in.
- **Notes made from it.** A procedure note made from the material takes its source date.

### Where a material came from (authors, year, publisher, DOI) <Badge type="tip" text="Added in v0.90.1 (2026-10-20)" /> {#source-info}

PDFs, documents and URL bookmarks can carry four pieces of source information: **Authors**, **Year**, **Published in** (a journal, site or publisher) and **DOI**. They appear in the **Source** block of the material's metadata, and show as **Not set** until filled in.

- **When a PDF is brought in**, Graphium reads the DOI and the author names stored inside the file, on your device. The year is never taken from the file, because a PDF's creation date is not its publication year. PDFs brought in before this field existed are read the same way in the background after the app starts, together with their page count. A PDF's author field often holds a computer account or the name of the software that made it, so values that do not look like a person's name are left out, and affiliation marks or garbled characters attached to names are cleaned up.
- **Edit** lets you type any of the four by hand. Separate several authors with `;`.
- **Fill in from DOI** looks the DOI up and fills in the authors, year and publisher. This is the only time anything is sent outside: when you press it, the DOI alone is sent to Crossref (`api.crossref.org`). Nothing is sent automatically. If the material has no DOI yet, a PDF is first searched for one inside the file.
- **Filling in many at once**: select materials and choose **Fill in from DOI** under **More** in the bar (when only some of the selection can be filled in, that count is shown in brackets). The DOIs of the selected materials are sent to Crossref one at a time. Materials already filled in from Crossref, and PDFs whose file had no DOI, are not counted. Anything you typed in yourself is kept; only the empty fields are filled. When it finishes, the bottom-right corner shows how many were filled in, and how many had no DOI, were not on Crossref, or could not be fetched.

![The material metadata list with the Source row offering Edit and Fill in from DOI, followed by filled Authors, Year, Published in and DOI fields for a sourdough paper.](/screenshots/material-source-info.png)

The gallery list shows a short line under each name, such as `Farris et al. · 2025 · JACS Au`. The gallery search, `⌘K` (`Ctrl+K` on Windows/Linux) and the `search_media` tool of the MCP server all search these fields, so typing something like "Leonard 2025" finds the paper.

## Bringing material in

There are several routes, all ending in the same library:

| Route | How |
|---|---|
| Drag & drop or paste | Drop a file into a note (or paste an image from the clipboard). It is uploaded to your library and inserted as a block. Images that arrive as part of copied web-page content are also captured into the library, so they keep working even if the original page goes away |
| Slash menu | Type `/` and pick **Image**, **Video**, **Audio**, **Document** ("Upload new or insert existing PDF / Word"), or **Data** (turns a `.csv` / `.txt` / `.dat` into a table). The picker offers **Upload from file** and an **Insert as** choice: **Embed** (content expands inline) or **Link** (an @-link; content stays collapsed) |
| Paste a URL | Pasting a URL into a note opens a small menu: **Link** ("Paste as inline text") or **Bookmark** ("Display as a card with preview"). Either way the URL is registered in the **URLs** gallery |
| Links already in a note | Clicking a link that is not registered yet — for example one written into the note by an AI chat answer — opens the side peek with an **Add to materials** button in the header. Review the page first, then register it: the URL joins the **URLs** gallery and appears in graphs. Nothing is registered automatically |
| Slash menu **Bookmark** / **PDF** | Insert a URL card or an embedded PDF viewer directly as a block |
| Gallery buttons | **Upload** (Images, Data, Videos, Audio), **Add URL** (URLs), and **Add PDF** / **Add Word** under the **⋯** menu in Documents — add materials without touching any note |
| Bring in what you already have | One intake sheet takes in files and folders you already have on disk — see [Bring in what you already have](#bring-in-what-you-already-have) below |
| Bring in AI conversations | In the desktop app, your Claude Code conversations can be kept as materials — see [Bring in AI conversations](#bring-in-ai-conversations) below |
| Link a file from a registered folder | Desktop app only. Keep a file where it is (an organization's synced folder, say) and add only a record of its location to the library — see [Link a file without copying it](#linked-files) |
| Mobile capture | Photos and memos captured on your phone land in an inbox — see [Mobile](/mobile) |

Word files get extra care: the built-in preview converts formats browsers cannot show (EMF and TIFF, common in documents with pasted Excel charts), and the material menu's **Extract embedded images** pulls the embedded images out of a PDF or Word file and registers them as image materials of their own.

PowerPoint and Excel files brought in through the intake sheet (below) get their own treatment too: a `.pptx` keeps its slide text searchable and pulls its embedded pictures out as image materials, and a `.xlsx` turns each sheet into its own CSV data material (named `<workbook> / <sheet>.csv`) so it flows through the same table import as any other delimited data. <Badge type="tip" text="Added in v0.65.0 (2026-09-08)" /> A `.pptx` or `.xlsx` already sitting in your library that hasn't been expanded yet can still be expanded later from the material menu (**Extract slides and images** / **Turn sheets into tables**). <Badge type="tip" text="Added in v0.66.0 (2026-09-08)" />

## Bring in what you already have <Badge type="tip" text="Added in v0.63.0 (2026-09-08)" />

There are four ways in: **Bring in** in the sidebar, the **Bring in files** chip at the top of an empty note, the empty-state receptacle in the note list and material gallery, or dropping a folder or files anywhere in the window (a banner appears while you drag). The intake screen has two tabs, **Files** and **AI conversations**; this section is about **Files**, and the other tab is described in [Bring in AI conversations](#bring-in-ai-conversations).

![The intake screen on the Files tab, next to the AI conversations tab, with buttons to choose a folder or files](/screenshots/intake-receptacle.png)

The rule is one sentence: **Markdown becomes notes. PDF, Office files, images and CSV become materials.** Audio, video, and delimited data (`.csv` / `.tsv` / `.txt` / `.dat`) are materials too. A `.pptx` or `.xlsx` is expanded on the way in — see above. Old-style `.doc` / `.xls` / `.ppt` files are not taken in yet — the report lists them by extension and count instead of dropping them silently. The same goes for anything else Graphium can't open, such as archives or files without an extension. Hidden files and folders (names starting with `.`, such as `.git` or `.obsidian`) are left out.

In the desktop app, choosing a folder never reads files of a type Graphium can't take in, so a folder of old data full of such files is still quick to go through. Up to 500,000 files that can be taken in are handled in one go; for anything larger, the app asks whether to bring in the first 500,000 or choose a smaller folder.

Whatever order files sit in inside a dropped folder carries over as Graphium folders, for both notes and materials. The name of the folder you dropped is not used as a folder itself.

Obsidian vaults work as they are. `[[wikilinks]]` are resolved first against files in the same batch, then against your existing notes and knowledge entries by title, and images they reference come along too. Links that cannot be resolved stay as plain text.

When it finishes, a **Brought in** report breaks down what happened: notes, materials (with **N already in your library** for anything that matched something already in the library), links kept, folders kept, failures, and skipped files — plus a note of how many materials were extracted from PowerPoint / Excel files, when any were. <Badge type="tip" text="Added in v0.76.0 (2026-09-16)" />

The buttons under the report depend on how much came in. <Badge type="tip" text="Added in v0.125.5 (2026-11-09)" />

- **A single file** — one PDF you just downloaded, say: the first button is **Open**, which shows it straight away (beside the note you have open, or in the materials gallery). **Add to knowledge** and **Ask AI** follow.
- **Several files**: the first button is **Add all to knowledge**, which sends everything you just brought in through the same pipeline as selecting notes or materials one by one and building knowledge from them. **Search your notes**, **See connections**, and **Ask AI** sit beside it.
- **No model configured yet**: **Set up AI** takes the place of the AI buttons.

Bringing in a file that was already in your library shows the same buttons as the first time. Knowledge building covers it too, and anything already turned into knowledge and unchanged since is skipped with a notice.

![The Brought in report after one PDF, with Open as the first button](/screenshots/intake-report-single.png)

![The Brought in report after several files, with Add all to knowledge as the first button](/screenshots/intake-report.png)

Any images among the materials are not read on the spot — the report says the text will be read afterward, and reading happens in the background, one image at a time, right after intake finishes. Once it is done the text counts toward search and `⌘K`, same as [reading text from images](#reading-text-from-images-ocr) started any other way. <Badge type="tip" text="Added in v0.65.0 (2026-09-08)" />

In the desktop app, choosing a folder lists the folder itself instead of handing that job to the browser. While it lines files up it shows how many files and folders it has found so far, and you can press **Stop** to give up partway through. That's faster than the browser path, but a very large folder — tens of thousands of files on a network drive, say — can still take a few minutes to line up. <Badge type="tip" text="Added in v0.76.7 (2026-09-16)" />

In the browser, choosing a folder shows **Looking through the folder…** until every file inside has been listed, and on a network drive that alone can take a few minutes; the progress bar appears only after it. Dragging a folder in is listed by the browser either way and shows nothing at all while it works, so for a folder on a network drive, choose it rather than dragging it. A large folder takes a while to bring in either way. In the desktop app on macOS you can move on to other work in the meantime: intake, and the image reading that follows it, keep going while the Graphium window is behind other apps or on another desktop. Minimizing the window slows them down, so leave it open instead.

Notes follow the same idea as materials (see below): a Markdown file whose contents match one you already brought in is not re-imported, and the report shows **N already in your notes** next to the notes count. The check reads the contents, not the name, so a renamed copy still counts as the same file. If the contents changed, it comes in as a new note. A note you have since edited in Graphium is never touched: re-importing the unchanged original is simply recognized as already brought in, and a changed original arrives as a new note beside your edited one. <Badge type="tip" text="Added in v0.65.0 (2026-09-08)" />

## Bring in AI conversations <Badge type="tip" text="Added in v0.147.0 (2026-11-18)" /> {#bring-in-ai-conversations}

This keeps what you decided, and why, in a conversation with an AI next to the rest of your records. In the desktop app, Graphium reads the records of your Claude Code conversations on this PC and keeps each conversation as one material.

1. Open **Bring in** in the sidebar and choose the **AI conversations** tab.
2. Graphium looks through `~/.claude/projects` and lists your working folders, each with the number of conversations, how many characters you wrote, and the period.
3. Tick the folders you want and press **Bring in**. No AI is called.

![The AI conversations tab with two working folders ticked and Bring in at the bottom right](/screenshots/intake-conversations.png)

| What goes in | What does not |
|---|---|
| Your own messages, in full and word for word | Tool calls and their output |
| An excerpt of the AI's reply just before each of your messages (long ones: the first 200 and last 300 characters — see [the measurement](/evaluations/ai-conversation-claims)) | The rest of the AI's replies |
| A long text (over 700 characters) placed at the start of a conversation, kept as a **Brief** | |

- Anything you typed, such as an email address or a name, is kept as it is, as part of your message. Know this before you bring a conversation in.
- A conversation with no message from you at all (one that only handed over work, say) is not brought in. The list says **Not brought in: N with no message from you**.
- A long first text is kept as a **Brief** because the record cannot tell whether another conversation wrote it or you typed it.

**Bringing in again.** The same conversation never lands twice. If it has grown, its contents are replaced. The final screen counts **Conversations brought in**, **Conversations updated**, **Unchanged since last time** and **Failed**.

![The report after bringing in: 21 brought in, 3 updated, 8 unchanged, 0 failed](/screenshots/intake-conversations-report.png)

**Where to read them.** Brought-in conversations are listed under **Materials → AI conversations** in the left nav, in the folder `AI chats/<name of the working folder>`. The name is the title Claude Code gave the conversation, or your first line when it has none. The date is when the conversation happened, not when you brought it in. Bringing a conversation in again updates its name, unless you renamed it yourself. Open one to read it by day: your messages, and the AI's replies in lighter text. As materials, they can be renamed, put in or taken out of folders, archived or deleted. Deleting one also deletes the text that was saved.

![A brought-in conversation opened: a Brief, the AI's reply in lighter text, and two lines of your own](/screenshots/conversation-material.png)

**Notes made in a conversation.** If the AI saved notes to Graphium during the conversation, they are listed above the text under **Notes made in this conversation**; select a title to open the note. Graphium finds them in the record when you bring the conversation in. A conversation that already has such notes is left out of the candidates for **Add all to knowledge**, because its decisions are already summed up in the notes (you can still turn it into knowledge one at a time from the list).

**Finding one by what was said.** `⌘K` (`Ctrl+K` on Windows/Linux), the search box of the **AI conversations** list and the `search_media` tool of the [MCP server](/mcp-server) look through the text of your conversations as well as their names. This covers the newest conversations up to 10 million characters of saved text; older ones are found by name. The AI chat inside Graphium does not read conversations on its own.

**Asking another AI.** An AI connected through the [MCP server](/mcp-server) can look through your conversations and point back to the one it used. [The measurement](/evaluations/ai-conversation-recall) shows how far this went on ten conversations.

**In the browser.** The **AI conversations** tab only says that bringing in AI conversations is available in the desktop app. The records are files on this PC, and a browser cannot read them.

**Making knowledge from a conversation.** A conversation can become insights and topics like any other material, and the claims it yields can be traced back to it: the source of a page opens the original conversation, and source check reads the saved text.

- On the final screen of the bring-in sheet, a line offers the conversations to turn into knowledge, with the button **Add all to knowledge**. The candidates are the conversations in which you wrote at least 300 characters. A conversation that is new or has grown is a candidate; one that has not changed is a candidate only if it has no knowledge yet. The line shows the estimate, about 70,000 to 90,000 tokens of AI use per conversation. Nothing is sent to the AI until you press the button.
- From the **AI conversations** list under Materials, the menu of a single conversation, or a multiple selection, turns it into knowledge. Here there is no minimum of 300 characters.
- Of one conversation, the first 80,000 characters are read for insights.
- The AI is asked to read your own lines first, and to write a point supported only by the AI's reply as the AI's reading, apart from your own points. In the measurement this raised the share of insights grounded only in your own words from 69% to 85%; it does not catch every case ([the measurement](/evaluations/ai-conversation-claims)).
- Knowledge made from a conversation is not sent to Asterism, because a conversation holds your own decisions and names as you said them.

**Not possible yet.**

- Sharing a conversation material, or downloading it as a file
- Conversations from AI tools other than Claude Code

## Bringing the same file in twice <Badge type="tip" text="Added in v0.37.0 (2026-08-14)" /> {#bringing-the-same-file-in-twice}

A file that is already in your library is reused rather than registered a second time. The check reads the contents, not the name: a renamed copy counts as the same material, and two different photos that both arrived as `IMG_0001.jpg` stay apart. A material is one artefact used from many notes, so a second copy would only split its extracted text, its memos and its list of notes in two. This holds for every route in the table above, images and video and audio and PDF and Word and data files alike.

Two cases are left as they were. An archived material is never reused: if you retired it from the gallery, a fresh upload registers a new material instead of quietly bringing the old one back. Files above roughly 128 MB are registered without the check, because reading one end to end to compare it costs more than the duplicate does.

Materials registered before v0.37.0 are read once in the background after you sign in, to give them the mark the check relies on. Until that pass reaches a given material, bringing it in again still adds a copy. A large library takes a while, and closing the app is safe — the next launch picks up where it left off.

## Link a file without copying it <Badge type="tip" text="Added in v0.146.0 (2026-11-18)" /> {#linked-files}

Some files already have a home: an organization's synced folder, a lab NAS, a shared drive. Bringing them into Graphium would mean two copies, and the copy in Graphium would slowly drift from the original. A **linked file** avoids that. Graphium keeps only a record of where the file is — which linked folder, the path inside it, its size and its modified time — and the file itself stays where it is. Nothing is copied. Graphium reads the contents only when you ask it to (see [Show the contents or import it as a table](#linked-read)). This is for the desktop app only.

### Set it up and link a file

1. Open Settings → **Storage** and, under **Linked folders**, press **Register a folder**. Pick the folder (for example the synced folder). See [Linked folders](/settings#data-places).
2. Open a gallery (images, documents, data, videos, audio or URLs) and press **Link a file from a registered folder**.
3. Pick one file, or several at once (up to 500). They have to be inside a registered linked folder; a file that is not is left out and a message says so — register that folder first, or use the regular import.
4. The linked file is listed by its kind: a PDF or an Office file under documents, a CSV under data, a picture under images. A kind Graphium does not recognise is listed under URLs.

The file appears in the gallery with a **Link** mark. Linking the same file again does not add a second material; it finds the one you already have.

### What you see

Open a linked file and you see its **Linked folder**, **Location in the folder**, **Size**, **Modified**, **Recorded** and **Status**. Graphium compares the size and modified time with the record to decide the status. In the gallery, a mark appears only when the status is not **No change**.

![The linked file "Dough hydration.xlsx" with a Link mark. It lists the linked folder Whole bakery, the location Recipes/Dough hydration.xlsx, size, modified and recorded times, and the status The original has changed. A Recorded and current table compares 47.1 KB with 50.7 KB, above the Record the current state, Open the original, Show in folder and Check again buttons.](/screenshots/linked-file-details.png)

| Status | What it means | What to do |
|---|---|---|
| **No change** | The size and modified time match what was recorded. | Nothing. |
| **The original has changed** | The size or modified time differs. The file may have been edited. | Compare the two columns (**Recorded** and **Current**). If the new version is the one you want to keep citing, press **Record the current state**; the earlier record stays in the history (the latest 20 are kept). |
| **The original can't be found** | The folder is reachable but the file is not there. It may have been moved or renamed. | Look for the file in the folder. If it moved, link it again from its new location. |
| **Can't reach the folder** | The folder can't be reached right now. | Check that the drive or sync is connected, then press **Check again**. |
| **Not registered on this device** | This device does not have that folder registered. | Register the folder in Settings. The folder is matched by the marker file Graphium leaves in it (below), so registering the same folder again reconnects the links. |

With the status **No change** or **The original has changed**, **Open the original** opens the file in your computer's own app, and **Show in folder** shows it in Finder or Explorer. **Open the original** works only for a fixed set of kinds — documents, spreadsheets, slides, text and CSV, images, audio, video and PDF. For other kinds, use **Show in folder**.

Graphium compares only size and modified time. An edit that leaves both unchanged is not noticed.

### Show the contents or import it as a table <Badge type="tip" text="Added in v0.153.0 (2026-11-20)" /> {#linked-read}

Graphium reads a linked file only while you ask for it. Nothing is copied or kept, and the contents are not used for search, AI or sharing.

- **Show contents** (PDF and pictures: PNG, JPEG, GIF, WebP, BMP, HEIC, AVIF; up to 100 MB). Press it to read the file and show it in place. **Hide contents** closes it; press **Cancel** while it is reading to stop. SVG is not shown.
- **Import as table** (CSV, TSV, TXT, DAT; up to 200 MB). It opens the usual import dialog with the file read from the linked folder. There are two ways in. In a note, type `/data` and choose the linked file (leave the insert style on **Embed**; choosing **Link** only puts in a reference). Or click the reference to a linked file inside a note to open it, then press **Import as table**. Pressing it from the material gallery, with no note open, only tells you to choose the file from `/data` in a note. The original is not added to the library. The table is made as an ordinary table in the note (the choice of a data table block is not offered).

Graphium shows "File read: (folder label) / (location)" at the top of the import dialog, so you can check which file is being imported before you confirm. Only one read runs at a time; the buttons can't be pressed again until it finishes.

If you narrow the table with conditions, the small filtered CSV that is made is kept in the library as an ordinary material, so search, AI and sharing can reach it. The linked original itself is still never copied.

Both buttons are available while the status is **No change** or **The original has changed**. If the file is too large, of another kind, or can't be reached, a message says why.

The table remembers the size and modified time of the file when you imported it. If the original is edited later, the table's source badge shows **The original data has changed**. Pressing the badge reads the file again so you can re-import it. If the table was not imported on this device (for example, it came in a shared note), Graphium first tells you which file it will read and asks whether to continue.

### Name a linked file as the source data <Badge type="tip" text="Added in v0.148.0 (2026-11-19)" /> {#source-data}

Say you link a 40 GB `raw.csv`, analyse it on your own computer, and bring the small `summary.csv` into Graphium. You can record that `summary.csv` came from `raw.csv`.

1. Open `summary.csv` in full view and go to the **Metadata** tab. A **Source data** row appears there once you have a linked file that is not archived.
2. Press **Set source data**, type part of a name to narrow the list, and pick the linked file. Pick several if there are several.
3. The row lists each one with its linked folder and its location in the folder. Press a name to go to that material; press the **×** beside it to remove it.

It can be set on images, PDFs, documents, data, videos and audio that you brought in (not on memos, AI conversations, URL bookmarks or linked files themselves). Only a linked file can be the source data. A material that was extracted from a PDF keeps that PDF as its origin; the **×** removes only linked files.

### Good to know

- Where a linked folder is on a computer is kept on that computer only. The notes and the library hold the folder's id and the path inside it, never the full path on your disk. When Graphium can, it also leaves a small file named `.graphium-place.json` in the folder, so a colleague who registers the same folder on their own computer gets the same folder. If it can't write there, the folder works on this device only.
- The provenance export of a note lists a linked file with its place id, its path in the place, its size and its modified time. The full path on your disk is not included. A material with source data is written as derived from that linked file (`prov:wasDerivedFrom`), so the chain from the small table back to the raw file can be followed in the export. The readable copy in a shared folder leaves source data out.
- This has not been checked on Windows, nor with synced folders whose files are not downloaded to the computer yet. Treat both as untested.

### What it can't do

- Search inside a linked file, or draw a chart straight from it. The contents are not searched or read by AI, and a chart can't read the linked file directly (import it as a table first, then chart that table).
- Read it with AI: no importing it as knowledge, extracting steps, or translating.
- Share the linked file itself. Sharing and the shared folder skip it.
- Link a whole folder at once. Pick the files inside it instead (up to 500 at a time).
- Turn a link into a copy in Graphium. If you want a copy, bring the file in the usual way.
- Check the source data. Graphium does not read the linked file to confirm that the small material really came from it. The relationship is a record that you set by hand.

## Reading materials: side peek and reader view <Badge type="tip" text="Added in v0.9.2 (2026-05-26)" />

Clicking a material opens it in a side peek next to your note, so you can read without leaving what you are writing. Use **Open in full view** for a full-screen reading layout.

<Badge type="tip" text="Added in v0.84.0 (2026-09-30)" /> An image in a note opens the same way: **double-click the image** to open it in the full view; closing the full view takes you back to the note. Or select it and press **Open in side peek** in the toolbar to see it in the panel beside the note, with the material's details, the notes that use it, and the full view one click away. The button and the double-click only work for images that are in your materials — an image linked from another site has no material to open.

- **PDFs** render with a selectable text layer, zoom controls, and page navigation.
- **URLs** open in Reader Mode — a cleaned-up article view fetched from the page. Reader images can be saved into your library with **Save image**. If the URL is not in your library yet, the header shows **Add to materials**, so you can check a page before deciding to keep it. <Badge type="tip" text="Added in v0.29.0 (2026-08-05)" />
- **Word files** (.docx) get an inline preview.
- **Excel files** (.xlsx) open as a table, one tab per sheet, with columns named A, B, C as in Excel. Click a column header to sort the view (the file is not changed). A very large sheet shows its first 1,000 rows and 200 columns and says how much is left out. <Badge type="tip" text="Added in v0.107.0 (2026-10-30)" />
- **PowerPoint files** (.pptx) show the text of each slide, followed by the images in the file. When the file carries the picture of the first slide that PowerPoint saves with it, that picture appears at the top and also becomes the file's thumbnail in **Documents**. Graphium does not draw slides itself, so to see every slide as it looks, open the file in PowerPoint (below). <Badge type="tip" text="Added in v0.107.0 (2026-10-30)" />

![An Excel material in the side peek: one tab per sheet, columns named A, B, C](/screenshots/office-preview.png)

Select text in a PDF, Word preview, or URL reader and a small pill appears: **Save as memo**. The selection becomes a quote memo with its source attached — collect quotes while reading, then insert them into notes later via the `/` menu's **Memo** item ("Insert from saved memos"). When inserting, Graphium asks whether to **Insert and keep memo** or **Insert and delete memo**. Quote memos with a source are inserted as quote blocks with a "— source" attribution line.

![Selecting text in the PDF reader to save a quote memo](/screenshots/pdf-reader-quote.png)

#### Quoting into the note you are writing <Badge type="tip" text="Added in v0.121.0 (2026-11-06)" /> {#quote-in-note}

When a material is open in the side peek next to a note (for example after clicking an `@` mention of a PDF), the pill also offers **Quote in note**. It saves the selection as a quote memo and puts that memo into the note at the cursor, as the same quote block that **Insert from saved memos** makes. If the cursor sits on an empty line, the quote takes that line. The memo stays in your memos with its source and page, so you can quote it again elsewhere. **Quote in note** does not appear for archived or trashed notes, or for a URL that is not in your materials yet (add it first).

![A PDF in the side peek next to a note: the pill offers Quote in note and Save as memo](/screenshots/pdf-peek-quote-in-note.png)

#### Going back to the quoted sentence <Badge type="tip" text="Added in v0.121.0 (2026-11-06)" /> {#open-source}

A quote memo remembers the sentence you selected, apart from its text, so you can rewrite or comment on the memo and still know where it came from. In a PDF it also keeps a few words before and after, which tells the same sentence apart when it appears more than once.

To go back, click the memo mark at the right of a quote block in your note and choose **Open source**. The material opens in the side peek next to the note. For a PDF, it scrolls to the quoted sentence and marks it. If the sentence cannot be found (for example, the PDF was replaced by another version), it opens at the page the quote came from. Other materials open at the top. Quote memos made before this version have no stored sentence, so they open at their page too.

![Open source from a quote: the PDF opens next to the note with the quoted sentence marked](/screenshots/pdf-quote-open-source.png)

### Opening a document in Word, Excel or PowerPoint <Badge type="tip" text="Added in v0.107.0 (2026-10-30)" /> {#open-in-app}

In the [desktop app](/desktop-app), a Word, Excel or PowerPoint material opens in the app your computer uses for that kind of file, with the material's name in the title bar. There are three ways in: **double-click** the file in **Documents** (the row or the card), press the **Open in app** button next to the ⋯ menu at the top of the material, or choose **Open in app** from the ⋯ menu. In the browser version, use **Download original** instead.

### Bringing edits back from Word, Excel or PowerPoint <Badge type="tip" text="Added in v0.108.0 (2026-10-30)" /> {#bringing-edits-back}

What the app opens is a copy, not the material itself, so you can edit and save it freely. When you come back to Graphium after saving, a notice in the bottom-right corner says the file was edited in another app and asks what to do. Nothing is brought in until you choose.

| The material is… | The button | What happens |
|---|---|---|
| not cited anywhere yet | **Bring edits in** | The material is replaced by the edited file. Its preview and page count follow |
| cited by a note, knowledge, an earlier version of a note, a template, or shared with your team | **Add as new version** | The material stays exactly as it was, and the edited file is added as a new material that records it is a revision of the earlier one. The two are linked in the material's asset graph |

![Two notices in the bottom-right corner: proofing-schedule.xlsx with Discard edits and Bring edits in, and sourdough-method.docx with Discard edits and Add as new version, each with a close button.](/screenshots/material-opened-copy-notice.png)

Either way, **Discard edits** throws the edited copy away; the next time you open the file it starts again from the material. **×** hides the notice until the app is started again.

Keeping the cited material untouched is what keeps citations honest: a note that quoted a sentence keeps pointing at a file that still contains it. After a new version is added, further saves in Word update that new version, so editing several times in a row does not pile up versions.

### Finding text in a PDF <Badge type="tip" text="Added in v0.68.0 (2026-09-08)" /> {#finding-text-in-a-pdf}

`⌘F` (`Ctrl+F` on Windows/Linux) searches inside the PDF while your pointer is over the viewer — or click the magnifier in the viewer's toolbar. Every match in the document is highlighted, with the current one in orange and a counter beside the box ("2/37"); `Enter` jumps to the next match, `Shift+Enter` to the previous, **Match case** toggles case sensitivity, and `Esc` closes the bar. Matches that run across a line break are found as written, so searching for `thin film` still finds it where the line broke after `thin`. When your pointer is somewhere else, `⌘F` goes to whatever else is on screen — [Find in note](/notes-and-editor#finding-text-in-a-note) while you are writing, or the search box of the material list you came from. The two find bars never open at the same time.

![Find in PDF: the search bar over a material PDF, with every match highlighted and the current one in orange](/screenshots/pdf-find.png)

The highlight follows the PDF's text layer, which pdf.js lays out with a substitute font and stretches to the width of each run. Where the substitute's letter shapes differ from the PDF's own font, a highlight can sit a fraction of a character off; the count, the jumps and the text you select are exact.

## Per-material memos, chat, and graph

Every material carries its own workspace. In full view, the right panel has four tabs:

| Tab | What it shows |
|---|---|
| **Memos** | Memos attached to this material — quotes you saved plus anything you write in the box |
| **Asset graph** | A graph of the notes that use this material; click a node to open the note |
| **Metadata** | File details, and per-type actions like **Extract embedded images** |
| **Ask AI** | A chat scoped to this material — ask questions about the document (needs AI) |

Everything except **Ask AI** works without any AI setup.

![A PDF material, bread-science.pdf, open in full view: the whole PDF page is readable on the left, and the Asset graph panel on the right shows the PDF node linked to two notes, with the icon rail at the far right.](/screenshots/material-full-view.png)

### Memo markers on materials in a note <Badge type="tip" text="Added in v0.109.0 (2026-10-30)" /> {#memo-markers-on-materials}

You do not have to open a material to see its memos. When a note contains an image, video, or PDF that is one of your materials, a small sticky-note marker appears in the top-right corner of the picture:

- **With memos** — the marker always shows, with the number of memos (the same memos as the **Memos** tab above — including older memos that quote the material's name in a "— name" source line).
- **Without memos** — a faint "+" marker appears only while your pointer is over the block (or the block is selected). On touch screens, where there is no hovering, it stays hidden until the material has a memo.

Click the marker to open a small window with the material's name, a box to write a new memo, and the memos so far (newest first). Press `Enter` to save and keep writing; `Esc` or a click outside closes the window. Click a memo to open it in the side peek, or use the full-screen icon next to the name to open the material itself — deleting a memo is done there, in the **Memos** tab.

![A bread photo in a note with a sticky-note marker showing 2 in its top-right corner, and the small window open under it: the material name crumb-shot.png, a box to write a memo, and the two memos so far.](/screenshots/memo-marker-popover.png)

A memo written here is about the material and about this block of this note, so it shows in the material's **Memos** tab and in the note's **Memos** panel with a **Linked block** chip (see [Block-anchored memos](#block-anchored-memos)). The same holds for a memo on an image, video, or PDF block from the block's **Add memo** or `⌘⇧M`: whichever way you write it, it is tied to both. Notes that are archived or in the trash show the markers read-only. Materials that cannot be matched to your library — images pasted from an external link, for example — show no marker.

### More ways to reach a material's memos <Badge type="tip" text="Added in v0.109.0 (2026-10-30)" /> {#memos-from-the-library}

The same small window opens from three more places, so you can write a memo the moment you see the material:

- **From the toolbar in a note** — select an image, video, or PDF block and click the sticky-note button in its toolbar (**Memo on this material**).
- **From the material gallery** — every card (grid) and row (list) carries the same marker: the memo count when there are memos, a faint "+" while your pointer is over it when there are none, and nothing on a touch screen until the first memo exists. Clicking it does not open or select the material.
- **From the side peek** — the sticky-note button in the peek's header shows the count. Where you can write memos, it stays visible even with no memos yet (in an archived or trashed note's peek it appears only once there is a memo to read).

If a memo cannot be saved, the text you wrote stays in the box and a message at the bottom right says so — press `Enter` to try again.

## Turning materials into notes and knowledge (AI)

The menu on a PDF, Word, or URL material offers three AI-powered conversions. All of them need a configured model — see [AI setup](/ai-setup).

- **Extract steps into a note** — reads the source and builds a structured note with steps, labels, and highlights already in place, ready for the [provenance graph](/labels-and-provenance).
- **Translate into a note** <Badge type="tip" text="Added in v0.14.0 (2026-06-05)" /> — translates the full PDF or web page into your display language, page by page, keeping the original structure. A glossary is extracted first so terminology stays consistent, and embedded figures are placed back near their captions in the translated note.
- **Add to Knowledge** — distills the source into your [Knowledge layer](/knowledge-layer).

<Badge type="tip" text="Added in v0.129.6 (2026-11-10)" /> Notes made by extracting steps or translating go into a **Procedures** or **Translations** folder. If the source material is in a folder (including through a note in that folder that uses it), the note goes there too. So converting a material you never filed doesn't leave the note in **Unfiled**. Afterwards you can add or remove folders like on any other note. A plan made from a chat answer and its operation notes also go into **Procedures**, and a new [voice note](/voice-notes) goes into **Voice notes**. <Badge type="tip" text="Added in v0.129.15 (2026-11-12)" />

Bulk versions of these appear when you multi-select materials in the gallery. Memos have an equivalent: select memos in the Memos gallery and turn them into Knowledge in one step.

### Aligning extracted names with your library <Badge type="tip" text="Added in v0.122.0 (2026-11-06)" /> {#aligning-extracted-names}

Before it saves, **Extract steps into a note** aligns the names of steps, materials, tools, outputs and parameters with the names already used in your notes. However many papers you bring in, the same operation or the same substance becomes the same node in the provenance graph, so you can follow it ("notes that used this furnace").

It aligns in two passes.

1. **Fold spelling differences.** Names that differ only in case, hyphens and spaces, full-width and half-width characters, an English plural or subscript digits take the spelling already in use (`Calcination` and `calcination`, `ball-milling` and `Ball milling`, `BaFe₁₂O₁₉` and `BaFe12O19`).
2. **Let the AI recognize the same thing.** Only the names still new after the first pass are sent to the AI together with the names already in use, and the AI picks an existing name when both mean the same operation, substance or instrument (`calcining` and `Calcination`, `barium carbonate` and `BaCO3`). It can only pick a listed name; it never coins a new one. A different composition or phase, or a different operation such as calcination versus sintering, stays apart. When unsure, it leaves the name as it is.

When you select several materials and extract them together, alignment still runs one paper at a time, so a later paper uses the names an earlier one ended up with. If the AI call in the second pass fails, extraction does not stop; the note is saved with the first pass only. A Japanese heading is never mapped to an English name (headings stay in the note's language).

How much this aligns is in the [evaluation record](/evaluations/papers-to-procedures).

## Reading text from images (OCR) <Badge type="tip" text="Added in v0.21.0 (2026-07-26)" />

Graphium can read the text inside any image — instrument screenshots, plots, photos of labels — entirely on your device. No LLM is involved and no AI setup is needed; the image never leaves your machine.

<Badge type="tip" text="Changed in v0.142.0 (2026-11-18)" /> The desktop app reads images with PP-OCRv6 small, an on-device model (about 31 MB). It is downloaded automatically in the background the first time an image is read, from the model's official Hugging Face repository, with no prompt. Until the download finishes, if the download or a read fails, and in the browser version, Graphium reads with the same Tesseract engine as before. Photos of paper or screens, tables and vertical text are read more accurately than before, and vertical text is read from the right-hand column first. Handwriting is still hard: dates and numbers are sometimes picked up, but sentences often are not. Images that were already read are not read again; run **Read text from image** once more to re-read one with the newer engine.

<Badge type="tip" text="Added in v0.145.0 (2026-11-18)" /> To turn it off, or to download or delete the model yourself, open Settings → AI → **Model for reading text in images** (desktop app only). Turn off **Read with an on-device model** and Graphium reads with Tesseract only and never downloads the model; the switch is on by default. The row shows whether the model is downloaded (about 31 MB) and has **Download**, **Cancel** and **Delete** buttons. If you delete the model while the switch is on, it is downloaded again the next time an image is read.

<Badge type="tip" text="Added in v0.145.0 (2026-11-18)" /> On macOS, the desktop app also keeps a second reading from the operating system's own text recognition, only for search; what is shown, copied and exported does not change.

The measurements are in [OCR engines compared](/evaluations/ocr-engines).

Three ways in:

1. Click an image block — the toolbar shows **Read text from image**.
2. The same item lives in the block's drag-handle (⠿) menu.
3. Images newly added while a note is open are read automatically, with a progress toast so nothing runs silently.

To re-read images that were read the old way in one go, open **Images** under **Materials** in the sidebar, select the images (checkboxes, as in the [material gallery](#the-material-gallery)) and choose **Read text** in the selection bar (under **More** if it is not on the bar); images that were already read are included. This updates the reading kept with the material, which is what the material list and `⌘K` search; the reading you see when you open a note stays as it was until you run **Read text from image** again in that note.

Once extracted, the text works for you in several places: note search matches it (results show an **image text** badge), the [Composer finds the image itself](/ai-chat-and-ask#finding-images) by the words inside it <Badge type="tip" text="Added in v0.35.0 (2026-08-13)" />, and you can view and **Copy** the raw text from the image toolbar.

![The drag-handle menu of an image block after reading, with Text extracted (48 chars) among its items](/screenshots/image-ocr.png)

## Citing knowledge in a note <Badge type="tip" text="Added in v0.12.3 (2026-05-29)" />

Under the `/` menu's "Existing knowledge" group, **Claims** and **Insights** open a picker over your [Knowledge layer](/knowledge-layer) entries. Search by title, select several at once, and press **Insert** (`⌘Enter`, `Ctrl+Enter` on Windows/Linux). Each citation is inserted as an @-link and recorded as a reference, so the note's **Graph** tab shows an edge from your note to the cited knowledge.

Citing itself calls no AI — it just links existing entries. AI features like the [Composer](/ai-chat-and-ask) then use those citations as context.

![The "Cite claims" dialog (54 notes) with a "Search by title…" field and a list of claim titles with dates; three oven-related claims are checked, the footer reads "3 selected" with Cancel and Insert buttons.](/screenshots/claims-picker.png)

## @-mentions of materials

Type `@` in a note and the mention menu lists notes to link — plus a **Document materials** group with your PDFs and Word files. Mentioning a material inserts an @-link and registers the document as cited by the note, which means the Composer and AI chat can read its text (as much of it as the chat's context budget allows) and your highlight memos when answering questions about that note. (Choosing **Link** in the media picker does the same thing.)

The mention is a plain link — no AI runs until you actually ask something.

### Pasting a copied link <Badge type="tip" text="Added in v0.101.5 (2026-10-28)" /> {#pasting-a-copied-link}

You can also start from the thing you want to link. Open the `⋯` menu and choose **Copy link** — on a note or a [Knowledge](/knowledge-layer) page (in the full view or the side peek), or on a material (PDF, Word, data file, or image; in the side peek or the full view). Paste that link on its own into a note, and it becomes the same @-link you would get from the `@` menu: a note shows its title, a Knowledge page shows its kind and title (`🤖 Concept: …`), a document material shows its name and is registered as cited, and an image appears inline.

![Copy link in the ⋯ menu of a material's side peek](/screenshots/material-copy-link.png)

Opened outside a note, the same link takes you to the page itself — a material's link opens it in the full view. Videos, audio, and URL bookmarks have no **Copy link**, because they cannot be @-linked in a note.

## Block-anchored memos <Badge type="tip" text="Added in v0.19.2 (2026-07-23)" />

Sometimes a thought belongs to one specific block — a doubt about a measurement, a reminder to re-run a step. Open the block's drag-handle (⠿) menu and choose **Add memo** to attach a memo to that exact block.

Anchored memos appear in the note's **Memos** panel with a **Linked block** chip showing the block's current text — the chip follows the block as you edit it. On an image, video, or PDF block that is one of your materials, the memo is also a memo about that material, so it shows on the block's marker and in the material's **Memos** tab too. Click the chip to scroll to and highlight the block. If the block is later deleted, the chip keeps the last text it saw, so the memo still tells you what it was about.

## Everything points back to its source

Lineage is the quiet thread through all of this — nothing you derive loses track of where it came from:

- A note created by **Extract steps into a note** or **Translate into a note** gets a **Source** tab in its right panel, holding the original document.
- Knowledge entries list their origins in a **Derived from** section — source notes, PDFs, URLs, Word files, chats, and memos alike. Clicking a source opens the material in a side peek.
- Quote memos carry their source attribution into any note they are inserted into.
- Material nodes in the note graph and network graph open the material directly.

::: tip
This is the same PROV-DM provenance model that powers step labels — see [Labels & provenance](/labels-and-provenance) for the full picture.
:::
