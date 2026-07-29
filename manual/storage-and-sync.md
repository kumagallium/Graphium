# Storage & sync

Graphium keeps your notes in storage that you own — a browser database, plain files on your disk, or your own server. There is no Graphium cloud and no account. This page explains where your data lives on each platform, how to move it, how archive and trash protect your links, how team sharing works, and how to back everything up.

## Where your data lives

| Platform | Where notes are stored | Reach |
|---|---|---|
| Browser version | That browser's local database (IndexedDB) | Only that browser on that device |
| Desktop app | Plain files in a `Graphium` folder inside your Documents folder (`~/Documents/Graphium/` on macOS) | Only that machine — or any machine, if you point it at a synced folder |
| Docker / self-host | The server's filesystem (`/app/data` by default) | Any browser or device that opens the same URL |

### Browser version

Notes live in the browser's own IndexedDB storage. Nothing leaves your machine, but the storage belongs to that one browser profile.

::: warning Clearing site data erases your notes
If you clear this site's data in your browser (or use a private window), the notes stored there are gone. If you work in the browser version, download a backup regularly — see [Backing up](#backing-up) below.
:::

### Desktop app

The desktop app writes ordinary files you can see in your file manager. Inside the Graphium folder you'll find subfolders for `notes` (one JSON file per note), `media`, `wiki` (Knowledge pages), `skills`, and `appdata`. Because they are plain files, any backup or sync tool can handle them.

### Docker / self-host

When Graphium runs from your own server, notes are saved on the server's filesystem — open the same URL from any browser or device and you see the same notes. The frontend detects server storage automatically on first load.

To protect a server that isn't on `localhost`, set the `GRAPHIUM_AUTH_TOKEN` environment variable on the server. Then open **Settings** → **Storage** → **Server storage** in each browser, paste the same value into the token field, and press **Save and reload**. Without a token, anyone who can reach the URL can read and write notes.

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

**Delete permanently** is the only destructive step: on the desktop app the file is moved to your operating system's trash; on the browser and self-hosted versions it is deleted immediately and cannot be undone.

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

### Browse and fork

Once a shared folder is configured, a **Library** section with a **Shared** entry appears in the sidebar. It lists shared notes, references, and data files from everyone on the team. Entries from others are read-only — press **Fork** to copy a note into your own storage, where you can edit it freely. Any media the note carries is materialized into your local library automatically, and the fork records where it came from.

## Exports

Everything can leave Graphium in open formats, per note or in bulk.

Per note, the `⋯` menu offers:

| Menu item | Output |
|---|---|
| **PDF** | The rendered note, including its provenance graph |
| **Markdown** | A portable `.md` file |
| **PROV-JSON-LD** | The note's provenance graph in W3C PROV format |

### Export everything <Badge type="tip" text="Added in v0.16.10 (2026-07-03)" />

**Settings** → **Storage** → **Export & backup** has two bulk buttons:

- **Export all notes (Markdown)** — a ZIP of every note as Markdown, for reading anywhere.
- **Download backup (JSON)** — a ZIP of the raw data (`.graphium.json`) for every note, Knowledge page, and skill document, including archived and trashed ones. This is the lossless option.

Media files (images, PDFs) are not included in either ZIP — back those up separately as described below.

## Backing up

- **Browser version**: press **Download backup (JSON)** regularly. It is your only safety net against cleared site data, and re-download it after any big writing session.
- **Desktop app**: your data is plain files in the Graphium folder (`~/Documents/Graphium/` unless you moved it). Any backup tool that copies that folder — including its `media` subfolder — captures everything. Pointing the save location at a synced folder gives you continuous off-machine copies for free.
- **Docker / self-host**: back up the server's data directory (`/app/data` by default) with your usual server backup routine, and keep the storage token somewhere safe.

A periodic **Download backup (JSON)** is cheap insurance on every platform — it captures notes, Knowledge, and skills in one file, independent of where the live data sits.
