# provnote

Block-based note editor with **PROV-DM** provenance tracking — built on [BlockNote.js](https://www.blocknotejs.org/).

## Try it now

**[→ Open provnote on GitHub Pages](https://kumagallium.github.io/provnote/)**

No installation required — works in your browser. Notes are saved to Google Drive or your browser's local storage.

## What is provnote?

provnote turns structured notes into traceable provenance graphs. It combines:

- **BlockNote.js** — a modern block-based rich text editor
- **Zettelkasten** — atomic, linked note-taking
- **PROV-DM** — W3C standard for provenance data model
- **AI-powered** — AI assistant integration with full provenance tracking

## How to use

### Option 1: Use online (no setup)

Visit **https://kumagallium.github.io/provnote/** and start writing. Your notes are saved in your browser's local storage.

To sync with Google Drive, sign in with your Google account from the sidebar.

### Option 2: Run locally

```bash
git clone https://github.com/kumagallium/provnote.git
cd provnote
cp .env.example .env   # Edit with your Google OAuth client ID (optional)
pnpm install
pnpm dev --port 5174   # → http://localhost:5174/provnote/
```

### Option 3: With AI assistant

provnote's AI assistant lets you derive new notes from AI responses — with full provenance tracking of what was generated and from what context.

To enable AI features, you need an **AI agent server** (e.g., [crucible-agent](https://github.com/kumagallium/crucible-agent)):

1. Set up and start your agent server
2. In provnote, click the **⚙ Settings** icon in the sidebar
3. Enter the agent server URL (e.g., `http://localhost:8090`)

See [Architecture & AI integration](#architecture--ai-integration) for details.

## Features

- Context labels (`[手順]`, `[使用したもの]`, `[属性]`, `[試料]`, `[結果]`) mapped to PROV-DM roles
- Block-to-block linking with provenance semantics (`informed_by`, `derived_from`, `used`)
- Multi-page tabbed editor with scope derivation
- Sample branching (table rows → parallel PROV activities)
- PROV-JSONLD generation from labeled documents
- Provenance graph visualization (Cytoscape.js + ELK layout)
- Inter-note network graph (Cytoscape.js + fcose layout)
- AI assistant — derive notes from AI responses with full provenance metadata
- Google Drive storage — notes saved as `.provnote.json` files
- Google OAuth 2.0 authentication

## Architecture & AI integration

```
┌─────────────────────────────────────────────────────┐
│  provnote (browser)                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Editor   │  │ PROV-DM  │  │ AI Assistant      │ │
│  │(BlockNote)│  │ Graph    │  │ POST /agent/run   │─┼──→ Agent Server
│  └──────────┘  └──────────┘  └───────────────────┘ │    (crucible-agent
│        │                              │             │     or compatible)
│        └──────── provenance ──────────┘             │
└─────────────────────────────────────────────────────┘
```

provnote sends requests to an external agent server. Any server that implements the `POST /agent/run` endpoint can be used:

| Server | Description |
|--------|-------------|
| [crucible-agent](https://github.com/kumagallium/crucible-agent) | Full-featured agent runtime with MCP tool support and LiteLLM multi-model proxy |
| Any OpenAI-compatible proxy | Must implement `POST /agent/run` with the same request/response format |

## Development

```bash
pnpm install        # Install dependencies
pnpm dev            # Start dev server
pnpm test           # Run tests (vitest)
pnpm storybook      # Component catalog (http://localhost:6006)
pnpm build          # Production build
```

## Project structure

```
src/
├── base/              # Editor core (BlockNote wrapper, multi-page)
├── features/
│   ├── context-label/ # PROV-DM context labels for blocks
│   ├── block-link/    # Block-to-block provenance links
│   ├── prov-generator/# PROV-JSONLD generation & graph visualization
│   ├── sample-branch/ # Sample table → activity branching
│   ├── network-graph/ # Inter-note derivation network (Cytoscape + fcose)
│   ├── ai-assistant/  # AI derivation via agent server
│   ├── settings/      # AI agent URL configuration
│   ├── template/      # Template save/load/diff
│   └── release-notes/ # Release notes display
├── lib/               # Utilities (Google Auth, Drive API, Cytoscape setup)
└── blocks/            # Custom BlockNote blocks
```

## License

[MIT](LICENSE)
