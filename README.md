# provnote

Block-based note editor with **PROV-DM** provenance tracking — built on [BlockNote.js](https://www.blocknotejs.org/).

## What is provnote?

provnote turns structured notes into traceable provenance graphs. It combines:

- **BlockNote.js** — a modern block-based rich text editor
- **Zettelkasten** — atomic, linked note-taking
- **PROV-DM** — W3C standard for provenance data model
- **AI-ready** — structured output for LLM integration

## Features

- Context labels (`[手順]`, `[使用したもの]`, `[条件]`, `[試料]`, `[結果]`) mapped to PROV-DM roles
- Block-to-block linking with provenance semantics (`informed_by`, `derived_from`, `used`)
- Multi-page tabbed editor with scope derivation
- Sample branching (table rows → parallel PROV activities)
- PROV-JSONLD generation from labeled documents
- Provenance graph visualization (Cytoscape.js + ELK layout)

## Getting Started

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Run tests
pnpm test
```

## Architecture

```
src/
├── base/              # Editor core (BlockNote wrapper, multi-page)
├── features/
│   ├── context-label/ # PROV-DM context labels for blocks
│   ├── block-link/    # Block-to-block provenance links
│   ├── prov-generator/# PROV-JSONLD generation & graph visualization
│   ├── sample-branch/ # Sample table → activity branching
│   └── template/      # Template save/load/diff
└── blocks/            # Custom BlockNote blocks
```

## License

[MIT](LICENSE)
