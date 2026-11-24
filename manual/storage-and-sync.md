# Storage & sync

Graphium keeps your notes in storage that you own — a browser database or plain files on your disk. There is no Graphium cloud and no account. This page explains where your data lives on each platform, how to move it, how archive and trash protect your links, how team sharing works, and how to back everything up.

## Where your data lives

| Platform | Where notes are stored | Reach |
|---|---|---|
| Browser version | That browser's local database (IndexedDB) | Only that browser on that device |
| Desktop app | Plain files in a `Graphium` folder inside your Documents folder (`~/Documents/Graphium/` on macOS) | Only that machine — or any machine, if you point it at a synced folder |

### Browser version

Notes live in the browser's own IndexedDB storage. Nothing leaves your machine, but the storage belongs to that one browser profile.

::: warning Clearing site data erases your notes
If you clear this site's data in your browser (or use a private window), the notes stored there are gone. If you work in the browser version, download a backup regularly — see [Backing up](#backing-up) below.
:::

### Desktop app

The desktop app writes ordinary files you can see in your file manager. Inside the Graphium folder you'll find subfolders for `notes` (one JSON file per note), `media`, `wiki` (Knowledge pages), `skills`, and `appdata`. Because they are plain files, any backup or sync tool can handle them.

## Changing the storage folder <Badge type="tip" text="Added in v0.3.10 (2026-04-25)" />

On the desktop app you can move the whole data folder: open **Settings** → **Storage** → **Graphium save folder** and press **Change…**. The current and default paths are shown, and **Reset to default** takes you back to the Documents folder.

![Storage tab of the settings dialog. At the top is the Graphium save folder (the folder and a Change button), followed by Linked folders (none registered yet), export and backup, then the Send from your phone or browser and Advanced groups](/screenshots/settings-storage.png)

Two things to know before you switch:

- Existing notes are not moved automatically. Copy the contents of the old folder into the new one before you continue working.
- Restart Graphium after changing the location so it takes effect everywhere.

::: tip Sync without a cloud account
The settings hint says it best: point the save location at a Dropbox-, Google Drive-, or OneDrive-synced folder and your notes follow you across machines — no OAuth, no extra service. For this kind of sync, Graphium itself never talks to the cloud; the sync client does.
:::

## Your author identity

Notes record who wrote them. Open **Settings** → **Sharing**, then open **Your name** and fill in **Display name** and **Email**, then press **Save your name**. This identity is stamped on shared notes and on PROV provenance entries (the record of who edited what — see [Labels & provenance](/labels-and-provenance)). It is self-asserted: there is no login or verification behind it.

An identity is required before you can share notes with a team (below).

## The note list index

The note list is built from a lightweight index over your note files. Graphium keeps it up to date as you work, and if it is ever missing or outdated it is rebuilt automatically the next time the app loads. Your note files themselves are always the source of truth — a stale or broken list fixes itself on relaunch, and archive/trash flags survive the rebuild.

## Archive and trash

Deleting a note outright would break every link and citation pointing at it. Graphium therefore uses soft deletion in two flavors:

| Action | What happens | Links keep working? |
|---|---|---|
| **Archive** | The note is hidden from the list but stays fully readable | Yes — references and citations still resolve |
| **Move to trash** | The note is retired; it opens read-only with a restore banner | No — links to it are flagged as broken |

Both live in the note's `⋯` menu: **Archive** and **Move to trash**. If other notes link to the one you're trashing, Graphium warns you how many links will break before it proceeds.

To bring something back, open the trash-can icon (**Trash & Archive**) in the icon row at the bottom of the sidebar. The view has a **Trash** tab (with **Restore** and **Delete permanently**) and an **Archive** tab (with **Restore from archive** and **Send to trash**). A trashed or archived note opened directly also offers **Restore from trash** / **Restore from archive** in its `⋯` menu.

![The Trash tab of Trash & Archive listing three notes (Starter feeding draft, Proofing box scratch notes, Bagel dough trial) with Deleted and References columns; the second row is checked and both Restore and Delete permanently are enabled.](/screenshots/trash-archive.png)

**Delete permanently** is the only destructive step: on the desktop app the file is moved to your operating system's trash; in the browser version it is deleted immediately and cannot be undone.

Media has the same protection: deleting a file from the [material library](/materials-and-citations) that notes, saved versions or [your own templates](/notes-and-editor#templates) still reference offers **Archive (recommended)** instead, which hides it while keeping those references working.

## Sharing notes with your team <Badge type="tip" text="Added in v0.6.0 (2026-05-05)" />

Sharing publishes a copy of a note into a folder your whole team can reach — a lab NAS, a Dropbox-synced folder, any shared drive. It is desktop-only for now; the browser version cannot read or write local folders.

### Set up the shared folders

Open **Settings** → **Sharing**, then go to **Shared folder**:

1. Press **Choose folder** (or **Add a shared folder**) and pick the team-visible folder where published notes go. A name field appears in its row, filled in with the folder's name — keep it or type what the folder is for, then press Enter.
2. There is nothing more to set up. Images, PDFs, and other media in what you share go into a `_blobs` folder that Graphium creates inside the shared folder the first time it needs one, so the same people can read them. To keep them somewhere else, click the row to open its details and use **Choose another place** under **Large files folder (images, PDFs, etc.)**; **Use the shared folder** puts it back. Once a place is set, the same button reads **Change**. <Badge type="tip" text="Changed in v0.123.1 (2026-11-06)" />
3. Press **Check connection** to run a full round trip (write → read → verify → delete) against the folder.

Each folder takes one row: a dot for its state (green when Graphium can see the folder, amber when it can't), its name, its location, and how many notes, knowledge pages, templates, and assets it holds. The `⋯` menu at the end of the row has **Rename**, **Make default**, **Check connection**, and **Remove**.

![The Sharing tab of Settings showing Your name (Ken Sato) with Display name, Email and Save your name, then Shared folder with two rows: "Whole bakery" (/Volumes/Bakery/Shared, Default) opened to show its Location with Change and Check connection and its Large files folder with Change, Check connection and Use the shared folder, and "Sourdough team" (/Volumes/Bakery/Sourdough) closed; Add a shared folder sits below, followed by the toggle that includes the shared folder in ⌘K and AI chat.](/screenshots/settings-shared-folders.png)

You must save your identity first — shared entries carry their author's name and email.

Reading the shared folder's contents needs only read access to it: members who never share anything can leave the folder read-only for their account, and Graphium creates subfolders only when something is written. If opening the shared folder fails with "Can't reach the shared folder", check that the drive is mounted on that machine and that the path matches the one you chose. The NAS itself may still show up in Finder or Explorer while the share's mount has silently dropped after sleep or a restart — that is the most common cause. The notice offers a **Reconnect** button: once a share has loaded successfully, Graphium remembers its address (`smb://…`, or the `\\server\share` behind a mapped drive), asks Finder or Explorer to open it again, and reloads as soon as the folder is visible. When a second computer mounts the NAS under a different name (`Kumagai-1`, say), the notice lists paths that seem to hold the same contents and **Use this path** switches to one.

### Several shared folders, one per audience <Badge type="tip" text="Added in v0.122.0 (2026-11-06)" /> {#several-shared-folders}

Organizations rarely have one folder everybody can read. More often there is a folder the whole organization can reach and smaller ones only one team can open. You can add each of them: under **Shared folder**, press **Add a shared folder**, then give each one a name — "Whole bakery", "Sourdough team" — so you can tell them apart.

- **Who can read a folder is decided by the folder itself** — the permissions on the NAS or shared drive. Graphium has no permission settings of its own, and the name is only what you call it on your screen.
- **You choose the folder when you share something for the first time.** With two or more folders, **Share with team** on a note, knowledge page or asset first asks **Which shared folder should this go to?**, and the media and bulk share dialogs show the same choice under **Share to**. **Share as template** lets you tick several folders at once — each gets its own copy of the template — so one template can go to the whole organization and to a team in one step, while a finding stays in one team's folder. A note, knowledge page or asset lives in one shared folder at a time. The choice starts at the default shared folder — the first in the list, marked **Default**; **Make default** moves another one to the top. With a single folder nothing is asked.

  ![The dialog "Which shared folder should this go to?" for the note "Sourdough starter log — day 3": under Share to, "Whole bakery" (/Volumes/Bakery/Shared, Default) is selected and "Sourdough team" (/Volumes/Bakery/Sourdough) is the other choice, with a note that who can read it is decided by the folder's permissions, and Cancel and Share buttons.](/screenshots/share-to-folder-dialog.png)
- **Everything else follows the entry.** Updating a shared copy, unsharing, comments, proposals (they sit next to the original note), citations, forks and new notes from a shared template all use the folder the entry is in, and that folder's large files folder.
- **The shared folder view lists all of them.** With two or more folders, a row of chips above the tabs narrows the view to one folder, and a **Scope** column shows which folder each row comes from. If a folder can't be reached, a notice names it and the view keeps what was last read from it.
- **A warning when citations cross folders.** If a note, knowledge page or template cites shared entries that live in a different shared folder from the one you are sharing to, Graphium names those folders and asks before sharing. People who can read the destination but not those folders would see the citation cards as "not found", with only their titles. Graphium can't tell which folder is "wider" — that is up to the folders' permissions — so it asks whenever the folders differ.
- **A warning when a page carries sources you haven't shared.** <Badge type="tip" text="Added in v0.157.0 (2026-11-24)" /> A topic or answer page is made from several notes, and it keeps the passages it quotes and the titles of those notes. A note's @ links put the linked notes' titles in the readable copy. Before sharing, Graphium counts the sources that aren't in the destination folder: not shared, shared to a different folder, or PDF and web materials. If there are any, it asks. **Share without them** (the default) removes those passages and links, and replaces their titles with **@Unshared source**. The summary text stays. **Share as is** keeps everything. Your own page or note doesn't change either way.
- **Move to another shared folder.** On a note or knowledge page you have shared, the `⋯` menu offers **Move to another shared folder** when two or more folders are registered. Graphium shares it again in the new folder under the same id and then unshares it from the old one, so other people's citations and forks keep working. Comments and proposals stay in the old folder, and the update count starts over in the new one.
- **Removing a folder** only removes it from Graphium; nothing in the folder is deleted.

![Two shared folders as rows in Settings → Sharing: "Whole bakery" (/Volumes/Bakery/Shared), marked Default and holding 3 notes and 2 templates, and "Sourdough team" (/Volumes/Bakery/Sourdough) holding 2 notes, 1 knowledge page and 1 asset. Each row starts with a green dot and ends with a ⋯ menu; Add a shared folder sits below, with a note that who can read a folder is decided by its permissions.](/screenshots/settings-shared-folders-list.png)

If you only ever set up one shared folder, nothing changes: it simply becomes the default.

### Readable copies for people and tools without Graphium <Badge type="tip" text="Added in v0.139.0 (2026-11-17)" /> {#readable-copies}

What Graphium puts in a shared folder is in its own format, so it cannot be read as it is. When you want the notes to be readable by other people, or by an AI that can read that folder, you can have Graphium also place copies in a form anyone can open.

- **Turn it on:** Settings → Sharing → click a shared folder's row to open its details → **Also keep readable copies**. It is off by default.
- **Where they go:** inside the same shared folder, in `readable/notes/`. Each note gets two files, named after its title, for example `Sourdough starter log_3c2f1b8d6e70.md` and `Sourdough starter log_3c2f1b8d6e70.prov.jsonld`. The last 12 characters are part of the note's shared id, so two notes with the same title do not collide.
- **What is in them:** the `.md` file is the same Markdown as the Markdown export, with a short header (title, note id, shared id, author name, shared time). Images are not included as files; only a reference to each one is. The `.prov.jsonld` file is the provenance, in the same form as the menu export. Links to other notes carry the other note's id and title. Sources you cited in the note are listed with their name and origin. AI chats, edit history and memos are never included, even if you share with the history turned on.
- **When they are updated:** when you share or re-share a note. They do not follow your edits on their own. If you change the title and re-share, the files are replaced under the new name. If you stop sharing the note, they are removed.
- **It is a setting for this device:** it applies to the notes you share. Copies of someone else's notes follow that person's setting. Notes you shared before turning it on get their copies the next time you re-share them. If you turn it off and re-share a note, its old copies are removed.
- **Notes only.** Knowledge pages and other entries do not get copies.

![The opened row of the shared folder "Whole bakery" (/Volumes/Bakery/Shared) with its Location and Large files folder, and below them the ticked checkbox Also keep readable copies, which explains that a Markdown file and its provenance are placed in the readable/notes folder when you share or re-share a note.](/screenshots/readable-copies-setting.png)

The shared copy is still the original; these files are extra copies for reading. Graphium does not read them back.

### Publish and unpublish

Open a note's `⋯` menu and choose **Share with team**. A **Shared** badge appears on the note, and teammates see it in the shared folder. When you share a note containing media, the files are copied into the large files folder automatically — you never attach them by hand.

You can see what you've shared without opening each note. <Badge type="tip" text="Added in v0.159.0 (2026-11-24)" /> In the note list and the knowledge list, a share mark appears next to the title of anything you've shared. In the sidebar, a folder that holds shared notes shows how many, with the same mark, to the left of its note count. A parent folder counts its subfolders too. Notes shared as a proposal are not counted.

The shared copy is a snapshot. To update it, edit your local note and choose **Update shared copy** from the same menu. To withdraw it, use **Unshare** in the shared folder; Graphium warns that other members may have already viewed, cached, or forked it, so it cannot be fully erased.

What travels with the note: the text, its labels and procedures, the folder it sits in, and any embedded images or files. What does not: the AI chats you had inside the note, its edit history, saved versions, and memos. Sharing hands over the record, not the working process behind it. Text you quoted into the note from a memo is part of the note, so it travels; the memo itself and the link from the quote back to it do not, and the shared copy shows it as an ordinary quote. A Knowledge page made from a memo is shared the same way: its text travels, but the link back to the memo, the passages it recorded from the memo, and any source check that read the memo do not, and a citation of the memo shows only as **@Memo**. If you want the chats and the edit history to travel too, turn on **Include AI chats and edit history when sharing** in **Settings** → **Sharing**, or tick the same box in the bulk share dialog. Either way it applies from the next share onward — notes you shared before are updated the next time you choose **Update shared copy**. <Badge type="tip" text="Added in v0.61.0 (2026-09-08)" />

### Share knowledge pages too <Badge type="tip" text="Added in v0.44.0 (2026-08-25)" />

Knowledge pages — topics, claims, and insights, plus any older summaries still on disk — share the same way. Open a page's `⋯` menu, choose **Share with team**, and it appears under **Knowledge** in the shared folder, next to the shared notes. **Update shared copy** and **Unshare** work as they do for notes.

Forking one brings it into your knowledge rather than your notes, so it sits with your own claims and insights and joins your searches and graphs. Its lineage does not come along: a shared page's "derived from" links point at notes, chats, and claims in the author's library, and those ids mean nothing in yours. The fork starts with that lineage cleared and records where it came from instead, so nothing is left dangling or pointing at the wrong page. The text, the semantic type, and any sections edited by hand arrive intact. World-check results and search embeddings are rebuilt on your side rather than carried over.

### Share several at once <Badge type="tip" text="Added in v0.44.0 (2026-08-25)" />

Select notes with the checkboxes in the notes list, or knowledge pages in a Knowledge list, and a **Share** button with the count on it joins the other bulk actions. Sharing runs one item at a time and ends with a summary: how many were newly shared, how many updated entries you had shared before, and which ones failed and why. One failure does not stop the rest, and you can cancel partway — whatever was already shared stays shared.

The same multi-select bar exists in the list view of the material gallery, so you can share several images or files at once instead of one at a time from each item's menu.

The button appears in the desktop app once a shared folder and an identity are set. What travels is the saved version of each item, so save the note you are editing before you share it.

### Share a page as a template <Badge type="tip" text="Added in v0.54.0 (2026-09-04)" />

A note's `⋯` menu also has **Share as template**, next to **Share with team**. Unlike a regular share, this hands out the page as a reusable starting point instead of a record: give it a name (defaults to the note's title) and, optionally, a description. It shares the page exactly as it stands — Graphium does not strip results or filled-in values for you, so clear anything you do not want to hand out before sharing.

Each share of a page as a template creates a brand-new entry rather than updating a previous one, since a template is an independent handout, not a snapshot tied back to the note it came from.

### Browse and fork

Once a shared folder is configured, a **Shared folder** entry appears in the sidebar's Notes, Knowledge and Materials tabs (near the top of the Notes tab, at the bottom of the Knowledge and Materials tabs), and it opens the shared items of the same kind as the tab you pressed (notes, knowledge or materials). It lists what everyone on the team has shared — notes, knowledge pages, references, and data files — on a tab each. Entries from others are read-only — press **Fork to my notes** to copy one into your own storage, where you can edit it freely. Any media it carries is materialized into your local library automatically, and the fork records where it came from.

Clicking a row opens it in the detail panel beside the table, the same as a click in your own note list. Double-click a row — or press **Open in full view** at the top of the detail panel — to read it full-page instead, in the same place and at the same width as your own notes. A right-hand rail lets you switch between **Comments**, **Version**, **Steps**, **Backlinks**, and **Graph** without leaving the page; **Comments** is open by default. The breadcrumb at the top (**Shared › Shared folder › title**) takes you back to the table. <Badge type="tip" text="Added in v0.58.0 (2026-09-07)" />

When an AI model is set up, the rail carries one more tab — **Ask AI** — for asking about the entry you are reading, with the shared text itself as the grounding. The conversation stays on your own device; nothing about it is written to the shared folder. See [Asking about a shared note](/ai-chat-and-ask#asking-about-a-shared-note). <Badge type="tip" text="Added in v0.59.0 (2026-09-07)" />

![The shared folder as a table: notes with folder, author, shared date, and version columns](/screenshots/shared-library.png)

![The full view of a shared note, with the comments rail open on the right](/screenshots/shared-note-full-view.png)

A shared note also carries the folder it was in when it was shared, so the **Notes** tab has a **Folder** column you can filter and search on. Forking does not bring that folder along: it is the author's own filing, so your copy starts unfiled. <Badge type="tip" text="Added in v0.53.0 (2026-09-03)" />

![Filtering the shared folder by folder](/screenshots/shared-library-folder-filter.png)

The **Assets** tab also has a Folder column, and lists every image or file embedded in a shared note alongside items shared directly as a material. A note's images and files are not entries you can fork or verify on their own — you can **open the parent note** or **add the file to your own materials**, and if the same file appears in several shared notes it is shown once with a count of how many notes carry it. <Badge type="tip" text="Added in v0.54.0 (2026-09-04)" />

Two more tabs mirror your own left-hand navigation: **Labels** and **Processes**. They show labels and PROV-DM procedures found in shared notes, extracted the same way your own note list and process list are. This piggybacks on the background read that also powers shared search and AI chat (see below), so a shared note whose content Graphium has not read yet will not contribute to these tabs until it does. Forking a process into your own notes works the same way it does for your own procedures. There is no separate action to share a label or a process — sharing the note that contains them is enough, and both tabs explain this with a link back to your own note list. <Badge type="tip" text="Added in v0.54.0 (2026-09-04)" />

![The Labels tab of the shared folder, listing the inputs collected from shared notes](/screenshots/shared-library-labels.png)

![The Processes tab of the shared folder, with a shared procedure and its flow](/screenshots/shared-library-process.png)

The **Templates** tab lists pages shared as templates (see above), with a **Description** column in place of the folder column you see on the Notes tab. There is no **Fork to my notes** here — a template is a blank starting point, not a record to copy — but its detail panel has **New note from template**, available on any entry including your own. It reads the template, rebuilds its blocks and labels into a new note, materializes any embedded media into your own library, and opens the result. The new note records which template it came from, separately from a fork's "derived from" — a template does not hand you any facts, only a shape to start from. The same template list also appears inside the editor's `/template` picker, so you can insert a shared template into a note you already have open instead of starting a new one — see [Notes & the editor](/notes-and-editor#templates). <Badge type="tip" text="Added in v0.54.0 (2026-09-04)" />

![The Templates tab of the shared folder, with a Description column in place of Folder](/screenshots/shared-library-templates.png)

### Shared entries in search and AI chat <Badge type="tip" text="Added in v0.52.0 (2026-09-03)" /> {#shared-entries-in-search-and-ai-chat}

Shared notes, knowledge pages, references, and data files also show up without forking them: the `⌘K` (`Ctrl+K` on Windows/Linux) search palette gets a **Shared** section, and AI chat can cross-search them the same way it cross-searches your own notes (Internal grounding scope). Graphium builds a search index and, for shared knowledge pages, an embedding — both on your own device only. Nothing is written back to the shared folder, and the AI never records a shared entry as a source in provenance unless you insert a citation card yourself.

This is on by default whenever a shared folder is configured, since setting up the shared folder is itself the opt-in step. Turn off **Include the shared folder in ⌘K and AI chat** in **Settings** → **Sharing** if you would rather keep search and AI chat scoped to your own notes. Note that the shared folder has no access control inside Graphium: anyone who can read it can index and search it the same way.

### Cite a shared entry in your notes <Badge type="tip" text="Added in v0.31.0 (2026-08-12)" />

Type `/` in any note and choose **Cite shared entry** to insert a citation card pointing at a shared note, reference, or data file. The card shows the entry's title, author, date, and a verification badge. It stays in your note as a *reference* — the content itself lives in the shared folder, and your note keeps only a lightweight snapshot for display, so the card still renders when the shared folder is unreachable.

The badge tells you the state of the shared side:

- **Verified** — the shared content matches its recorded fingerprint (hash).
- **Content differs** — the shared files no longer match the fingerprint; something modified them outside Graphium.
- **Cached copy** — the shared folder is unreachable (for example, the NAS is not mounted), so the card renders from its snapshot.
- **Not found** — the entry was removed or unshared.

![Four shared citation cards stacked vertically, each with a title, author and date: one marked Verified, one Content differs, one Cached copy, and one Not found.](/screenshots/shared-citation-cards.png)

When the author updates the entry in place, your card follows automatically. When they publish a major revision, the card keeps pointing at the version you cited and shows **A newer version is available** instead — your past analysis never changes underneath you. Click the arrow on the card to open the entry in the shared folder. Citations are also recorded in the note's provenance, so an exported evidence bundle shows which shared entries your note used.

### Copy a citation link from the shared folder <Badge type="tip" text="Added in v0.44.0 (2026-08-25)" /> {#copy-a-citation-link-from-the-library}

You can also start from the other end. In **Shared** → **Shared folder**, press **Copy citation link** on an entry — on its card or in its detail panel — and paste the link into any note. It becomes the same citation card, with the same badges and the same behaviour.

Pasting is what makes this worth having: the shared folder fills the whole window, so while you are browsing it you cannot see the note you are aiming at. Copying the link lets you find the entry first and decide where it lands afterwards. The link is plain text, so it can travel in a chat message as well; a teammate on the same shared folder gets the same card by pasting it into a note of their own.

### Reply with a comment <Badge type="tip" text="Added in v0.57.0 (2026-09-06)" />

Any entry in the shared folder — a note, a knowledge page, a reference, anything — can carry a comment thread. Open its detail panel and scroll to **Comments**: write a note, or click a paragraph in the preview first to attach the comment to that specific spot (a small "¶" chip shows what it's attached to; there's a button to remove the attachment before posting). Comments support one level of replies — a reply to a reply is just added to the same thread — which is enough for a back-and-forth without turning into a nested discussion.

![A shared note's detail panel with its comment thread docked below the preview](/screenshots/shared-library-detail-comments.png)

You need your identity saved (see [Your author identity](#your-author-identity)) before you can write a comment; without it, the panel explains why and points you at Settings.

Comments have no "resolved" checkbox. Instead, when the note's author fixes something and presses **Update shared copy**, the note's fingerprint changes, and any comment written against the old version automatically moves into a collapsed **Comments on older versions** section — the thread doesn't disappear, but it steps out of the way once the point has been addressed. You can edit or delete your own comments; you cannot edit someone else's.

If you have a note of your own shared and someone comments on it, the same thread appears in a **Comments** tab in that note's own right-hand panel while you're editing it — clicking a comment there jumps to and briefly highlights the paragraph it was written against.

The full-view page (above) keeps the same **Comments** panel in its own right-hand rail, so you can read and reply without opening the detail panel first. Clicking a paragraph in the body attaches a "¶" chip to your comment the same way it does in the detail panel.

### Update history and the updated / new-comment marks <Badge type="tip" text="Added in v0.57.0 (2026-09-06)" />

Every time a shared entry is re-shared under **Update shared copy**, Graphium keeps a short log of that: the version column in the shared folder shows how many times an entry has been updated (for example "v1 · 3 updates"), and the detail panel lists each update's date, author, and the first eight characters of its fingerprint.

To help you notice what changed since you last looked, the shared folder also marks rows **Updated** (the entry's fingerprint changed since you opened it) or with a new-comment count (comments added since you opened it). These marks come from a small record kept only on your own device — nothing is written back to the shared folder, and an entry you authored never shows "Updated" for your own edits. The shared folder also refreshes itself automatically when you switch back to the Graphium tab or window, so these marks stay current without a manual reload.

![Rows in the shared folder marked Updated and with a new-comment count](/screenshots/shared-library-update-marks.png)

### Reverse links: who cited or forked this <Badge type="tip" text="Added in v0.57.0 (2026-09-06)" />

When a note cites a shared entry, forks it, or is created from a shared template, the shared folder can now show that relationship from the other side too. A shared entry's detail panel lists the shared notes that cite it, the shared notes forked from it, and — for templates — the shared notes made from it, each one clickable to jump straight to it. This depends on Graphium having already read the citing/forking note's content at least once, so a very recently shared note may take a moment to show up in another entry's reverse links.

### Propose changes to someone else's note <Badge type="tip" text="Added in v0.66.0 (2026-09-08)" /> {#propose-changes}

A note you forked from the shared folder can be offered back as a **proposal**: your version of the note, shared as a suggestion. The original is not rewritten — its author decides whether to take anything in.

Proposing takes three steps:

1. In the shared folder, open the note and press **Fork to my notes** to get your own copy
2. Edit the copy as usual — fill in values, fix a step, add a table
3. From the note's `⋯` menu, choose **Propose changes to the original**

The dialog shows which note you are proposing to, and whether the version you forked is still the latest one. Add a one-line description if you like and press **Propose**; a proposal under your own name appears in the shared folder. You can send an updated version later with **Update proposal**, or take it back with **Withdraw proposal**. While a note is shared as a proposal it is not shared as a copy of its own — one note points at one shared entry.

![The Propose changes to the original dialog showing the original note Sourdough loaf — Saturday bake by Mia Tanaka, a baseline line, a filled-in one-line description, and Cancel and Propose buttons.](/screenshots/share-propose-dialog.png)

The shared folder screen gains a **Proposals** tab listing title, the original note (click it to jump there), author, shared date, version, and state. The state is worked out on the spot rather than stored:

| State | Meaning |
|---|---|
| Open | The original's author has not taken this in yet |
| Adopted | The original's author took this proposal in |
| Original updated since | The original changed after the proposal was made |

![The shared folder Proposals tab with the shared folder /Volumes/Bakery/Shared in the header and a table listing three proposals with their original notes, authors, dates, versions and states: Open, Original updated since, and Adopted.](/screenshots/shared-library-proposals.png)

Open a proposal in full view and a **Changes** tab appears in the right-hand rail, listing the differences from the original block by block — and, for tables, cell by cell. Click an item and the matching spot in the body preview lights up.

![A proposal by Ken Sato opened in full view with the Changes tab in the right rail, listing four block-level changes with Proposer and Author badges including a table cell change.](/screenshots/shared-proposal-diff.png)

If the version you forked was kept, each change is attributed and coloured: **Proposer** (only you changed it — a candidate for the author to take in), **Author** (the original's author changed it afterwards), or **Both** (you both changed it and disagree). Without that baseline — no large files folder configured, or an older fork — the view falls back to comparing the proposal with the original's current version, and cannot tell the two apart. The list says so at the top.

Some things are deliberately not compared: the link target of images and files (shared and local copies always spell those differently — captions and file names *are* compared), pages after the first, and annotations such as labels and step links.

Seen from the original, a note that has proposals shows **N proposals** on its row, and its detail panel lists them under reverse links; click one to open it.

You can still propose when the original has moved on. The changes are then shown against the original's current version, so your edits and the author's edits sit side by side.

The full view of a proposal is a place to **read**. Taking changes in happens on the author's side, in their own note.

#### Adopting a proposal (the original's author) <Badge type="tip" text="Added in v0.67.0 (2026-09-08)" /> {#adopt-a-proposal}

When a proposal arrives for a note you shared, opening that note adds a **Proposals** tab to the right-hand rail (notes with no proposals don't get one). A **Proposals N** badge next to the shared badge in the header opens the same tab.

1. Open **Proposals** in the right rail. Incoming proposals are listed with author, date, state and description
2. Pick one and you get the differences against your note. The comparison is against **what you are writing right now**, not against the shared copy — edits you have not published yet are already taken into account
3. Tick the changes you want. Ticked by default are the ones only the **proposer** changed. **Both** (you disagree) is left for you to judge. **Author** (what you changed) has no checkbox — there is nothing to take in
4. Press **Adopt selected changes**

![The Proposals tab in the right rail with one proposal opened: four changes with checkboxes for the proposer's edits, an author-added change without a checkbox, and an Adopt selected changes (3) button.](/screenshots/note-proposals-adopt.png)

Pressing it first saves a version ("before adopting") automatically, then applies only what you ticked. If you change your mind, restore that version from the `⋯` menu — or just undo (⌘Z / Ctrl+Z), which reverses the whole thing in one step.

Tables can be picked at two levels. Tick individual cells, rows or columns and only those change. Tick the table itself and the whole table is replaced with the proposed one. You cannot do both — a wholesale replace would also drop rows you added yourself.

Adopting does not change the shared side yet. It becomes a new version when you press **Update shared copy**, and only then does the proposer's badge turn to **Adopted**. The `⋯` menu says "N adopted proposal(s) will be part of the new version", so you can tell when you have forgotten to press it.

From the proposer's side, the state badge changes to **Adopted**. Their note stays where it is, so they can keep working and propose again, or clean up with **Withdraw proposal** in the `⋯` menu.

#### Seeing where a note came from {#forked-from}

A note you created by forking shows a **Forked from: …** chip in its header; click it to open the original shared entry. The **Graph** panel on the right shows the same relationship as a dashed link, alongside any proposals aimed at your note (clickable too).

### Let others update a note, one after another <Badge type="tip" text="Added in v0.151.0 (2026-11-19)" /> {#accept-updates}

Normally only the author can change a shared note; everyone else forks it or proposes changes. If the author wants to share the editing instead, they can let others update the shared note directly. Updates then happen **one after another**, never at the same moment.

**The author turns it on.** Open the note in the shared folder, open **Version** in the right rail, and switch on **Accept updates from others**. It is off by default, and it is a per-note setting. Notes that accept updates show an **Accepting updates** mark in the header for everyone, with who updated it last.

**Others make a copy, edit it, and apply it.**

1. Open the note and press **Fork to my notes** as usual. The header reminds you that the note accepts updates
2. Edit your copy
3. In the `⋯` menu of your copy, press **Apply to shared note**. The dialog shows which shared note it applies to and the name that will be recorded as the person who updated it
4. Press **Apply**

**If someone updated it first, nothing is overwritten.** Graphium checks that the shared note is still the version you copied from. If it is not, it writes nothing and tells you so. Your copy stays as it is, and you can **make a copy from the latest version**, **propose it as a change** instead, or close the message. The same goes for the author: pressing **Update shared copy** again on a note that others have updated shows "Someone has updated this note first" instead of overwriting it.

**Previous versions.** Each update keeps the version it replaced, up to 5. Under **Previous versions** in the right rail, pressing **Restore this version** (after a confirmation) writes that version back as the current one. The version you replaced is kept too, so you can go back again. Anyone who can update the note can restore.

**Who can update is decided by the shared folder.** The switch only says whether the note is open to updates. Who is actually allowed to write is the permission of the shared folder (your file server or sync service), as with everything else here.

::: warning Limits
- **Two people updating at almost the same moment** can end up as a conflict copy made by your sync software (a file with a name like "conflicted copy"). Graphium shows a notice with the file names when it finds one, but it does not merge it into the note. Open the files and decide yourself
- **The name is self-declared.** The author identity is what each person typed in, not a verified login. It is a record for people, not proof of who made the change
- **Writing straight to a NAS without sync software**: when two people update at almost the same moment, no conflict copy is made, and one of the updates may not remain
- **Stopping sharing deletes the previous versions** along with the note
- **Turning the switch off** hides the list of previous versions (it comes back when you turn it on again)
- **The date of a previous version** comes from the clock of the computer that wrote it
- **An author on an old version of the app** who shares again will overwrite the note **without the check**, so updates by others can be lost. Update the app for everyone who shares into this folder (the previous versions above are the way back)
:::

### See the shared records for each row of a plan <Badge type="tip" text="Added in v0.160.0 (2026-11-24)" /> {#records-by-plan-row}

This is for when one person writes the plan and other people work through its rows. In a lab, for example, a supervisor plans the experiments and students carry them out one row at a time. Once the plan is shared, the notes people create from its rows and then share are listed by row, so opening the plan shows who has shared a record for which row, and when.

**The flow**

1. **The person who plans** shares a note that has a table with a note per row (the table in the plan template, for example)
2. **The person who records** opens that plan in the shared folder and chooses **Fork to my notes**
3. In the forked plan's table, they select the icon to the left of a row to create that row's note, and write the record there
4. At a natural stopping point, they share the row's note with **Share with team** in the `⋯` menu (and **Update shared copy** after writing more). Graphium says which plan and which row the note was shared as the record for
5. **Open the plan as your own note** (the person who shared it opens the original; everyone else opens their fork), and **Row records N** appears in the note's header. Selecting it opens the right panel, which lists who shared a record for each row of the plan, with the date. Selecting a record opens it

![The right panel of a plan note. Each row lists who shared a record and on what date. Records that contain a checklist also show a count such as 5/5 or 3/5. Records not opened yet are marked New, records updated since they were opened are marked Updated, and rows without a record say None yet](/screenshots/plan-row-records.png)

- A record you have not opened yet is marked **New**; one that was updated after you opened it is marked **Updated**. Your own records are not marked
- A row with no record says **None yet**
- If a record contains a checklist, its count at the time it was shared is shown as **3/5** (checked items / all items) <Badge type="tip" text="Added in v0.162.1 (2026-11-24)" />. A record without a checklist shows nothing
- Renaming a row in the plan keeps the match, because rows are matched by the id each row carries. Records for a row that was removed from the plan's table, or that was added to a fork of the plan, are listed at the end under **Records for rows not in this plan's table**
- A fork of the plan shows the same list, including records other people shared for the same row
- If you have not forked the plan, open it in the shared folder: its backlinks show **Records for this plan's rows**. That list is ordered by row name and does not show rows without a record. A record's own details show **Plan row** (the plan's title › the row's name)
- The badge and the right panel appear in the desktop app, once a shared folder is set up
- In a fork of a plan, rows that were linked to notes on the sharer's own device are unlinked, because those notes do not exist on your device. You can then create your own note from the row

The only things added to the shared note are which plan and which row it belongs to and, when it contains a checklist, that count. The note's body does not change.

::: warning Limits
- **Only shared records are listed.** A note that has not been shared does not appear in anyone else's plan
- **There are no due dates, owners or progress states.** What you see is whether a record exists, who shared it and when, and the checklist count at the time it was shared. The count is shown as counted; it is not turned into a percentage, a sort order or a "done" mark. For the reason, see "Can I manage tasks or projects in Graphium?" in the [FAQ](/faq)
- **Rows added after the plan was shared** do not appear in forks that were made earlier. To start a record for a new row, fork the plan again. The row notes created before, and their shared copies, stay as they are
- **Checklist counts are as of when the record was shared.** Items checked after that do not reach other people's lists until you choose **Update shared copy** on the row's note
- **If a row's note was shared before the plan was**, choose **Update shared copy** on the row's note after sharing the plan, and the match is added
- **Names are self-declared.** The name on a record is the one its author typed in
:::

### See what other people shared, on Home <Badge type="tip" text="Added in v0.164.0 (2026-11-24)" /> {#shared-records-on-home}

Switch the who switch on [Home](/notes-and-editor#the-notes-list) to **Shared authors**, and the notes and AI pages that other people put in the shared folders are listed by day, in the order they were shared. You can see who shared what today in one place, without opening a plan.

![Home with the who switch on Shared authors. Notes that other people shared are listed by time, each with its author's name. Records for a plan row also show the plan's title › the row's name (Sandwich loaf plan › Bulk ferment) and a checklist count such as 3/5](/screenshots/home-shared-authors.png)

- The time is when the record was last shared. After **Update shared copy**, the record moves to the day it was updated
- A [record for a plan row](#records-by-plan-row) shows **the plan's title › the row's name**. If it contains a checklist, the count at the time it was shared (**3/5**) is shown too. When the plan is not in a shared folder, **Plan** is shown in place of its title
- Type a name in the search box to find that person's records. The plan's title and the row's name are searched too. Body text matches for the records this device has read into its search index
- Press a row to open the record in full screen. The next time you open Home, it starts on **Shared authors** (except when you open it from **See "…" in Home** in `⌘K`)
- These records are not listed under **All**. **All** means everything in your own storage
- What you shared yourself is not listed here, because it is already on Home as your own note. Yours are told apart by the email address in your [author identity](#your-author-identity)
- Switching to **Shared authors** clears the folder filter, because records in a shared folder are not in your own folders

::: warning Limits
- **Only notes and AI pages are listed.** References, data, templates, comments and proposals in a shared folder are not; see them on the shared folder screen
- **Checklist counts are shown only for records of a plan row.** A shared note that is not tied to a plan shows none
- **There is no summary per plan.** To compare records row by row, open **Row records** on the plan
- **There is no filter that picks a person from a list.** To narrow to one person, type the name in the search box
- This appears in the desktop app, once a shared folder is set up
:::

## Exports

Everything can leave Graphium in open formats, per note or in bulk.

Per note, the **Export** section of the `⋯` menu offers:

| Menu item | Output |
|---|---|
| **Print / PDF** | The rendered note, including its provenance graph. Your system's print dialog opens, so you can preview the pages and then save them as a PDF — the text stays selectable and searchable |
| **Markdown (.md)** | A portable `.md` file |
| **Word (.docx)** | A Word file with the text, tables, images and charts |
| **Provenance (PROV-JSON-LD)** | The note's provenance graph in W3C PROV format, plus the note's own record: text, folders, sources, memos, materials, tables and the other notes it points at (no AI chats) |
| **Export plan provenance** | Plan notes only. The whole plan — steps, planned lines, and the operation notes' provenance — as one `.plan.jsonld` (see [Exporting a plan](/labels-and-provenance#plan-prov-export)) |

Markdown is lossy by design: what a block *means* survives, how it *looks* does not. A formula exports as its LaTeX source, a calculation as its lines with the values they produced, and a chart as its caption and what it plots. The figure itself cannot travel, but the table behind it exports as an ordinary Markdown table.

### Export to Word <Badge type="tip" text="Added in v0.140.0 (2026-11-17)" /> {#export-to-word}

**Word (.docx)** in the note menu, and in the menu of a note opened in the side peek, saves the note as a Word file. Headings, spacing and tables are styled in the file itself. On the desktop app, the save dialog opens in the folder you last saved a Word file to, so a fixed folder (a team's synced folder, say) takes one click.

![The note menu with its Export group: Print / PDF, Markdown (.md), Word (.docx), highlighted, and Provenance (PROV-JSON-LD).](/screenshots/note-menu-word.png)

The Word file carries headings, paragraphs, bullet, numbered and check lists, quotes, code, tables (merged cells included), images stored in Graphium, and the charts of the note you have open (as pictures). Formulas, both formula blocks and formulas inside a sentence, arrive as Word equations that you can go on editing in Word: fractions, superscripts and subscripts, roots, Greek letters, sums, integrals, brackets, function names and text. A formula that uses something outside that range, such as a matrix, several aligned lines, an equation number or a box, arrives as its LaTeX text instead. This is decided formula by formula, and a formula is never left half converted. Some things arrive as text: a calculation as its lines, a data table as its first 50 rows, and a PDF or bookmark as its name (with its link when it points at a web address). Check and toggle items keep their mark as a character, and links to other notes arrive as plain text. The page is A4 portrait, with the note's title at the top. A chart picture keeps its caption and the blocks nested under it, and a very tall picture is scaled down to fit the page. Images from an external URL arrive as a link only, and the graphs of labels and provenance are not included.

### Export everything <Badge type="tip" text="Added in v0.16.10 (2026-07-03)" />

**Settings** → **Storage** → **Export and backup** has two bulk buttons:

- **Export all notes (Markdown)** — a ZIP of every note as Markdown, for reading anywhere.
- **Download backup (JSON)** — a ZIP of the raw data (`.graphium.json`) for every note, Knowledge page, and skill document, including archived and trashed ones. This is the lossless option.

Media files (images, PDFs) are not included in either ZIP — back those up separately as described below.

### Export selected notes <Badge type="tip" text="Added in v0.101.3 (2026-10-28)" />

To take out only some notes, open **All Notes**, tick the ones you want, and open **More** in the bar that appears and choose **Export (Markdown)**. One note downloads as a `.md` file; two or more download as a ZIP with one `.md` per note, the same shape as **Export all notes (Markdown)**. The notes stay selected afterwards, so you can go on to archive the same set.

Like the bulk export, this reads the notes as they are saved; an edit made a moment ago in an open note is included once it has been saved.

## Backing up

- **Browser version**: press **Download backup (JSON)** regularly. It is your only safety net against cleared site data, and re-download it after any big writing session.
- **Desktop app**: your data is plain files in the Graphium folder (`~/Documents/Graphium/` unless you moved it). Any backup tool that copies that folder — including its `media` subfolder — captures everything. Pointing the save location at a synced folder gives you continuous off-machine copies for free.

A periodic **Download backup (JSON)** is cheap insurance on every platform — it captures notes, Knowledge, and skills in one file, independent of where the live data sits.

## What goes over the network {#what-goes-over-the-network}

Your notes are saved on your own computer (or in your browser), and Graphium has no account or server of its own for them. Apart from the AI provider and the tools you set up yourself, these are the main connections Graphium makes on its own or after one action (the one-time voice model download is described in [Voice notes](/voice-notes)). Each one is listed with what it sends, when it runs and how to stop it.

| What | Where to | What is sent | When it runs | How to stop it |
|---|---|---|---|---|
| **Update check** (desktop app only) | GitHub Pages (`kumagallium.github.io`), and GitHub Releases as a fallback | A plain request for a small version file. No notes, no account details | Automatically about 5 seconds after launch and every 24 hours, and when you press **Check for updates** | Turn off **Check for updates automatically** in Settings → **About**. See [Updating](/desktop-app#updating) |
| **Search model download** (desktop app only) | Hugging Face (`huggingface.co`) | Only a request for the model files (about 587 MB for the default, bge-m3). None of your text is sent, and the files are not fetched again once saved | Once, automatically, the first time the default on-this-computer model is needed (until it is ready, matching text is used). Pressing **Download** in Settings does the same | Choose an embedding model from an AI provider in Settings → **AI** instead (that sends the text being embedded to that provider). See [Settings](/settings) |
| **World grounding** (desktop app, only while **Use world grounding** is on) | Wikipedia and OpenAlex (`api.openalex.org`), through the Graphium backend on your computer | The text of the claim or insight being checked, as search words, plus the app's name in the User-Agent and (to OpenAlex) the project's shared contact address in the `mailto` parameter. On a self-hosted setup where the operator has configured an MCP Registry, the search words also go to that Registry's search tool. If you have connected web search (Tavily) in Settings → AI, the search words (cut to 400 characters) also go to Tavily (only while it is connected). Other MCP servers you add yourself in Settings → AI are not used for this | When you press **Check world**, and in the background if you switched on **Auto-ground new knowledge** (off by default) | Switch off **Use world grounding** (and **Auto-ground new knowledge**) in Settings → **AI** → **Preview features**. See [World grounding](/ai-grounding) |
| **Source lookup** | Crossref (`api.crossref.org`) | Only the DOI of the material | Only when you press the lookup button on a material, or the bulk **Fill in from DOI** button on the selected materials (one DOI at a time) | Don't press it |
| **Phone capture to Google Drive** (the phone capture screen; sending only after you connect storage) | Google (the sign-in script from `accounts.google.com` and the Drive API) | The files you send from the phone queue, into a `Graphium/Inbox` folder of your own Drive. Graphium can reach only the files it creates | Opening the phone capture screen loads Google's sign-in script, even before you connect (nothing of yours is sent at that point). After you connect, files are sent automatically: right after you add them to the queue, when you come back to the screen, and when the phone is back online. Pressing **Send** does it at once | Don't connect storage on the phone. Once connected, choose **Disconnect** in the phone settings sheet. See [Mobile capture](/mobile) |

The AI provider you register, the tools (MCP servers) you connect, and **Seal as evidence** each send data only when you use them, and are described on their own pages: [Setting up AI](/ai-setup), [Connecting an AI assistant (MCP)](/mcp-server) and [Notes & editor](/notes-and-editor).
