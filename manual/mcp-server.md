# Connecting from an AI assistant (MCP) <Badge type="tip" text="Added in v0.46.0 (2026-08-28)" />

Graphium can act as an **MCP server**, which means an AI assistant that lives outside Graphium — Claude Desktop, Claude Code, or any other [MCP](https://modelcontextprotocol.io) client — can look inside your notes, add new ones, and help maintain the knowledge layer.

::: tip This is the opposite direction from MCP servers in Setting up AI
[That page](/ai-setup#mcp-servers) is about Graphium as the **client**, calling out to other tools from its own AI chat. This page is about Graphium as the **server**, with an outside assistant calling in to your notes. They are independent: use either, both, or neither.
:::

Instead of opening Graphium, finding the right note, and copying a procedure into a chat window, you ask the assistant directly:

> "What conditions did I use when I ball-milled CuGaTe2?"

and it reads the answer out of your own notes, with the note it came from.

## What this is good for

- **Asking your own notes questions.** Your assistant searches your vault instead of guessing from general knowledge.
- **Comparing your own experiments.** "Which of my runs used a graphite die?" is a question your notes can answer and a general-purpose model cannot.
- **Pulling a procedure into a conversation.** Steps come back in order, with the materials, tools and conditions attached to each one.
- **Saving a conclusion back.** When a conversation produces something worth keeping, the assistant can write it into your vault as a new note.
- **Reading the source itself.** The assistant can read the text of a PDF (by page), a Word file, or a web page you have registered in Graphium, instead of relying on what a topic says about it.
- **Seeing a procedure as a diagram.** The steps of a note come back as a Mermaid flowchart you can paste into a document.
- **Maintaining knowledge pages.** The assistant can merge duplicate topics, rewrite a topic or Q&A page, or archive one. Every change is recorded and can be undone from Graphium.

Your notes never leave your machine except as answers the assistant reads. Reading, searching and adding notes work whether Graphium is open or closed — the server reads your note files directly. The one exception is **maintaining knowledge pages: quit Graphium first.** While the app is running it treats its own index as the truth, so a change made from outside would not show up until the next start and could be overwritten; the server refuses with `APP_RUNNING:` instead.

## Setting it up

There are three steps: build the server once, register it with the app you use, then check that it answers. After that you just talk to your assistant as usual.

You need:

- [Node.js](https://nodejs.org/) 20.16 or later (needed by the PDF reader, pdfjs)
- The Graphium source (the desktop app download does not include the MCP server, so you build it from source)
- [pnpm](https://pnpm.io/) (`npm install -g pnpm` if you don't have it)

**1. Build the server.** Get the source and run this in its folder:

```bash
git clone https://github.com/kumagallium/Graphium.git
cd Graphium
pnpm install
pnpm bundle:mcp
```

This produces a single file at `dist-mcp/graphium-mcp.mjs`. You will need its full path in the next step (the folder `pwd` prints, followed by `/dist-mcp/graphium-mcp.mjs`).

The bundle reads the PDF and Word text readers from the clone's `node_modules`, so **if you copy `graphium-mcp.mjs` somewhere else and run it there, only those two (PDF and Word text) stop working** — every other tool still works. Keep the file where `pnpm bundle:mcp` put it.

Note down the full path of `node` itself too. Desktop apps don't always inherit your terminal's `PATH`, so `"command": "node"` on its own can fail to start — especially if you installed Node with nvm.

```bash
which node
```

**2. Register it with your app.**

*Claude Code* — run this in a terminal. `--scope user` makes your Graphium notes available whichever folder you open Claude Code in; without it, the server is only registered for the folder you ran the command in.

```bash
claude mcp add --scope user graphium -- /path/to/node /path/to/Graphium/dist-mcp/graphium-mcp.mjs
```

*Claude Desktop* — add a `graphium` entry under `mcpServers` in the config file that **Settings → Developer → Edit Config** opens (on macOS, `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "graphium": {
      "command": "/path/to/node",
      "args": ["/path/to/Graphium/dist-mcp/graphium-mcp.mjs"]
    }
  }
}
```

::: warning Quit Claude Desktop before you edit the file
The same file also holds the app's own settings. If you edit it while the app is running, the app can write its in-memory copy back when it quits or restarts, and your `graphium` entry disappears. **Quit the app completely (⌘Q, or quit from the system tray on Windows)**, edit and save the file, then start the app again. Leave everything else in the file (other servers under `mcpServers`, `preferences`) as it is and only add `graphium`.
:::

Use full paths in both cases, not relative ones.

**3. Check that it works.** Claude Desktop needs a full restart, not just a new conversation; in Claude Code, start a new session. Then ask:

> What topics are in my notes?

If you get a list of topics back, you are done. In Claude Code, `claude mcp list` also shows whether `graphium` is `✓ Connected`.

### Other MCP clients

Nothing here is specific to Claude. Graphium speaks the standard protocol over stdio, so **any client that can launch a local MCP server works** — Cursor, VS Code, Zed, Cline, and others. What every one of them needs is the same two pieces: the command `node`, and the absolute path to `graphium-mcp.mjs`.

Where you put that differs by client, and these settings move around between versions, so check your client's own MCP documentation for the exact location and shape. Many accept the `mcpServers` JSON above as-is.

| Client | How to add it |
|---|---|
| Claude Desktop | Settings → Developer → Edit Config |
| Claude Code | `claude mcp add graphium -- node <path>` |
| Cursor, VS Code, Zed, Cline, … | Their own MCP settings — usually the same JSON shape |

Two limits worth knowing: the server runs as a **local process** (there is no hosted URL to point at — remote HTTP transport is not supported), and it needs **Node.js 20.16+** on the machine running the client. Since your notes stay on your disk, the client has to be on the same machine as your vault.

By default the server reads `~/Documents/Graphium`. If you changed the Graphium folder in **⚙ Settings → General**, the server follows that setting automatically. To point it somewhere else explicitly, add an `env` block:

```json
{
  "mcpServers": {
    "graphium": {
      "command": "node",
      "args": ["/absolute/path/to/Graphium/dist-mcp/graphium-mcp.mjs"],
      "env": { "GRAPHIUM_ROOT": "/Users/you/Dropbox/Graphium" }
    }
  }
}
```

### Updating to a newer version

The MCP server keeps running the Graphium version you built it from — the desktop app's auto-update does not touch it. After updating the source, rebuild and restart your app:

```bash
cd Graphium
git pull
pnpm install
pnpm bundle:mcp
```

You don't need to register it again; the file at the same path is simply replaced. If a tool listed below is missing from your assistant, a forgotten rebuild is the usual reason.

## What the assistant can do

These tools are available. You do not call them by name — you ask in plain language and the assistant picks.

| Tool | What you would ask |
|---|---|
| `search_notes` | "Find my notes about thermoelectric measurements" |
| `get_note` | "Show me that note" |
| `get_note_steps` | "What were the steps, with the conditions?" / "Draw this procedure as a diagram" (`format: "mermaid"` returns a flowchart) |
| `find_notes_using` | "Which experiments used a planetary ball mill?" |
| `list_entities` | "What materials and instruments show up across my notes?" |
| `list_topics` <Badge type="tip" text="Added in v0.76.0 (2026-09-16)" /> | "What topics has Graphium worked out from my notes?" |
| `get_topic` <Badge type="tip" text="Added in v0.76.0 (2026-09-16)" /> | "Tell me what you know about sintering conditions" (returns the body and the names of the sources it cites) |
| `trace_lineage` | "Where did this conclusion come from?" / "Which notes came from this PDF?" |
| `create_note` | "Save this as a note" |
| `save_answer` <Badge type="tip" text="Added in v0.79.0 (2026-09-18)" /> | "Keep this answer for later" |
| `export_prov` | "Give me this note's provenance as PROV-DM (W3C PROV JSON-LD)" |
| `get_source_text` | "Read page 3 of that PDF" / "What does the source actually say?" |
| `search_media` | "Which PDF did I import about sintering?" / "Where is the figure with the phase diagram?" |
| `check_knowledge` | "Are there duplicate or empty topics?" (mechanical checks only) |
| `list_source_check` | "Which pages did source check flag as needing review?" |
| `revise_topic` | "Rewrite this topic with the new result" |
| `merge_topics` | "Merge these duplicate topics into one" |
| `archive_page` | "Archive the topics we no longer need" |
| `restore_page` | "Bring that page back from the archive" |
| `list_operations` | "What upkeep operations have been done recently?" |
| `undo_operation` | "Undo that merge" |

Search covers titles, body text, step names and labels, and works in Japanese without spaces between words — the same segmentation the app itself uses, so a query that finds something in Graphium finds it here too.

### `create_note`: formulas, superscript and subscript

The body is Markdown: headings, lists, code blocks, tables, bold, italic, inline code and links, plus formulas and superscript / subscript. These use the notation `get_note` uses when it hands a note to the assistant: `$…$` for a formula inside a sentence, `$$ … $$` on a line of its own for a displayed formula, and `<sup>` / `<sub>` for 10⁵ or H₂O. So when the assistant quotes one of your notes into a new one, `$x$` and `<sup>5</sup>` are saved as a formula and a superscript rather than left as raw text. Prices are left alone: `$100 and $200` or `$50-$75` stay text.

### `create_note`: citations

`create_note` takes two optional arguments beyond `title` and `body`:

- **`citations`** — a list of `{ id, title? }` referring to Graphium notes or pages the answer drew on. When present, a References section is appended to the note body: an entry whose `id` matches an existing note becomes an `@`-linked reference (same shape as the References section topics build from their sources); an entry whose `id` does not resolve is kept as plain text instead of being silently dropped.

Both arguments are additive — a call without them behaves exactly as before.

### `create_note` vs. `save_answer`

Both tools write something new into your vault, but into different layers, and Graphium treats each layer differently afterwards:

- **`create_note`** writes a **note** — something a human maintains. Graphium never touches it again on its own.
- **`save_answer`** writes a **Q&A page** — a knowledge-layer page (the same `answer` kind the in-app "Keep as knowledge" button on a chat message produces). Once it exists, Graphium revises it whenever related material is ingested, and includes it in linting and source-check like any other knowledge page. One difference from the in-app button: "Keep as knowledge" rewrites the exchange into a standalone article before saving (it has the conversation to draw on); `save_answer` saves the `question`/`answer` you pass exactly as given, since Graphium has no access to the rest of your conversation with the external client. Write the body so it already reads standalone.

Use `save_answer` for something you expect Graphium to keep maintaining as your notes grow; use `create_note` for a one-off record you will maintain yourself.

In the body you pass to `save_answer`, **end every grounded sentence with `[[source:<id>]]`** (the ids you pass in `citations`; list several when several sources say the same thing). Source check works sentence by sentence — it asks whether the sources a sentence cites really say it — so a Q&A page with no citations in its body is never checked. Save one without them and the tool says so in its reply.

`save_answer` takes:

- **`question`** — becomes the page title.
- **`answer`** — the body (Markdown). Write `[[source:<id>]]` inline where the answer cites something in your vault.
- **`citations`** — a list of `{ id, title? }`, the same shape as `create_note`'s. Each `[[source:<id>]]` in `answer` is resolved against this list, and a References section is appended. An `id` that matches an existing note or page becomes an `@`-linked reference; an `id` that does not resolve is kept as plain text.
- **`sessionId`**, **`model`** — same as `create_note`, recorded for provenance.

After `save_answer` returns, the page appears in Graphium after a reload, same as a note from `create_note`.

### Reading a source

`get_source_text` returns the text of a source, cut into **windows** so a long document comes back a piece at a time (default 4,000 characters, with a 400-character overlap between windows). To continue, the assistant asks for the next window.

- **PDF** — each window says which pages it covers ("pages n–m"), and you can ask for a page directly ("read around page 3") to get the window that contains it.
- **Word** — `.docx` files only. Other formats (`.xlsx`, `.pptx`, the old `.doc`) answer `UNSUPPORTED_FORMAT`.
- **Web page** — only a URL already registered in Graphium. The text is **fetched again from the network** at that moment, so it is the page as it is now, not the copy Graphium saved when you imported it.
- **Note** — a note id returns the note's text.

The id of a source appears in `get_topic` and `search_media` (`pdf:…` / `document:…` / `url:…`), so the assistant can go from "what does this topic cite" to "read that source" without you looking anything up.

### Maintaining knowledge pages from your assistant

The assistant can look after the knowledge layer the way you would from **Upkeep**. This applies to **topics and Q&A pages only** — notes, claims and insights are never touched.

| Tool | What it does |
|---|---|
| `revise_topic` | Rewrites the body (Markdown). End each grounded sentence with `[[source:<id>]]`. Any source id you pass must exist in Graphium, otherwise it answers `UNKNOWN_SOURCE`. If you pass no sources, the page keeps its current ones |
| `merge_topics` | Merges topics into one. You pass the body of the topic that stays; the absorbed topics go to the Trash |
| `archive_page` / `restore_page` | Archives a page, or brings one back from the archive or Trash |
| `list_operations` | Lists recent upkeep operations, including ones done in the app, with whether each can be undone |
| `undo_operation` | Undoes one operation. It first returns an estimate of what would change. If a page was edited after the operation, or source check results would also go back, you have to repeat the call with `confirm: true` |

How this stays safe:

- **Every change is recorded and can be undone.** Operations appear in Graphium under **Upkeep → Operations** as **MCP (client name)**, next to the ones you started in the app, and you can undo them from there too (see [Upkeep operations can be undone](/knowledge-layer#undo-maintenance)). An undo done through MCP is itself recorded and can be undone.
- **No version is made.** The History panel does not get a version for a change made through MCP. To go back, use the Operations record (the copies it keeps last one year).
- **`restore_page` is not recorded**, the same as un-archiving in the app.
- **Quit Graphium first.** While the app is running these tools answer `APP_RUNNING:` and change nothing.
- **Two MCP clients writing at once** — the second one answers `BUSY:` until the first finishes.
- **A vault Graphium has never opened** has no `note-index.json`, and these tools answer `NO_INDEX:`. Start Graphium once, quit it, and try again.
- **An old-format topic** (one built from claims) answers `OLD_FORMAT:`. Open it in Graphium and use **Rebuild from sources** to bring it to the new format first.

The changes show up the next time you start Graphium. Two things catch up only later: the "used in notes" list on a source, and semantic search (embeddings) for that page, which update the next time you save or re-embed the page in the app.

### Notes vs. knowledge

Graphium builds a knowledge layer on top of your notes: **claims** (findings extracted from a note, with their source attached), **topics** (a page that gathers what your sources say about one concept), and **insights** (a pattern that spans two or more claims). `search_notes` can filter by `kind` — `note`, `topic`, `claim`, `insight`, or `wiki` for all of the knowledge layer at once — and every hit reports which one it is.

`list_topics` is the fastest way to see the shape of what Graphium has worked out: a title and one-line summary per topic, the same "read the index first" approach Karpathy describes for an LLM-facing wiki. `get_topic` opens one topic and returns its body together with its sources — the sources the body cites for topics built from sources, or, for older topics built from claims, the claims it gathers and the notes each claim came from.

Every answer carries the note id and the block id, so the assistant can tell you exactly where something came from and you can open that spot in Graphium.

### What an answer looks like

Asking for a procedure gives you the steps in order, with what each one used:

```
# 多結晶CuGaTe2のボールミリング条件と熱電特性 の手順（9 件）

1. 溶融  [blockId: 801e35ed-…]
   material: Cu, Ga, Te
   tool: シリカ管
   attribute: 99.99%, 99.999%
   純度99.99%のCu、純度99.99%のGa、純度99.999%のTeをシリカ管に封入し、直接反応によって溶融する。

3. ボールミリング  [blockId: b2cd7d10-…]
   material: 粉末
   tool: プラネタリーボールミル, WC ボール
   attribute: rpm: 300, ball-to-powder ratio: 2:6:1, atmosphere: Ar, time: 0 h
```

Asking which notes share an instrument gives you the set, with the block in each:

```
■ tool: グラファイトダイ  — 3 ノート
   - 多結晶CuGaTe2のボールミリング条件と熱電特性  [noteId: 70ac6b8a-…, blockId: 540904a1-…]
   - CuGaTe2 のボールミリング条件が熱電特性に与える影響  [noteId: 585e605f-…, blockId: d22a6e98-…]
```

### Things worth asking

You never name a tool — ask in plain language and the assistant picks. These work well:

- *"Which of my experiments used a graphite die?"* — the comparison you cannot get from a general-purpose model, because it needs your records
- *"Walk me through the CuGaTe2 ball-milling procedure, with the conditions for each step."* — pulls a procedure into the conversation so you can adapt it
- *"What instruments and materials show up across my notes?"* — a way to see the shape of what you have recorded
- *"I ran this at 873 K instead. How does that compare to what I did before?"* — your own notes as the baseline
- *"Where did this conclusion come from?"* — follows the provenance back to the notes it was derived from, and to the PDF, Word file or web page they were imported from
- *"What else was made from that source?"* — starts from a source and finds the notes and topics that came from it
- *"Save what we just worked out as a note titled …"* — writes the conversation's outcome into your vault
- *"Draw this procedure as a diagram."* — returns the steps as a Mermaid flowchart (up to 60 steps)
- *"Merge the duplicate topics."* — finds duplicates, merges them, and records it so you can undo (quit Graphium first)
- *"Read around page 3 of this PDF."* — reads the source itself, not just what a topic says about it

A good habit is to ask for the note it used. The assistant has the ids, so "which note is that from?" always has an answer, and you can open it in Graphium to check.

### A typical session

Here is what it looks like to consult your records while drafting a paper or writing analysis code in Claude Code:

1. **Get the overview** — "What topics are in my notes?" (`list_topics`)
2. **Go deeper** — "Tell me what you know about the synthesis conditions for Zn4Sb3" (`get_topic`). You get the body and the names of the sources behind it
3. **Check** — "Show me the procedure, with conditions, for the runs that didn't come out single-phase" (`search_notes` → `get_note_steps`). If something looks off, open the returned note id in Graphium
4. **Write back** — "Save what we just worked out as a note titled 'Re-sintering Zn4Sb3 tends to decompose it into ZnSb'" (`create_note`). It appears in Graphium after a reload

A maintenance session looks different. Quit Graphium first, then:

1. **Look for problems** — "Check my knowledge for duplicates" (`check_knowledge`)
2. **Merge** — "Merge those two Zn4Sb3 topics" (`merge_topics`). The assistant writes the combined body and the absorbed topic goes to the Trash
3. **Confirm** — "What did you just change?" (`list_operations`)
4. **Undo if it is wrong** — "Undo that" (`undo_operation`). Start Graphium again afterwards to see the result

### Labels make it much better

`find_notes_using` and `list_entities` read the **material / tool / condition / output** highlights you put in your notes. If you have not labelled anything yet, those two tools have nothing to work with — search, topics and the other tools still work fine.

This is the payoff of labelling: once a handful of notes name the same instrument, "which of my experiments used this?" becomes a question you can just ask. See [Labels & provenance](/labels-and-provenance).

## What it deliberately does not do

**It never edits your existing notes.** `create_note` only adds new ones. `save_answer` only adds new Q&A pages — it does not touch your notes either, though the Q&A page it creates *will* be revised later by Graphium's own knowledge-layer maintenance, unlike a note. Nothing an assistant does through MCP can overwrite a **note** you wrote.

**Knowledge pages can be maintained, and every change is recorded and undoable.** Topics and Q&A pages can be rewritten, merged and archived (see [above](#maintaining-knowledge-pages-from-your-assistant)). Each of these is written to the Operations record with the client name, and you can undo it from Graphium. This is refused while Graphium is running, and no History-panel version is made — you go back through the Operations record.

**The checks are mechanical only.** `check_knowledge` finds orphaned and empty pages, duplicate titles, missing sources and contradiction marks. The AI-based checks (stale, gaps, semantic duplicates) are in Graphium's Upkeep view. The procedure diagram covers up to 60 steps; beyond that it shows the first 60 and a note.

**It never invents provenance.** You might expect that chatting about an experiment would build the provenance graph for you. It does not, and this is on purpose. Provenance is a record of what actually happened. A graph reconstructed from a conversation would look the same but mean something different — a guess about your procedure, with nothing to check it against. Graphium records provenance from what you did in the editor, not from what a model inferred you probably did.

What *is* recorded automatically is the write itself. A note created through MCP carries who asked for it, which client it came through, and which model wrote it. That is an observation, not an inference.

**Notes and Q&A pages created through MCP appear after a reload.** Both lists are built by the app, so something written while Graphium is open shows up the next time you reload or restart it. Changes made by upkeep tools show up the next time you start Graphium.

## Troubleshooting

**The client shows no Graphium tools.** Check the path in the config is absolute and points at an existing `graphium-mcp.mjs`, then fully restart the client. In Claude Desktop, **Settings → Developer** shows whether the server started.

**The entry I added disappeared after restarting Claude Desktop.** Editing the config file while the app is running lets the app overwrite it with its old copy. Quit the app completely with ⌘Q and edit the file again (see the warning in [Setting it up](#setting-it-up)).

**The server does not start (the log shows `spawn node ENOENT` or similar).** The desktop app cannot find `node`. Put the full path from `which node` in `"command"`.

**In Claude Code, it works in one folder but not another.** It was registered without `--scope user`, so it only applies to the folder you registered it in. Register it again with `claude mcp add --scope user …`.

**A tool from this page is missing, or the answers look out of date.** The server file is still the one you built earlier. Rebuild it as described in [Updating to a newer version](#updating-to-a-newer-version).

**A maintenance tool answers `APP_RUNNING:`.** Graphium is running. Quit it completely and try again. The browser version can look as if it is still running for about 90 seconds after you close it.

**A maintenance tool answers `BUSY:`.** Another MCP client is writing right now. Wait a moment and try again.

**A maintenance tool answers `NO_INDEX:`.** The vault has no `note-index.json` yet, which means Graphium has never opened it. Start Graphium once, quit it, and try again.

**Reading a PDF fails and says Node 20.16 or later is needed.** Update Node.js to 20.16 or later (use the full path of that `node` in `"command"`).

**PDF and Word text do not work, but everything else does.** The bundle was copied away from the clone. Run it from `dist-mcp/` in the clone, or point your client at that path again.

**Tools answer "vault not found".** The server could not find your notes folder. Set `GRAPHIUM_ROOT` in the `env` block to the folder that contains `notes/`.

**Search finds nothing in a vault that has notes.** The server builds its own search index on first use, which takes about a second on a large vault. If it stays empty, check that the folder you pointed at is the one Graphium actually saves into — **⚙ Settings → General** shows the current path.

## See also

- [Labels & provenance](/labels-and-provenance) — the labels that `find_notes_using` reads
- [Storage & sync](/storage-and-sync) — where your notes live on disk
- [Setting up AI](/ai-setup) — Graphium's own built-in AI, which is separate from this
