<p align="center">
  <img src="public/logo.png" alt="Graphium" width="80" />
</p>
<h1 align="center">Graphium</h1>
<p align="center">
  <b>A note editor that turns information into knowledge you can reuse, anytime.</b>
</p>
<p align="center">
  Block-based note editor with <b>PROV-DM</b> provenance tracking, built on <a href="https://www.blocknotejs.org/">BlockNote.js</a>.
</p>
<p align="center">
  <b>English</b> | <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/kumagallium/Graphium/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/kumagallium/Graphium?display_name=tag&sort=semver"></a>
  <a href="https://github.com/kumagallium/Graphium/releases"><img alt="dmg downloads" src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/kumagallium/Graphium/badges/badges/dmg-downloads.json"></a>
  <a href="https://github.com/kumagallium/Graphium/actions/workflows/test.yml"><img alt="CI" src="https://github.com/kumagallium/Graphium/actions/workflows/test.yml/badge.svg?branch=main"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/kumagallium/Graphium?cacheSeconds=3600"></a>
  <a href="https://github.com/kumagallium/Graphium/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/kumagallium/Graphium?style=flat"></a>
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/kumagallium/Graphium/main">
</p>

Graphium is a personal open-source project that combines [Zettelkasten](https://en.wikipedia.org/wiki/Zettelkasten)-style atomic note-taking with [PROV-DM](https://www.w3.org/TR/prov-dm/), a W3C provenance standard. The result is a notebook where every claim, including the ones an AI hands you, can be traced back to the notes and sources that justify it.

### Learn more before you install

- 📘 [**CONCEPT**](docs/CONCEPT.md) ([日本語](docs/CONCEPT.ja.md)) — the design philosophy: why provenance matters, the two brains, the hourglass.
- 🏗️ [**ARCHITECTURE**](docs/ARCHITECTURE.md) — layers, distribution targets, the Wiki pipeline, known seams.
- 🗂️ [**DATA_MODEL**](docs/DATA_MODEL.md) — the on-disk JSON shapes, schemas, and compatibility rules.

## Use as much, or as little, as you need

Graphium is designed around **progressive disclosure**. Labelling is optional, and it comes in two layers you can adopt independently.

| Level | What you do | What you get |
|-------|------------|--------------|
| **Just notes** | Write and link notes with `@` references | A linked notebook on your filesystem (or browser IndexedDB on the web) |
| **Block-level structure** | Mark heading blocks as `[Step]` (or as a phase: `[Plan]` / `[Result]`) | The skeleton of a provenance graph — what happened, in what order |
| **Inline detail** | Highlight spans inside a block as `[Input]` / `[Tool]` / `[Parameter]` / `[Output]` | A full provenance graph — what was used, with what conditions, what came out |

The `#` block labels and the inline highlights are two passes over the same content, not a single all-or-nothing label. You can write a note with no labels, give it a step structure later, and add inline detail only on the parts that matter. **The provenance layer activates only where you choose** — that gradient *is* the design.

For the deeper rationale, see [docs/CONCEPT.md §6](docs/CONCEPT.md#6-progressive-disclosure-use-as-much-or-as-little-as-you-need).

## Try it now

**[→ Preview in your browser (GitHub Pages)](https://kumagallium.github.io/Graphium/)**

The browser version is a **preview** to try the editor and PROV-DM labeling. Notes are stored in this browser's IndexedDB — fine for kicking the tires, but the desktop app or self-hosted Docker is what you want for the full experience: AI features (Knowledge Layer, AI chat), durable storage, and cross-device sync.

### Desktop app

Download the desktop app to save notes as plain JSON files on your filesystem. Point the save folder at a Google Drive / iCloud / Dropbox synced folder if you want cloud sync — no extra OAuth setup needed.

| Platform | File | How to check |
|----------|------|-------------|
| **macOS** (Apple Silicon — M1/M2/M3/M4) | `Graphium_x.x.x_aarch64.dmg` | Apple menu →  About This Mac → "Apple M..." |
| **Windows** (x64) | `Graphium_x.x.x_x64-setup.exe` (or `Graphium_x.x.x_x64_en-US.msi`) | Settings → System → About → System type "x64-based" |

**[→ Download from Releases](https://github.com/kumagallium/Graphium/releases/latest)**

> **First-run warning on Windows**
> The Windows build is not code-signed yet, so Windows SmartScreen shows "Windows protected your PC" on first launch. Click **More info → Run anyway** to proceed. Code signing is on the roadmap.

> **Other platforms**
> Linux and Intel macOS desktop builds are not provided. Please use the [browser version on GitHub Pages](https://kumagallium.github.io/Graphium/) (no install) or self-host with the [Docker setup](#option-2-run-with-docker--editor-only) described below. Bringing the desktop app to those platforms is on the roadmap; see [issues](https://github.com/kumagallium/Graphium/issues) if you'd like to help test.

### Mobile (paused)

A mobile capture flow (PWA, quick memos, camera capture) was prototyped but is currently **paused** while the desktop and Knowledge Layer work matures. The browser version still installs on iOS / Android home screens, but mobile-specific features (timeline view, quick capture button) are not actively maintained at the moment.

If you want to follow or help restart this work, see the [issues](https://github.com/kumagallium/Graphium/issues).

## Knowledge layer

When you connect an LLM, Graphium builds a **second layer** on top of your notes — an editable Knowledge layer auto-generated from what you've written. Think of it as *Zettelkasten extended by an LLM*: the AI reads your notes, extracts stable ideas, keeps them cross-linked, and cites back to the source blocks — all while carrying the same PROV-DM provenance as the rest of the editor.

The layer has four document kinds, each with a distinct role:

| Kind | Role |
|------|------|
| **Summaries** | Internal-facing summary of one note. |
| **Claims** | Cross-note findings with key elements extracted. Claims qualify by `level` (principle / finding / bridge) and `status` (candidate / verified). |
| **Insights** | One context-free claim with citations back to the source notes — the unit that travels across projects. |
| **Ideas** | New idea built by weaving Insights together. Authored through the Cmd-K Composer flow: select the Insights you want to weave, build a citation note, and invoke the LLM with that as the search-space constraint. |

| Capability | What it does |
|-----------|--------------|
| **Pipeline** | Ingest → Atomize → Cross-update → Lint, running on the companion server when you save a note. Ideas are authored separately through Cmd-K Composer rather than as a pipeline stage. |
| **Ingest from notes** | The AI extracts knowledge-worthy sections and writes them into Knowledge pages, citing back to source blocks. |
| **Ingest from URL & chat** | Drop a URL or save an AI chat response — it becomes a Knowledge page with the same provenance chain. |
| **Cross-update** | When one Knowledge page changes, dependent pages are flagged or rewritten so the layer stays consistent. |
| **Lint** | Detects orphan Insights, broken citations, and redundant Claims. |
| **Edit protection** | Sections you manually edited are skipped during re-ingest, so your corrections survive. |
| **Retriever for AI chat** | Knowledge context is injected into AI responses — the assistant remembers what you wrote last week without re-reading every note. |
| **Auto-labeled answers** | AI replies are inserted with PROV-DM structure already attached: `[Step]` labels on activity headings, inline highlights for `[Input]` / `[Tool]` / `[Parameter]` / `[Output]`, and `informed_by` links between consecutive steps. A provenance graph emerges from the chat itself, no manual labeling required. |

Knowledge pages live in the same storage as your notes (IndexedDB on web, filesystem on Tauri / Docker) and are fully editable by hand. Every Knowledge edit is recorded as a PROV-DM revision so you can always see **when** a page was generated, **which agent** (human or AI) wrote it, and **from which source**.

The Knowledge layer is **opt-in**: configure an LLM in **⚙ Settings → AI Setup** to activate it. Without an LLM, Graphium works as a plain linked-note editor.

## Composer (⌘K)

A single palette for finding what you've written and asking what's next. Hit `⌘K` (or `Ctrl+K`) anywhere in Graphium and start typing.

| Input | Result |
|-------|--------|
| Words from a title or heading | Jump straight to that note (Wiki entries are surfaced too) |
| `#label` | Filter by context label — `#procedure`, `#step`, `#手順` all map to the same thing |
| `@author` | Filter by who wrote it — humans by username, AI by model name |
| Empty | Recent notes plus *discovery cards* — quick prompts derived from your active note and the last week of Wiki activity (ingest / cross-update / regenerate / merge) |
| `Cmd+Enter` | Send the input to the AI assistant instead of jumping |

The Composer is the entry point that ties the editor, the AI Knowledge Layer, and your own past work into one motion.

## Templates

The `/template` slash command opens a picker with reusable scaffolds:

- **Plan template** — H1 title, Background / Goals, a reference table (Item × Conditions), and Expected Outcomes. Each row of the table becomes a child note when you derive it.
- **Run template** — a per-item record where blocks are pre-labeled (`[Step]` for activities; inline `[Input]` / `[Tool]` / `[Parameter]` / `[Output]` for entities) and consecutive steps are pre-linked with `informed_by`. Use it as a working example of "what a fully labeled note looks like."

The vocabulary is generic: it fits lab experiments, cooking, manufacturing runs, or any project workflow. User-defined templates can be registered programmatically (`registerUserTemplate()`).

## Reading comfort

Some people read more comfortably with letterforms designed for dyslexia. Graphium ships with **[Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/)** and **[Lexend](https://www.lexend.com/)** as built-in choices alongside Inter, switchable from **⚙ Settings → General**. Pick what works for your eyes — the rest of the editor stays the same.

## Interoperability

Graphium exports provenance as **[PROV-JSON-LD](https://www.w3.org/submissions/2024/SUBM-prov-jsonld-20240825/)** — a W3C standard built on Linked Data. This is not a proprietary format: any tool that understands PROV-DM or JSON-LD can consume Graphium's output. Provenance data is portable by design.

## How to use

### Option 1: Use online (no setup)

Visit **https://kumagallium.github.io/Graphium/** and start writing. Your notes are saved in your browser's IndexedDB.

> **Want the same notes on multiple machines?** Use the [desktop app](#desktop-app) and point its save folder at a Google Drive / iCloud / Dropbox synced folder.

### Option 2: Run with Docker — editor only

Run Graphium as a standalone editor — no AI, no external services. Just the note editor.

```bash
git clone https://github.com/kumagallium/Graphium.git
cd Graphium
docker compose -f docker-compose.standalone.yml up -d
```

Open **http://localhost:5174/Graphium/** and start writing.

### Option 3: Run with Docker — with the AI backend

Run Graphium with the built-in AI backend. The AI assistant, the Knowledge Layer, and direct MCP server connections all work on their own — no external services required.

```bash
git clone https://github.com/kumagallium/Graphium.git
cd Graphium
docker compose up -d
```

| URL | What it is |
|-----|------------|
| http://localhost:5174/Graphium/ | Graphium editor (includes AI setup) |

> **Advanced:** this compose file also bundles an optional [Crucible Registry](https://github.com/kumagallium/Crucible) ([UI](http://localhost:8081)) for managing many MCP servers in one place. It is not required — see *Add MCP tools* below.

#### Set up your AI model

1. Open **http://localhost:5174/Graphium/**
2. Go to **⚙ Settings → AI Setup**, add your LLM model and API key
3. Start using the AI assistant

#### Add MCP tools (optional)

Graphium connects to MCP servers directly — no registry required. Open **⚙ Settings → AI Setup → MCP Servers** and add a source. Everything lives in one list, where each entry can be toggled on/off, edited, or removed:

- **Local** — Graphium launches and manages the server for you, the same way Claude Desktop does. Enter a command and arguments (e.g. `npx` / `-y @modelcontextprotocol/server-filesystem ~/notes`) and Graphium spawns it over stdio; you never start or stop a process yourself. Requires the desktop app or a self-hosted backend (a browser can't launch local processes).
- **Remote** — connect to an already-running server by its endpoint URL (e.g. `http://localhost:8100/sse`), optionally with an API key.
- **From registry** — enter a [Crucible Registry](https://github.com/kumagallium/Crucible) URL, fetch its list of MCP servers, and pick the ones you want — each becomes its own Remote entry. The registry URL is remembered so you can re-browse later. Optional; Crucible is just a discovery source, not a dependency.

The fastest way to add a server is **Paste JSON**: copy the `mcpServers` block straight from a server's README (the Claude Desktop / Cursor format) and Graphium imports it — local (`command`/`args`/`env`) and remote (`url`/`type`/`headers`) entries, one or many at a time.

No `.env` editing required — everything is configured from the browser.

> **Self-hosting and storage**
> When running under Docker (or any self-hosted Node.js backend), notes are saved to the server filesystem at `/app/data` by default — visit the same URL from any browser or device and you see the same notes. The frontend auto-detects this on first load.
> - **Cloud backup**: mount a Google Drive / iCloud / Dropbox synced folder to `/app/data` (`volumes: - "~/Google Drive/Graphium:/app/data"`) and the OS handles replication.
> - **Remote VPS**: use [rclone](https://rclone.org/) or similar to back up `/app/data` to S3 / B2 / etc.
> - **Authentication**: set `GRAPHIUM_AUTH_TOKEN=<your-secret>` to require an `X-Graphium-Token` header on all storage requests. Configure the same token in **⚙ Settings → Server Storage** in the UI. Without this, anyone who can reach the URL can read/write notes — fine on `localhost`, not for public deployments.

> **Note:** In Docker mode, all services run without API key authentication and are only accessible from your local machine (`localhost`).

#### Updating to the latest version

```bash
./update.sh
```

Or manually:

```bash
git pull                      # Get latest Graphium code
docker compose pull           # Pull latest backend images
docker compose up -d --build  # Rebuild Graphium and restart all services
```

### Option 4: Run for development

```bash
git clone https://github.com/kumagallium/Graphium.git
cd Graphium
pnpm install
pnpm dev --port 5174   # → http://localhost:5174/Graphium/
```

Notes are saved to your browser's IndexedDB by default. AI features require the backend server — run `pnpm dev` which starts both the frontend and backend together. Go to **⚙ Settings → AI Setup** to add your LLM model.

## Features

- **Block-level context labels** — `[Step]` (PROV *Activity*), plus `[Plan]` / `[Result]` for phases
- **Inline entity highlights** — highlight spans inside a block as `[Input]` / `[Tool]` / `[Parameter]` / `[Output]`. The first three become PROV-DM *Entity* nodes (with `material` / `tool` subtypes internally), and `[Parameter]` attaches as a *Property* on the parent. Identical referents share an `entityId` so they collapse into one node in the graph
- **Media inline labels** — image / video / audio / PDF blocks can carry the same `[Input]` / `[Tool]` / `[Parameter]` / `[Output]` labels via a side-store (BlockNote inline styles don't apply to media)
- **Block-to-block linking** with provenance semantics (`informed_by`, `derived_from`, `used`)
- **Multi-page tabbed editor** with scope derivation
- **Reference table** — manage related notes in a tabular view with side-peek preview
- **PROV-JSON-LD export** — W3C-compliant per-page provenance export
- **Provenance graph** visualization (Cytoscape.js + ELK layout)
- **Inter-note network graph** (Cytoscape.js + fcose layout)
- **AI assistant** — derive notes from AI responses with full provenance metadata
- **AI auto-labeling** — AI answers are inserted with PROV-DM context labels and `informed_by` chains already attached
- **Knowledge layer** — editable AI-curated layer with four document kinds (*Summaries* / *Claims* / *Insights* / *Ideas*), a pipeline (ingest → atomize → cross-update → lint) with edit protection on re-ingest. Ideas are authored through the Cmd-K Composer flow
- **Composer (⌘K)** — unified palette for note search (`#label` / `@author` filters), discovery cards, and AI ask
- **Skills** — reusable prompt templates stored as Graphium documents (`source: "skill"`); apply during ingest or chat
- **Sharing & Library** — share a note to a content-addressed shared store; others can browse the Library and Fork. Embedded media is materialized as `shared-blob:` references on share
- **Templates** — `/template` slash command with Plan and Run scaffolds (extensible)
- **Reading-font setting** — pick between Inter (default), Atkinson Hyperlegible Next, and Lexend; opt-in for dyslexia-aware reading
- **Local-first storage** — plain JSON files on your filesystem (desktop / Docker) or IndexedDB (browser)
- **Desktop app** — Tauri v2 native app with local file storage; point the save folder at a synced cloud folder (Drive / iCloud / Dropbox) for cross-device sync without OAuth

### Screenshots

<table>
  <tr>
    <td colspan="2"><b>Editor with context labels and the provenance graph that builds up as you write</b></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/editor-with-graph_en.png" alt="Editor with the provenance graph generated from a bread-making note" width="820" /></td>
  </tr>
  <tr>
    <td><b>Document provenance history</b></td>
    <td><b>Note network graph</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/history.png" alt="Document provenance" width="400" /></td>
    <td><img src="docs/screenshots/network-graph.png" alt="Note network graph" width="400" /></td>
  </tr>
</table>

## PROV-DM compliance

Graphium implements a **two-layer provenance model**, both conforming to the [W3C PROV Data Model (PROV-DM)](https://www.w3.org/TR/prov-dm/).

### Layer 1: World provenance — what the note is about

Labels attach to content in two independent passes that compose into one PROV-DM graph:

#### Block-level — the skeleton

A heading block can be tagged via the `#` menu:

| UI label | Internal key | PROV-DM type | Description |
|----------|--------------|--------------|-------------|
| `[Step]` | `procedure` | `prov:Activity` | A step in a process. H2 boundaries also create implicit Activities via the heading `scopeStack`. |
| `[Plan]` | `plan` | grouping | Phase: planning portion of a process. |
| `[Result]` | `result` | grouping | Phase: result portion of a process. |

#### Inline highlights — the detail

Spans inside a block can be highlighted as one of:

| UI label | Internal key | PROV-DM mapping |
|----------|--------------|-----------------|
| `[Input]` | `material` | `prov:Entity` with `material` subtype (substance / input transformed in a process) |
| `[Tool]` | `tool` | `prov:Entity` with `tool` subtype (equipment / instrument) |
| `[Parameter]` | `attribute` | A *Property* attached to the parent Activity or Entity (condition / setting) |
| `[Output]` | `output` | `prov:Entity` (artifact the activity generated) |

Highlights inside the same block can carry the same `entityId`, in which case they collapse to one PROV Entity node — the deduplication key for repeated references to the same referent. Image / video / audio / PDF blocks carry the same labels via a `mediaInlineLabels` side-store, since BlockNote inline styles don't apply to media.

Relationships emitted: `prov:used` (Usage), `prov:wasGeneratedBy` (Generation), `prov:wasInformedBy` (via prior-step links).

The two passes are independent. A note can have only block-level labels, only inline highlights, both, or neither — and you only get the parts of the graph you've labeled.

### Layer 2: Document Provenance — edit history

Every save creates a revision chain tracked as PROV-DM:

| Concept | PROV-DM mapping |
|---------|----------------|
| Editor (human or AI) | `prov:Agent` |
| Edit operation | `prov:Activity` with `startTime` / `endTime` |
| Document revision | `prov:Entity` with `prov:generatedAtTime` |
| Editor → edit | `prov:Association` |
| Edit → revision | `prov:Generation` |
| Revision → previous | `prov:Derivation` |

Document provenance is exported as a `prov:Bundle`, separate from content provenance.

### PROV-JSON-LD export

The per-page export conforms to the [W3C PROV-JSON-LD specification](https://www.w3.org/submissions/2024/SUBM-prov-jsonld-20240825/):

- Uses the [openprovenance context](https://openprovenance.org/prov-jsonld/context.jsonld)
- Unprefixed `@type` values (`Entity`, `Activity`, `Agent`)
- Relationships as separate objects (`Usage`, `Generation`, `Derivation`, `Association`)
- Standard property names (`startTime`, `endTime`, `entity`, `activity`, `agent`)

Graphium-specific extensions use the `graphium:` namespace (`https://graphium.app/ns#`), including `graphium:entityType`, `graphium:attributes`, `graphium:editType`, `graphium:summary`, and `graphium:contentHash`.

## Architecture (at a glance)

Graphium is a TypeScript / React app on top of [BlockNote.js](https://www.blocknotejs.org/), shipped three ways: as a web PWA (notes in IndexedDB), as a [Tauri v2](https://tauri.app/) desktop app (notes as JSON files on the filesystem), and as a [Docker](https://www.docker.com/) self-host with a Node.js companion server. The companion server is built on [Hono](https://hono.dev/) and runs the Knowledge layer pipeline (ingest → atomize → synthesize → cross-update → lint).

| Component | Technology |
|-----------|------------|
| Editor | TypeScript / React / BlockNote.js |
| AI runtime | Vercel AI SDK |
| Default LLM | `gpt-oss-120b` via [Sakura AI Engine](https://platform.sakura.ad.jp/ai-engine) (OpenAI-compatible) |
| Opt-in LLMs | Anthropic Claude / OpenAI / Google / any OpenAI-compatible endpoint |
| Companion server | Node.js / Hono |
| Storage | IndexedDB (web) / filesystem (Tauri / Docker) |
| Desktop | Tauri v2 (macOS Apple Silicon + Windows x64; Linux / Intel macOS on roadmap) |
| Graph visualization | Cytoscape.js |
| Build / pkg manager | Vite / pnpm |

For the layered breakdown, the Wiki pipeline trigger flow, distribution targets, the auth model, and known seams, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For on-disk JSON shapes and compatibility rules, read [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

### MCP tools

The AI assistant can call [MCP](https://modelcontextprotocol.io/) tools. Manage them all in one list under **⚙ Settings → AI Setup → MCP Servers**. Add a **Local** server (launched by Graphium over stdio, the Claude Desktop model; needs the desktop app or a self-hosted backend) or a **Remote** one (reached by URL) — by pasting its README JSON, filling the form, or browsing a [Crucible Registry](https://github.com/kumagallium/Crucible) and picking servers from it. Crucible is just a discovery source, not a dependency.

## Beyond the editor

Graphium notes don't have to be written inside Graphium. The bundled [`save-to-graphium`](scripts/claude-code-skill/save-to-graphium/SKILL.md) skill lets [Claude Code](https://claude.com/claude-code) (CLI or VS Code extension) save the gist of any conversation as a Graphium note. The note carries `agent: "claude-code"`, the model name, and the OS user as PROV-DM agent metadata, so AI-driven discussions get the same provenance trail as anything you wrote by hand.

```bash
ln -s "$(pwd)/scripts/claude-code-skill/save-to-graphium" ~/.claude/skills/save-to-graphium
```

After the symlink is in place, just ask Claude Code "save this to Graphium" — the note appears in your sidebar on next launch, ready to be linked, labeled, or pushed into the Knowledge Layer.

## Language & Internationalization

Graphium supports **English** (default) and **Japanese**. The language can be switched from **⚙ Settings** in the sidebar.

All user-facing text — context labels, menus, tooltips, and panel UI — is fully internationalized. Context labels are displayed in the active locale (e.g. `[Step]` in English, `[ステップ]` in Japanese) while the internal data format remains stable for backward compatibility.

| Element | Status |
|---------|--------|
| Context labels | Fully localized (English / Japanese) |
| UI chrome | Fully localized |
| Label input | Both languages accepted as aliases (e.g. `[step]`, `[材料]`) |
| README / docs | English / Japanese |

Contributions for additional languages are welcome.

## Development

```bash
pnpm install        # Install dependencies
pnpm dev            # Start frontend + backend dev server
pnpm dev:client     # Start frontend only
pnpm dev:server     # Start backend only
pnpm test           # Run tests (vitest)
pnpm storybook      # Component catalog (http://localhost:6006)
pnpm build          # Production build (frontend)
```

### Knowledge Layer benchmark (`pnpm bench:*`)

The Wiki pipeline (ingest → atomize → synthesize) is regression-tested by an
empirical benchmark under `bench/`. The corpus, ground-truth, and probes are
checked in; each phase of the discovery-mode roadmap declares which metrics it
must improve, and merges are gated on the delta.

```bash
pnpm bench:run                     # Run the benchmark, write bench/baseline.json
pnpm bench:report                  # Render bench/baseline.json as a Markdown table
pnpm bench:compare main            # Diff metrics against main's baseline.json
```

| Env var | Default | Purpose |
|---|---|---|
| `BENCH_API_KEY` / `SAKURA_AI_API_KEY` | `""` | API key for the bench LLM (production default: gpt-oss-120b on Sakura AI Engine). When unset the runner falls back to **dry-run** mode that uses deterministic heuristics — fine for CI smoke tests, but real merge decisions need live mode. |
| `BENCH_MODEL_ID` | `gpt-oss-120b` | Override the bench model. |
| `BENCH_API_BASE` | `https://api.ai.sakura.ad.jp/v1` | Override the API endpoint (any OpenAI-compatible endpoint works). |
| `BENCH_PROFILE` | `baseline` | Profile name written into the output (`baseline`, `with-alpha`, etc.). |
| `BENCH_MODE` | auto | Force `live` or `dry-run` regardless of API-key detection. |
| `BENCH_N` | 3 in live, 1 in dry-run | Independent samples per run. Median per metric is reported as the headline; per-sample distribution is kept in `aggregate.distribution` and `runs[]` so PRs can show the noise floor. |

Metric definitions, corpus structure, probe list, and CI integration are
documented in [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Project structure

The tree below is a curated view of the most-touched directories. For
the full source map (where every feature lives, and which file to look
at first when you want to change something), see
[ARCHITECTURE.md §8](docs/ARCHITECTURE.md#8-source-map).

```
src/
├── base/              # Editor core (BlockNote wrapper, multi-page)
├── features/
│   ├── context-label/ # PROV-DM context labels for blocks
│   ├── block-link/    # Block-to-block provenance links
│   ├── prov-generator/# PROV-JSON-LD generation & graph visualization
│   ├── prov-export/   # W3C PROV-JSON-LD file export
│   ├── index-table/   # Index table for related notes
│   ├── network-graph/ # Inter-note derivation network (Cytoscape + fcose)
│   ├── ai-assistant/  # AI chat & note derivation, marker-based auto-labeling
│   ├── composer/      # ⌘K palette: note search + discovery cards + AI ask
│   ├── template/      # /template slash command (Plan / Run)
│   ├── wiki/          # Knowledge layer (Summaries / Claims / Insights / Ideas)
│   ├── settings/      # Settings modal (General + AI Setup + reading font)
│   └── release-notes/ # Release notes display
├── server/            # Built-in AI backend (Hono + Vercel AI SDK)
│   ├── routes/        # API endpoints (/api/agent, /api/models, etc.)
│   ├── services/      # LLM, MCP, Registry, agent loop
│   └── config/        # Model & profile persistence (JSON files)
├── lib/               # Utilities (Google Auth, Drive API, Cytoscape setup)
└── blocks/            # Custom BlockNote blocks
```

## License

[Apache License 2.0](LICENSE)
