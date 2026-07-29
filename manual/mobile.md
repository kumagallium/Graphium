# Mobile capture

Ideas rarely arrive while you sit at your desk. Graphium treats your phone as a **capture device for your desktop brain** — a place to jot memos, snap photos, and save links that you will organize, cite, and grow into knowledge later on your computer. It is deliberately not a standalone phone note app: the thinking happens on the desktop, and the phone feeds it.

## Quick memos on the desktop

The fastest capture doesn't need your phone at all. Press `⌘⇧M` (`Ctrl+Shift+M` on Windows/Linux) anywhere in Graphium to open a quick memo dialog, type your thought, and press `⌘Enter` to save. The memo lands in your memo collection without touching the note you were writing.

Other ways in:

| Entry point | Where |
|---|---|
| **+ Memo** | Button in the sidebar |
| **New Memo** | Button at the top of the memo gallery |
| **File → New Memo** | Native menu in the [desktop app](/desktop-app), same `⌘⇧M` shortcut |
| **Save as memo** | While reading a PDF or web page in [materials](/materials-and-citations), select text to quote it into a memo |

## The phone view

Open [the app](https://kumagallium.github.io/Graphium/app/) in your phone's browser. On a narrow screen, the home view is built for capture: a timeline of your past memos and media, a search box, pull-to-refresh, and a capture bar fixed at the bottom.

![Mobile capture view with timeline and capture bar](/screenshots/mobile-capture.png)

The capture bar offers:

- **New Memo** — opens a full-screen text input.
- **Register URL** — saves a link as a bookmark material.
- Photo, video, and audio buttons — these open your phone's camera or microphone directly, so a lab bench or whiteboard is two taps away.

![Writing a memo on the phone](/screenshots/mobile-memo-input.png)

Tap any memo in the timeline to reread, edit, or delete it. You can open and edit full notes on the phone too — the editor works — but the phone home is optimized for getting things *in*, not for writing.

::: tip Install it like an app
Graphium is an installable web app (PWA). Use your phone browser's "Add to Home Screen" and it launches full-screen straight into the editor, no browser chrome.
:::

::: warning Captures stay on the device that took them
Unless you set up [mobile upload](#sending-captures-to-your-desktop) below, everything you capture on the phone lives in *that phone browser's* local storage — it does not appear on your desktop. See [Storage & sync](/storage-and-sync) for where data lives.
:::

## The memo gallery

On the desktop, click **Memos** in the sidebar (the count next to it shows how many you have). Memos are shown as a wall of sticky-note cards; toggle between **Gallery** and **List** views, and search as you type.

Select several memos at once — drag across cards or shift-click — and act on the batch:

| Action | What it does |
|---|---|
| **Archive** | Moves memos out of the gallery without deleting them |
| Delete | Removes them permanently (memos already inserted into notes leave the note text untouched) |
| **Turn into Knowledge** (shows the selected count) | Extracts knowledge entries from the selected memos directly into the [Knowledge layer](/knowledge-layer) — no notes are created |

Click a single memo to open its detail: edit the text (an **Edit history** is kept), and switch between the **Network** tab — a small graph of which notes this memo has been inserted into — and the **History** tab.

Each note also has a **Memos** tab in its right panel, showing the memos attached to that note.

## Putting memos into notes

A memo is raw material; sooner or later you pull it into a note.

- **Slash menu**: type `/memo` in the editor. The **Memo** item ("Insert from saved memos", under **Existing media**) opens the **Select memo** picker, where you can search and pick one.
- **From the gallery**: open a memo's detail while a note is open and click **Insert into note**.

Either way, Graphium asks whether to **Insert and keep memo** or **Insert and delete memo** — keep it if you expect to cite the same thought elsewhere. A memo that carries a source (one made with **Save as memo** from a reader view) is inserted as a quote block with its source shown after the text.

### Attaching memos to blocks

Memos can also annotate a specific block instead of the whole note: open the block's drag-handle (⠿) menu and choose **Add memo**. See [block-anchored memos](/materials-and-citations#block-anchored-memos) for how the memo tracks its block.

## Memos are citable sources

Memos are not throwaway text — they carry lineage, which is the whole point of capturing in Graphium rather than a scratchpad:

- A memo made with **Save as memo** remembers which material it was quoted from, down to the PDF page.
- Every insertion is recorded, so a memo knows the notes it was used in (the "Used in" count and the **Network** tab).
- When you run **Turn into Knowledge**, the resulting knowledge entries record the memo as their source, so the [lineage graph](/labels-and-provenance) can trace a claim back through the memo to the moment you captured it.

## Sending captures to your desktop <Badge type="tip" text="Added in v0.23.1 (2026-07-29)" />

Mobile upload closes the loop: captures made on your phone travel through your own cloud storage and land in an inbox on your desktop. It is **experimental and off by default**, and receiving requires the [desktop app](/desktop-app) — the browser version cannot read a local sync folder.

The pipeline, end to end:

1. **Enable it on the desktop.** Open [Settings → Storage](/settings) and turn on **Mobile sync** (marked **Experimental**). This reveals the phone-side send queue and the desktop inbox at once.
2. **Pick the receive folder.** In the **Mobile upload** section that appears, set the **Inbox folder** — choose the local folder your cloud client keeps in sync (for example, your Google Drive folder). Graphium watches the `Inbox` subfolder inside it.
3. **Connect the phone.** The same section shows a QR code under **Connect on your phone** (or **Copy URL**). Scan it with your phone to open Graphium there. Storage is signed in per device, so the connection happens on the phone you capture with — currently Google Drive, via **Connect storage**.
4. **Capture and send.** The phone home switches to a queue-first layout with a capture bar: **Write**, **URL**, **Photo**, **Video**, **Voice**, and **Library**. Captures collect in the **Send queue** (persisted on the phone, so nothing is lost if you close the browser) until you tap **Send** (the button shows the queued count) — then they upload to your cloud storage's `Graphium/Inbox` folder. You can also start from the phone side: the classic phone home shows a **Send captures to your desktop** card — tap **Try it** and connect storage there.
5. **Import on the desktop.** Once files sync down, a **Mobile** entry appears in the sidebar with a pending count. Open it to preview each item, then **Import all** or **Import selected**. Photos, videos, and audio become [materials](/materials-and-citations); memos and URLs become regular memos and bookmarks. When the inbox is empty it simply says **Nothing new**.

By default, imported files are deleted from the inbox — their content is already in your library. Check **Keep processed files in _imported/** (in the inbox's folder settings or in Settings → Storage) if you prefer an archive.

On the phone, the gear icon opens a minimal settings sheet — storage, language, app info, and **Leave this experiment**, which returns the phone home to its classic layout without touching your queue or connection.

![Mobile upload settings with inbox folder and QR code](/screenshots/mobile-upload-settings.png)

::: info Why cloud storage in the middle?
Your phone and desktop never talk to a Graphium server — captures travel through storage *you* control (your Google Drive), and the desktop only reads a folder on its own disk. See [Storage & sync](/storage-and-sync).
:::
