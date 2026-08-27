# Connecting from Claude (MCP)

Graphium can act as an **MCP server**, which means an AI assistant that lives outside Graphium — Claude Desktop, Claude Code, or any other [MCP](https://modelcontextprotocol.io) client — can look inside your notes and add new ones.

Instead of opening Graphium, finding the right note, and copying a procedure into a chat window, you ask the assistant directly:

> "What conditions did I use when I ball-milled CuGaTe2?"

and it reads the answer out of your own notes, with the note it came from.

## What this is good for

- **Asking your own notes questions.** Your assistant searches your vault instead of guessing from general knowledge.
- **Comparing your own experiments.** "Which of my runs used a graphite die?" is a question your notes can answer and a general-purpose model cannot.
- **Pulling a procedure into a conversation.** Steps come back in order, with the materials, tools and conditions attached to each one.
- **Saving a conclusion back.** When a conversation produces something worth keeping, the assistant can write it into your vault as a new note.

Your notes never leave your machine except as answers the assistant reads. Graphium does not have to be running — the server reads your note files directly, so it works with the app closed.

## Setting it up

You need [Node.js](https://nodejs.org/) 20 or later and a copy of the Graphium source.

**1. Build the server.** In the Graphium folder:

```bash
pnpm install
pnpm bundle:mcp
```

This produces a single file at `dist-mcp/graphium-mcp.mjs`.

**2. Tell your client about it.** For Claude Desktop, open **Settings → Developer → Edit Config** and add a `graphium` entry:

```json
{
  "mcpServers": {
    "graphium": {
      "command": "node",
      "args": ["/absolute/path/to/Graphium/dist-mcp/graphium-mcp.mjs"]
    }
  }
}
```

Use the full path, not a relative one. For Claude Code, run `claude mcp add graphium -- node /absolute/path/to/Graphium/dist-mcp/graphium-mcp.mjs` instead.

**3. Restart the client.** Claude Desktop needs a full restart, not just a new conversation.

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

## What the assistant can do

Seven tools are available. You do not call them by name — you ask in plain language and the assistant picks.

| Tool | What you would ask |
|---|---|
| `search_notes` | "Find my notes about thermoelectric measurements" |
| `get_note` | "Show me that note" |
| `get_note_steps` | "What were the steps, with the conditions?" |
| `find_notes_using` | "Which experiments used a planetary ball mill?" |
| `list_entities` | "What materials and instruments show up across my notes?" |
| `trace_lineage` | "Where did this conclusion come from?" |
| `create_note` | "Save this as a note" |

Search covers titles, body text, step names and labels, and works in Japanese without spaces between words — the same segmentation the app itself uses, so a query that finds something in Graphium finds it here too.

Every answer carries the note id and the block id, so the assistant can tell you exactly where something came from and you can open that spot in Graphium.

### Labels make it much better

`find_notes_using` and `list_entities` read the **material / tool / condition / output** highlights you put in your notes. If you have not labelled anything yet, those two tools have nothing to work with — search and the other five still work fine.

This is the payoff of labelling: once a handful of notes name the same instrument, "which of my experiments used this?" becomes a question you can just ask. See [Labels & provenance](/labels-and-provenance).

## What it deliberately does not do

**It never edits your existing notes.** `create_note` only adds new ones. Nothing an assistant does through MCP can overwrite something you wrote.

**It never invents provenance.** You might expect that chatting about an experiment would build the provenance graph for you. It does not, and this is on purpose. Provenance is a record of what actually happened. A graph reconstructed from a conversation would look the same but mean something different — a guess about your procedure, with nothing to check it against. Graphium records provenance from what you did in the editor, not from what a model inferred you probably did.

What *is* recorded automatically is the write itself. A note created through MCP carries who asked for it, which client it came through, and which model wrote it. That is an observation, not an inference.

**Notes created through MCP appear after a reload.** The note list is built by the app, so a note written while Graphium is open shows up the next time you reload or restart it.

## Troubleshooting

**The client shows no Graphium tools.** Check the path in the config is absolute and points at an existing `graphium-mcp.mjs`, then fully restart the client. In Claude Desktop, **Settings → Developer** shows whether the server started.

**Tools answer "vault not found".** The server could not find your notes folder. Set `GRAPHIUM_ROOT` in the `env` block to the folder that contains `notes/`.

**Search finds nothing in a vault that has notes.** The server builds its own search index on first use, which takes about a second on a large vault. If it stays empty, check that the folder you pointed at is the one Graphium actually saves into — **⚙ Settings → General** shows the current path.

## See also

- [Labels & provenance](/labels-and-provenance) — the labels that `find_notes_using` reads
- [Storage & sync](/storage-and-sync) — where your notes live on disk
- [Setting up AI](/ai-setup) — Graphium's own built-in AI, which is separate from this
