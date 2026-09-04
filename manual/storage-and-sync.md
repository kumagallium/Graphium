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

On the desktop app you can move the whole data folder: open **Settings** → **Storage** → **Local save location** and press **Change…**. The current and default paths are shown, and **Reset to default** takes you back to the Documents folder.

Two things to know before you switch:

- Existing notes are not moved automatically. Copy the contents of the old folder into the new one before you continue working.
- Restart Graphium after changing the location so it takes effect everywhere.

::: tip Sync without a cloud account
The settings hint says it best: point the save location at a Dropbox-, Google Drive-, or OneDrive-synced folder and your notes follow you across machines — no OAuth, no extra service. Graphium itself never talks to the cloud; the sync client does.
:::

## Your author identity

Notes record who wrote them. Open **Settings** → **Storage** → **Your identity** and fill in **Display name** and **Email**, then press **Save identity**. This identity is stamped on shared notes and on PROV provenance entries (the record of who edited what — see [Labels & provenance](/labels-and-provenance)). It is self-asserted: there is no login or verification behind it.

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

To bring something back, open **Trash & Archive** at the bottom of the sidebar. The view has a **Trash** tab (with **Restore** and **Delete permanently**) and an **Archive** tab (with **Restore from archive** and **Send to trash**). A trashed or archived note opened directly also offers **Restore from trash** / **Restore from archive** in its `⋯` menu.

**Delete permanently** is the only destructive step: on the desktop app the file is moved to your operating system's trash; in the browser version it is deleted immediately and cannot be undone.

Media has the same protection: deleting a file from the [material library](/materials-and-citations) that notes or saved versions still reference offers **Archive (recommended)** instead, which hides it while keeping those references working.

## Sharing notes with your team <Badge type="tip" text="Added in v0.6.0 (2026-05-05)" />

Sharing publishes a copy of a note into a folder your whole team can reach — a lab NAS, a Dropbox-synced folder, any shared drive. It is desktop-only for now; the browser version cannot read or write local folders.

![Storage tab of the settings dialog with save location, identity, shared storage, and export sections](/screenshots/settings-storage.png)

### Set up the shared folders

In **Settings** → **Storage** → **Shared storage**:

1. Pick a **Shared folder** — the team-visible location where published notes go.
2. Optionally pick a **Blob folder (large binaries)** — where media bytes are stored. Notes with embedded images, PDFs, or other media need it; URL bookmarks don't.
3. Press **Test connection** to run a full round trip (write → read → verify → delete) against the folder.

You must save your identity first — shared entries carry their author's name and email.

### Publish and unpublish

Open a note's `⋯` menu and choose **Share with team**. A **Shared** badge appears on the note, and teammates see it in their shared library. When you share a note containing media, the files are copied into the blob folder automatically — you never attach them by hand.

The shared copy is a snapshot. To update it, edit your local note and choose **Update shared copy** from the same menu. To withdraw it, use **Unshare** in the shared library; Graphium warns that other members may have already viewed, cached, or forked it, so it cannot be fully erased.

### Share knowledge pages too <Badge type="tip" text="Added in v0.44.0 (2026-08-25)" />

Knowledge pages — summaries, claims, and insights — share the same way. Open a page's `⋯` menu, choose **Share with team**, and it appears under **Knowledge** in the shared library, next to the shared notes. **Update shared copy** and **Unshare** work as they do for notes.

Forking one brings it into your knowledge rather than your notes, so it sits with your own claims and insights and joins your searches and graphs. Its lineage does not come along: a shared page's "derived from" links point at notes, chats, and claims in the author's library, and those ids mean nothing in yours. The fork starts with that lineage cleared and records where it came from instead, so nothing is left dangling or pointing at the wrong page. The text, the semantic type, and any sections edited by hand arrive intact. World-check results and search embeddings are rebuilt on your side rather than carried over.

### Share several at once <Badge type="tip" text="Added in v0.44.0 (2026-08-25)" />

Select notes with the checkboxes in the notes list, or knowledge pages in a Knowledge list, and a **Share** button with the count on it joins the other bulk actions. Sharing runs one item at a time and ends with a summary: how many were newly shared, how many updated entries you had shared before, and which ones failed and why. One failure does not stop the rest, and you can cancel partway — whatever was already shared stays shared.

The button appears in the desktop app once a shared folder and an identity are set. What travels is the saved version of each item, so save the note you are editing before you share it.

### Share a page as a template

A note's `⋯` menu also has **Share as template**, next to **Share with team**. Unlike a regular share, this hands out the page as a reusable starting point instead of a record: give it a name (defaults to the note's title) and, optionally, a description. It shares the page exactly as it stands — Graphium does not strip results or filled-in values for you, so clear anything you do not want to hand out before sharing.

Each share of a page as a template creates a brand-new entry rather than updating a previous one, since a template is an independent handout, not a snapshot tied back to the note it came from.

### Browse and fork

Once a shared folder is configured, a **Library** section with a **Shared** entry appears in the sidebar. It lists what everyone on the team has shared — notes, knowledge pages, references, and data files — on a tab each. Entries from others are read-only — press **Fork** to copy one into your own storage, where you can edit it freely. Any media it carries is materialized into your local library automatically, and the fork records where it came from.

![The shared library as a table: notes with folder, author, shared date, and version columns](/screenshots/shared-library.png)

A shared note also carries the folder it was in when it was shared, so the **Notes** tab has a **Folder** column you can filter and search on. Forking does not bring that folder along: it is the author's own filing, so your copy starts unfiled. <Badge type="tip" text="Added in v0.53.0 (2026-09-03)" />

![Filtering the shared library by folder](/screenshots/shared-library-folder-filter.png)

The **Assets** tab also has a Folder column, and lists every image or file embedded in a shared note alongside items shared directly as a material. A note's images and files are not entries you can fork or verify on their own — you can **open the parent note** or **add the file to your own materials**, and if the same file appears in several shared notes it is shown once with a count of how many notes carry it.

Two more tabs mirror your own left-hand navigation: **Labels** and **Processes**. They show labels and PROV-DM procedures found in shared notes, extracted the same way your own note list and process list are. This piggybacks on the background read that also powers shared search and AI chat (see below), so a shared note whose content Graphium has not read yet will not contribute to these tabs until it does. Forking a process into your own notes works the same way it does for your own procedures.

The **Templates** tab lists pages shared as templates (see above), with a **Description** column in place of the folder column you see on the Notes tab. There is no **Fork** here — a template is a blank starting point, not a record to copy — but its detail panel has **New note from template**, available on any entry including your own. It reads the template, rebuilds its blocks and labels into a new note, materializes any embedded media into your own library, and opens the result. The new note records which template it came from, separately from a fork's "derived from" — a template does not hand you any facts, only a shape to start from. The same template list also appears inside the editor's `/template` picker, so you can insert a shared template into a note you already have open instead of starting a new one — see [Notes & the editor](/notes-and-editor#templates).

### Shared entries in search and AI chat <Badge type="tip" text="Added in v0.52.0 (2026-09-03)" /> {#shared-entries-in-search-and-ai-chat}

Shared notes, knowledge pages, references, and data files also show up without forking them: the `⌘K` search palette gets a **Shared** section, and AI chat can cross-search them the same way it cross-searches your own notes (Internal grounding scope). Graphium builds a search index and, for shared knowledge pages, an embedding — both on your own device only. Nothing is written back to the shared folder, and the AI never records a shared entry as a source in provenance unless you insert a citation card yourself.

This is on by default whenever a shared folder is configured, since setting up the shared folder is itself the opt-in step. Turn it off in **Settings** → **Storage** → **Shared storage** if you would rather keep search and AI chat scoped to your own library. Note that the shared folder has no access control inside Graphium: anyone who can read it can index and search it the same way.

### Cite a shared entry in your notes <Badge type="tip" text="Added in v0.31.0 (2026-08-12)" />

Type `/` in any note and choose **Cite shared entry** to insert a citation card pointing at a shared note, reference, or data file. The card shows the entry's title, author, date, and a verification badge. It stays in your note as a *reference* — the content itself lives in the shared folder, and your note keeps only a lightweight snapshot for display, so the card still renders when the shared folder is unreachable.

The badge tells you the state of the shared side:

- **Verified** — the shared content matches its recorded fingerprint (hash).
- **Content differs** — the shared files no longer match the fingerprint; something modified them outside Graphium.
- **Cached copy** — the shared folder is unreachable (for example, the NAS is not mounted), so the card renders from its snapshot.
- **Not found** — the entry was removed or unshared.

When the author updates the entry in place, your card follows automatically. When they publish a major revision, the card keeps pointing at the version you cited and shows **A newer version is available** instead — your past analysis never changes underneath you. Click the arrow on the card to open the entry in the shared library. Citations are also recorded in the note's provenance, so an exported evidence bundle shows which shared entries your note used.

### Copy a citation link from the library <Badge type="tip" text="Added in v0.44.0 (2026-08-25)" />

You can also start from the other end. In **Library** → **Shared**, press **Copy citation link** on an entry — on its card or in its detail panel — and paste the link into any note. It becomes the same citation card, with the same badges and the same behaviour.

Pasting is what makes this worth having: the library takes over the screen, so while you are browsing it you cannot see the note you are aiming at. Copying the link lets you find the entry first and decide where it lands afterwards. The link is plain text, so it can travel in a chat message as well; a teammate on the same shared folder gets the same card by pasting it into a note of their own.

## Exports

Everything can leave Graphium in open formats, per note or in bulk.

Per note, the `⋯` menu offers:

| Menu item | Output |
|---|---|
| **Print / PDF** | The rendered note, including its provenance graph. Your system's print dialog opens, so you can preview the pages and then save them as a PDF — the text stays selectable and searchable |
| **Markdown** | A portable `.md` file |
| **PROV-JSON-LD** | The note's provenance graph in W3C PROV format |

Markdown is lossy by design: what a block *means* survives, how it *looks* does not. A formula exports as its LaTeX source, a calculation as its lines with the values they produced, and a chart as its caption and what it plots. The figure itself cannot travel, but the table behind it exports as an ordinary Markdown table.

### Export everything <Badge type="tip" text="Added in v0.16.10 (2026-07-03)" />

**Settings** → **Storage** → **Export & backup** has two bulk buttons:

- **Export all notes (Markdown)** — a ZIP of every note as Markdown, for reading anywhere.
- **Download backup (JSON)** — a ZIP of the raw data (`.graphium.json`) for every note, Knowledge page, and skill document, including archived and trashed ones. This is the lossless option.

Media files (images, PDFs) are not included in either ZIP — back those up separately as described below.

## Backing up

- **Browser version**: press **Download backup (JSON)** regularly. It is your only safety net against cleared site data, and re-download it after any big writing session.
- **Desktop app**: your data is plain files in the Graphium folder (`~/Documents/Graphium/` unless you moved it). Any backup tool that copies that folder — including its `media` subfolder — captures everything. Pointing the save location at a synced folder gives you continuous off-machine copies for free.

A periodic **Download backup (JSON)** is cheap insurance on every platform — it captures notes, Knowledge, and skills in one file, independent of where the live data sits.
