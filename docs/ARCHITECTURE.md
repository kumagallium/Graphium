# Graphium — Architecture

This document maps the moving parts: how the editor, the provenance layer,
the AI Knowledge Layer, and the storage layer fit together, and where to
find each of them in the source tree. It is written for contributors and
for anyone who wants to know the shape of the system before reading code.

For the *why*, see [CONCEPT.md](./CONCEPT.md).
For the on-disk file formats, see [DATA_MODEL.md](./DATA_MODEL.md).

---

## 1. At a glance

Graphium is a TypeScript single-page app built on top of
[BlockNote.js](https://www.blocknotejs.org/), shipped as three
distributions that share the same source tree:

- **Web (PWA).** Runs entirely in the browser. Notes live in IndexedDB.
- **Desktop (Tauri v2).** Wraps the web app with a Rust shell so notes
  live as JSON files on the user's filesystem.
- **Self-hosted (Docker).** Runs the same web app plus a Node.js
  companion server that handles AI features (LLM proxy, embedding,
  ingest pipeline).

The companion server (`src/server/`) is built on
[Hono](https://hono.dev/) — a small, web-standard request/response
framework. Hono was chosen over Express because the same app can be
served from `@hono/node-server` (Tauri sidecar / Docker) or, in
principle, from edge runtimes; it is also lighter and better-typed. An
adapter for Vercel Serverless exists in the code (`api/[[...route]].ts`)
but Vercel is not an actively maintained deploy target today.

The server is required for the Knowledge Layer (ingest, embed, chat) and
optional for the editor itself; the editor works without it.

## 2. Layered view

```mermaid
flowchart TB
    subgraph UI["UI layer"]
        E["Block editor<br/><i>BlockNote.js + Graphium blocks</i>"]
        N["Navigation<br/><i>note list, Knowledge nav, search</i>"]
        AI["AI Assistant<br/><i>chat, ask, compose</i>"]
    end

    subgraph FEAT["Feature layer (src/features/)"]
        CL["context-label<br/>(# step / phase)"]
        IL["inline-label<br/>(entity / agent inline)"]
        PG["prov-generator<br/>(blocks → PROV-DM graph)"]
        DP["document-provenance<br/>(per-note edit history)"]
        WIKI["wiki<br/>(Knowledge UI + service)"]
        SH["sharing<br/>(Library / Fork)"]
    end

    subgraph CORE["Core (src/lib/)"]
        DT["document-types.ts<br/><i>GraphiumDocument schema</i>"]
        ST["storage/<br/><i>StorageProvider abstraction</i>"]
        IDX["features/navigation/index-file.ts<br/><i>NoteIndex / WikiIndex</i>"]
    end

    subgraph SRV["Optional Node server (src/server/)"]
        WI["wiki-ingester / atomizer /<br/>cross-updater / linter"]
        EMB["embedding service"]
        LLM["llm proxy (Anthropic / OpenAI / local)"]
    end

    subgraph PROV["Storage providers"]
        L["local<br/>(IndexedDB)"]
        F["filesystem<br/>(Tauri / OPFS)"]
        S["server-fs<br/>(Docker)"]
    end

    UI --> FEAT
    FEAT --> CORE
    CORE --> PROV
    AI --> SRV
    WIKI --> SRV
    SRV --> EMB
    SRV --> LLM
```

Reading top to bottom: UI talks to feature modules, which read and write
through `src/lib/document-types.ts` and the `StorageProvider` abstraction.
AI features (Knowledge ingest, chat) talk to the Node server. The Node server
talks to LLM and embedding backends.

## 3. The four layers in detail

### 3.1 Editor layer (BlockNote + Graphium blocks)

- BlockNote.js gives Graphium its block model, slash menu, and rich-text
  rendering.
- Custom blocks live under `src/blocks/` (today: `bookmark`,
  `callout`, `example-hello`, `pdf-viewer`, `step`). Inline content (entity /
  agent highlights) lives under `src/features/inline-label/`.
- `step` is the one container block: it holds child blocks, and a procedure is
  written by putting its content inside a step rather than by labelling a
  heading. Nesting and reordering use BlockNote's own drag handle. The card's
  header carries a predecessor control that sets `informed_by` links between
  steps — ordering is a first-class property of a procedure, so it lives on
  the card rather than in a side panel.
- Every custom block must be registered in `src/blocks/registry.ts` so both
  the main editor and the SidePeek pick it up. The registry derives
  `KNOWN_BLOCK_TYPES`, and blocks outside that set are stripped on load and
  then auto-saved — an unregistered block is data loss, and a container takes
  its children with it.
- Features that annotate a *standard* block do not add a block type. They
  keep a side store keyed by block id (`mediaInlineLabels`, `blockAlignments`,
  `mediaOcr`), because extending BlockNote's own image / file blocks is
  far-reaching — and because the user should not have to choose a special
  block up front to get the behaviour later.
- Editor configuration is composed in `src/note-app.tsx`.

### 3.2 Provenance layer (PROV-DM)

Two distinct concerns share the word *provenance* in this codebase. They
are kept separate on purpose:

| Subsystem | Concern | Lives in |
|---|---|---|
| **World provenance** (`prov-generator`) | Provenance of *the things the note describes* — experiments, sources, decisions. Output: a PROV-DM graph. | `src/features/prov-generator/` |
| **Document provenance** (`document-provenance`) | Provenance of *the note itself* — who edited what, when, with which agent (*human* / *ai*). Output: an edit log. | `src/features/document-provenance/` |

If you read code that mentions "provenance," check which of these two is
meant. There is no shared abstraction between them today.

#### Labels feeding the world-provenance graph

Labels come in two passes that operate on the same blocks:

0. **The `step` container block.** A procedure is written as a `step` block,
   whose children are its content. The block *is* the PROV-DM *Activity* —
   it carries no label, and its title comes from the block's own inline
   content. This is the only way a procedure exists: notes written with the
   old heading-plus-label style are converted to `step` blocks on load by
   the v6 document migration (DATA_MODEL §2.1), preserving block ids so the
   generated graph is unchanged.
1. **Block-level (context labels).** The only block labels are entity
   markers on tables and media, applied from the drag-handle menu and
   offered **only inside a step** (an entity outside any step would have no
   Activity to bind to). The `#` affordance is gone entirely (free-form
   tags went with it; existing tags remain inert data). A **table
   block** may be tagged `[Input]` / `[Tool]` / `[Output]` to mark
   it as a *structured table* (header row = attribute keys, each data row =
   one Entity), or `[Parameter]` to mark it as a *parameter table* (header
   row = keys, first data row = values) whose `key=value` pairs are merged
   into the enclosing Step's `params` (see [DATA_MODEL.md §2.3](./DATA_MODEL.md)).
   Implemented in `src/features/context-label/`.
2. **Inline labels.** Highlights spans inside block text as `[Input]` /
   `[Tool]` / `[Parameter]` / `[Output]` (internal keys `material` /
   `tool` / `attribute` / `output`). Offered **only inside a step**, for
   the same reason as block labels; existing highlights elsewhere stay
   visible and removable. The first three feed PROV-DM
   *Entity* nodes (with `material` / `tool` subtypes); `[Parameter]`
   becomes a *Property* on the parent Activity or Entity. Inline labels do
   not apply inside table cells (cells are atomic values — use a
   structured-table block label instead). Implemented in
   `src/features/inline-label/`.

The two passes are independent: a note can have only block-level labels,
only inline labels, both, or neither. The PROV generator merges both
sources when building the graph.

The generator (`src/features/prov-generator/generator.ts`) resolves
*Activity* containment two ways, so users never state which Entity belongs
to which Activity:

- **`step` containers.** A pre-pass walks the block tree and binds every
  descendant of a `step` to that step's Activity. The innermost enclosing
  step wins, so nested steps behave as expected.
- **Headings.** A `scopeStack` infers containment from heading structure
  for blocks that are not inside any step.

The two never overlap: headings inside a step are ordinary subheadings and
create no Activity of their own, which keeps a block from being bound twice.

`[Plan]` / `[Result]` phases were withdrawn (plan-vs-actual comparison
pays off across runs of a protocol, which note-level splitting via
`partOfPlanNoteId` covers), and the v6 migration strips any remaining
phase labels on load — so loaded documents never carry a phase and new
graphs contain no `graphium:phase` metadata. See DATA_MODEL §2.3 for the
historical semantics that pre-v6 exports may still contain.

Beyond labelled blocks, the generator also picks up **images whose text has
been read on-device**, with no label required. The user triggers this from
the image block's drag-handle menu ("Read text from image"); Tesseract.js
runs entirely in the browser (only the wasm and language data come from a
CDN — the image itself is never uploaded) and the result is stored in
`page.mediaOcr[blockId]`. Each such image is projected as image
`prov:Entity` → OCR `prov:Activity` (`prov:used`) → extracted-text
`prov:Entity` (`prov:wasGeneratedBy`), with engine, language and confidence
attached as `graphium:*` attributes on the Activity. If the image already
carries an inline label, that Entity is reused instead of emitting a second
node for the same picture. This is the one world-provenance source that
needs no user tagging — see [DATA_MODEL.md §2.3](./DATA_MODEL.md). The
`image_` / `activity_ocr_` / `result_ocr_` id prefixes reuse the existing
node-subtype colouring, so the view renders them without change.

The extracted text is also mirrored into the note index (`ocrText`), so a
note holding only a screenshot can be found by the words inside it; the note
list marks such a hit with an "image text" badge, and the asset gallery shows
the text on the image's detail panel.

#### Wiki Knowledge Layer in the PROV-JSON-LD export

Export is a **per-note** action (it lives in the note's overflow menu),
so the bundle is scoped to that note: the note's own content-provenance
graph and edit-log, plus the Wiki Knowledge Layer entities **directly
derived from that note** (the Claims/Summaries whose `derivedFromNotes`
includes the note id, resolved via the always-loaded note index in
`features/prov-export/note-scope.ts`). Cross-note abstractions (Insights
/ Ideas, which derive from Claims across many notes) are intentionally
not pulled into a single note's export — otherwise the same Insight
would appear in every source note's bundle. A whole-workspace
provenance export, if needed, is a separate workspace-level action.

Each in-scope Wiki entity is added as an `Entity` node with a
`prov:wasAttributedTo` edge to the generating AI agent, plus a
`prov:wasDerivedFrom` edge for every recorded upstream source. Four
lineage lanes are emitted as derivations: `derivedFromNotes` (source
notes), `citedKnowledgeIds` (knowledge cited/examined via the Cmd-K
verb intake), `derivedFromClaims` (the Claims an Insight abstracts —
the *atomize* lane), and `derivedFromChats` (chat-derived sources; in
practice chat ingestion currently records a `chat:`-prefixed id in
`derivedFromNotes`, so this lane is usually empty but kept for contract
completeness). A Wiki entity with no recorded sources is emitted with
only the attribution edge.

These derivations are a *current-value snapshot* — they say where the
entity's knowledge comes from, not how it grew. The growth history is
exported separately: each in-scope Wiki entity whose document is loaded
also carries its own edit-log as a named `prov:Bundle`
(`graphium:documentProvenance/wiki/<wiki file id>` — keyed by the
internal id, not the title, because titles are not unique — referenced
from the entity via `graphium:provenanceBundle` as a node reference).
Node ids inside every bundle (revisions, activities, agents) are
prefixed with the bundle's `@id`, because the tracker numbers them
per-document (`rev_001`, `edit_001`, …) and unprefixed ids from
different bundles would merge into one node when the export is
flattened. Each Wiki entity also carries its internal id as
`graphium:noteId`, so `graphium:note/<id>` stubs referenced from
another wiki's growth bundle (e.g. the absorbed side of a dedup merge)
can be joined back to the entity. The bundle contains the revision
chain (`prov:wasDerivedFrom` between revisions, hash chain), one typed
`Activity` per operation (`graphium:editType`: `wiki_ingest` /
`wiki_merge` / `wiki_cross_update` / `wiki_dedup_merge` /
`wiki_regenerate` / `wiki_atomize` — see
[DATA_MODEL.md §2.4](./DATA_MODEL.md#24-document-provenance-edit-log)),
and a `Usage` edge per ingested source (`prov:used`), so external PROV
tools can reconstruct *when, by which operation, and from which sources*
each Knowledge entry grew. Per-block content diffs are stripped from
these bundles (they stay in the wiki file itself); only the growth
lineage is exported.

Every node referenced by these relations is also **declared** so the
export contains no dangling references: the AI agent is emitted as a
typed `prov:Agent` node (deduplicated per model), and each source id is
emitted as a typed `Entity` node. Source ids carrying an external-source
prefix (`pdf:` / `url:` / `document:` / `chat:` / `memo:`, see
[`network-graph/external-source.ts`](../src/features/network-graph/external-source.ts))
are resolved to a typed external-source Entity (`@id`
`graphium:<kind>/<key>`, with `graphium:sourceKind`) rather than being
concatenated into a malformed `graphium:note/<prefixed>` reference — so
the export stays consistent with the in-app lineage/graph views.

The document edit-log is attached as a named `prov:Bundle`. The
`@context` inlines the PROV term definitions locally (with the
openprovenance `prov-jsonld` context kept as the authoritative
resolver), so relation typing does not depend solely on a remote fetch.

Each Wiki entity carries the *semantic types* from §3.3 so that external
PROV tools can see the hourglass structure of the knowledge layer.
(Besides the semantic types below, every Wiki entity always carries the
housekeeping attributes `graphium:wikiStatus`, `graphium:generatedAt`,
and `graphium:generatedBy`.)

| Attribute (`graphium:*`) | Meaning | Present when |
|---|---|---|
| `wikiKind` | `summary` / `claim` / `atom` / `synthesis` | always |
| `claimRole` | research-process role(s) of the Claim | `wikiKind = claim` |
| `claimLevel` | abstraction level (`principle` / `finding` / `bridge`) | `wikiKind = claim` |
| `procedureContext` | reproducibility scaffold (parameters, tools, validity range) | `wikiKind = claim` (procedure-bearing Claims only) |
| `atomType` | inferential character of the Insight (causal / mechanistic / observational / …) | `wikiKind = atom` |
| `synthesisMode` | reasoning mode of the Idea (deductive / abductive / analogical / dialectic) | `wikiKind = synthesis` |
| `hypothesisStatus` | verification status (speculative / tested / confirmed / refuted) | `wikiKind = synthesis` |
| `confidence` | self-rated confidence at generation (0.0–1.0) | optional |

This export contract is the closest external observers get to the
hourglass: the source note's PROV graph plus the Wiki entities derived
from it, with semantic types attached so the data is interpretable
without Graphium's internal vocabulary.

#### URL / PDF → PROV ingestion (the *prov-ingester*)

A complementary pipeline runs in the other direction: external papers /
recipes / lab protocols come *in* as a URL or PDF and are turned into a
draft note with PROV labels already on it. The pipeline is intentionally
small.

| Step | File | What it does |
|---|---|---|
| Fetch | `src/server/services/url-fetcher.ts` | Downloads a URL, extracts plain text (HTML / readable subset) |
| Prompt | `src/server/services/prov-ingester.ts` | Single open-set prompt for any procedural domain (cooking / lab / manufacturing / ML / …) — builds the system + user prompt for the LLM |
| Parse | same module | Validates the LLM JSON and strips invalid spans / roles |
| Translate | `src/features/url-to-prov/prov-note-builder.ts` | Lifts the parsed output into a `GraphiumDocument` with labels / inline highlights / `provLinks` already attached |

The prompt asks the LLM to emit *prose with inline-highlighted spans*
(Phase F format, 2026-05): paragraphs whose `content` is a list of spans,
where role-bearing spans (`material` / `tool` / `attribute` / `output`)
get inline highlights and plain narrative spans carry the connectors.
The vocabulary is open — there is no fixed list of allowed parameter
names. The prompt only enforces a few lightweight conventions
(`<key>: <value>` attribute spans, `snake_case` keys, "same concept →
same key inside one document").

When the LLM returns multiple procedures from one source (e.g., a paper
with several composition variants), `plan-execution-builder.ts` splits
the output into a **plan note** that groups them plus N **execution
notes** that each carry the actual PROV graph. The execution notes
back-reference the plan via `partOfPlanNoteId`
([DATA_MODEL.md §2](./DATA_MODEL.md#2-the-note-graphiumdocument)). The
current prompt returns one `ProvIngesterOutput` per call so the builder
typically runs with N = 1; the infrastructure is ready for a future
`procedureGroup` extension that returns multiple outputs at once.

Quality is tracked by a benchmark harness at
`tests/benchmark/material-science/`. It loads `(input.txt, gold.json)`
fixture pairs (gold is in MatPROV PROV-DM JSON-LD format), normalizes
both predicted spans and gold `@graph` items into five comparable sets
(Activities / Materials / Tools / Edges / Parameters), and reports
normalized exact-match precision / recall / F1 plus a token-F1
sub-metric. Parameter keys are normalized through a synonym map
(`temperature` ⇔ `temp` ⇔ `T`, `duration` ⇔ `time` ⇔ …) so open-set
output stays comparable to MatPROV-style canonical keys. The first
runner is the さくら AI engine OpenAI-compatible API. Run with
`pnpm test:benchmark`.

#### PDF → translated note (the *pdf-translator*)

A separate, simpler PDF path produces a **faithful full translation** of a
PDF into the UI display language, keeping the original structure — this is
*not* a summary and *not* the PROV/Knowledge re-structuring above. It is a
straight document translation.

| Step | File | What it does |
|---|---|---|
| Extract text | `src/features/wiki/pdf-text-extractor.ts` (`extractPdfPages`) | Client-side pdfjs extraction, returned **per page** (the unit of translation and figure placement) |
| Extract figures | `src/features/asset-browser/pdf-image-extractor.ts` (`extractEmbeddedPdfImages`) | Pulls embedded raster images grouped by page number, skipping decorative fragments (arrows, rules — by on-page display area) and information-free solid-color patches (panel backgrounds — by content); uploaded as media derived from the source PDF |
| Glossary | `POST /api/translate/glossary` | One pass over a text sample extracts key domain terms + target-language translations, so parallel page translations stay consistent |
| Translate | `src/server/services/translate.ts` + `POST /api/translate` | Per-page prompt (glossary injected): reconstruct structure from the flattened text, translate prose into the target language, keep math / code / citations / references verbatim, output Markdown |
| Build | `src/features/pdf-translate/translate-service.ts` | Per page: Markdown → BlockNote blocks (`tryParseMarkdownToBlocks`) followed by that page's figure blocks; assembles a `GraphiumDocument` linked to the source PDF |

Pages are translated **in parallel** (bounded concurrency) and reassembled
in page order; each page's extracted figures are inserted right after its
translated text. The note is saved via the normal
`handleCreateNoteFromDocument` path (recorded as an AI derivation). Known
limits: math-heavy / multi-column papers degrade because pdfjs flattens
their layout; figure placement is page-granular (end of each page, not at
the exact caption); and very long PDFs are truncated at a character cap.

### 3.3 Knowledge layer

The Knowledge layer is a set of editable JSON documents that an LLM keeps
in sync with your notes. Each Knowledge document is a real
`GraphiumDocument` with `source: "ai"` set, so it opens in the same
editor. On disk the documents are still grouped under `data/wiki/` and the
TypeScript types use the historical `Wiki*` prefix (`WikiKind`,
`WikiMeta`) — UI labels and prose use "Knowledge / Claims / Insights /
Ideas" instead.

The pipeline (running on the Node server) has five stages:

| Stage | File | What it does |
|---|---|---|
| **Ingester** | `src/server/services/wiki-ingester.ts` | Reads new / changed notes, decides which Wiki pages to touch |
| **Atomizer** | `src/server/services/wiki-atomizer.ts` | Strips context, produces *Insight* pages with citations back to source notes |
| **Cross-updater** | `src/server/services/wiki-cross-updater.ts` | When one Wiki page changes, propagates to dependent pages |
| **Linter** | `src/server/services/wiki-linter.ts` | Detects orphan Insights, broken citations, redundant Claims |

Trigger flow (client-pushed, not server-polled):

```mermaid
sequenceDiagram
    participant E as Editor (note-app.tsx)
    participant W as wiki-service.ts (client)
    participant S as Server (Hono)
    participant I as Ingester
    participant A as Atomizer
    participant X as Cross-updater
    participant L as Linter
    participant FS as Wiki files (JSON)

    E->>W: note saved (worthy?)
    W->>W: wiki-worthy.ts gate
    W->>S: POST /api/wiki/ingest
    S->>I: run
    I->>FS: read existing wiki pages
    I->>A: hand off changed sections
    A->>FS: write Insight / Claim pages
    A->>X: notify changed pages
    X->>FS: propagate to dependents
    X->>L: schedule lint
    L->>FS: flag issues (no auto-fix)
    S-->>W: ingest result
    W-->>E: status (toast)
```

Notes:

- **Trigger:** the client pushes a save event into `wiki-service.ingestNote()`,
  which posts to the server. There is no server-side file watcher.
- **Worthiness gate:** `src/features/wiki/wiki-worthy.ts` decides whether a
  note is ingest-worthy at all (e.g., empty drafts are skipped).
- **Note mode vs document mode.** For a short personal note the ingester emits
  a Summary plus 0-3 Claims (the "1 note ≈ 1 idea" assumption). When the source
  is an **imported external document** — its `noteId` carries a `pdf:` /
  `document:` / `url:` / `chat:` prefix (the external-source convention) — the
  ingester switches to *document mode*: it harvests every distinct transferable
  insight the document argues as its own Claim, with no fixed cap, so a dense
  article is not collapsed into a single headline Claim. Memo-derived sources
  (`memo:` prefix) get a third mode, *memo mode*: a memo is a short captured
  fragment that usually carries exactly one spark, so the ingester is told to
  extract that one insight as a Claim even from a quote or anecdote (instead
  of falling back to Summary-only, which the conservative note-mode guidance
  tends to do on short fragments) — while still emitting zero Claims when the
  memo genuinely carries nothing transferable. Both switches are decided in
  `src/server/routes/wiki.ts` and change only the Claim guidance inside
  `buildIngesterSystemPrompt`.
- **Failure handling:** retries are not centralized today. Each stage
  surfaces its own errors back through the response. AI-setup and
  authentication failures additionally carry a machine-readable `code`
  field (see §6, "Error responses") that the client maps to a localized
  message; the client also pre-checks model registration before firing
  any AI request (`ensureAgentConfigured()` in `src/lib/ai-error.ts`),
  so an unconfigured install gets a settings prompt instead of a raw 400.
  On top of that runtime guard, the UI hides AI entry points altogether
  while no model is registered: the sidebar Knowledge section (unless
  existing wiki data remains, which stays browsable), the Skills entry,
  the chat tab, the ⌘K composer, editor AI buttons, and per-asset AI
  actions (ingest / procedure extraction / translation / "ask AI") all
  disappear until a model is added in Settings → AI (gated by
  `aiUiEnabled` in `src/note-app.tsx`).
- **Embeddings** (per Wiki section) are stored via
  `src/lib/embedding-store.ts` and used as the retrieval substrate for AI
  chat. The retriever is `src/features/wiki/retriever.ts`.
- **Auto-merge of redundant Claims.** When the linter / startup-merge
  flow detects two Claims that overlap, one is rewritten into the
  other and the absorbed Claim is **archived, not deleted**. Its file
  stays on disk and its index entry gains an `archivedAt` flag, so any
  note that cited it (or any Idea whose `derivedFromNotes` lists
  it) keeps resolving through `loadDoc`. The archived page is hidden
  from lists / search and is editable only after restore. See
  [DATA_MODEL.md §5.2](./DATA_MODEL.md#52-trash-and-archive-semantics)
  for the tri-state semantics.
- **Insights are structural abstractions, not tidied Claims.** A Claim is a
  domain finding; the Insight (Atom) is the *transferable structure* behind it,
  produced by the atomizer (`buildAtomizerSystemPrompt`) in four steps:
  **decompose** the relationship (control → outcome), **classify the shape** in
  two levels — first the **family** (the axis: `functional-dependence` /
  `structural` / `conditional` / `dynamic-feedback` / `other`), then the **form**
  (the leaf inside that family: `monotonic-increase` / `monotonic-decrease` /
  `optimal-middle` / `threshold` / `trade-off` under functional-dependence;
  `composition-structure` under structural; `enabling-condition` under
  conditional; `reinforcing-loop` / `balancing-loop` (feedback cycles) under
  dynamic-feedback; `other`) — **abstract** the roles to their general
  category while keeping the shape, and optionally name a **transfer** (a
  different field where the same shape + role-structure holds). The fixed shape
  vocabulary is the key: the LLM *classifies* into it rather than inventing an
  axis, which is what keeps the abstraction from going vacuous (the failure mode
  of the retired meta-atom layer). Picking the family before the form is what
  makes "pick exactly one" a clean partition — each form belongs to exactly one
  family (`SHAPE_FORM_TO_FAMILY`), so the family is derived deterministically from
  the form and any LLM family/form mismatch self-heals to the form. A single
  Claim that instances a real shape is enough; the source-Claim count is a support
  signal, not a gate. The `shape` (form), `shapeFamily`, and the verified
  `transfer` are stored on the Atom's `WikiMeta`.
- **Transfer judge — adversarial verification of the analogy.** The transfer the
  atomizer proposes is a *candidate*. The `/atomize` route runs a skeptical judge
  (`buildTransferJudgeSystemPrompt`) asking whether the example genuinely
  instances the same shape + role-structure or is only topically similar; forced
  ("こじつけ") transfers are dropped while the principle itself is always kept. On
  a 24-Claim check this kept ~88% of transfers and correctly dropped the rest;
  the principle stays valid even when its transfer is discarded.
- **Fold judge — adversarial verification of the co-structure.** When an Atom
  folds 2+ Claims into one insight it asserts they share the same shape. The
  `/atomize` route runs a second skeptical judge (`buildFoldJudgeSystemPrompt`)
  that checks each cited Claim actually instances that shape and **restricts
  `derivedFromClaims` to the coherent subset** (narrowing `derivedFromConceptTitles`
  in lockstep). If none cohere the insight collapses to its single best-cited
  Claim — the principle is never deleted, only the over-broad fold is trimmed.
  Unlike the transfer judge it **fails open**: an unverifiable fold is the
  atomizer's honest best guess, so on judge error the Atom keeps its citations.
- **Readability re-lift (Claim → Insight pipeline, stages C+D).** The Atomizer
  reliably *generalizes* (finds the rule) but, asked to also strip jargon in the
  same pass, often leaves raw chemical formulas / acronyms in the wording. After
  generation the `/atomize` route runs a clarity pass (`buildReliftSystemPrompt`,
  domain-general — works for any field, not just materials):
  - **D — pass 1 (always):** an LLM edits *every* Insight to read naturally for a
    non-specialist — removing genuinely obscure terms, but **preferring a brief
    gloss of an established term over stacking several paraphrases** (which is
    what made early rewrites feel forced). It polishes *wording only* — the
    structural abstraction is already done by B. An already-natural Insight is
    returned unchanged.
  - **C — pass 2 (conditional):** `detectRung1Tokens` (code, no LLM) catches any
    chemical formula / acronym D left behind; only those Insights get a second D
    pass. The regex is a cheap residual check, not the primary gate.

  Nothing is silently dropped; a relift failure leaves the original Insight
  intact. Full path: **cluster (A) → decompose→shape(family→form)→abstract→transfer (B) →
  transfer judge → fold judge → readability rewrite (D, all) → residual check (C) →
  fix residuals (D)** — each an explicit, nameable step.
- **Reinforcement — how an existing Insight grows.** Discovery candidates
  are partitioned against existing Insights by embedding similarity
  (`partitionCandidatesByEmbedding`; fail-open when no embedding model is
  configured). A candidate that duplicates an existing Insight used to be
  dropped outright, losing the link between the new Claims and the
  abstraction they support. Instead the candidate's `derivedFromClaims`
  that the matched Insight does not yet cite are folded into it
  (`reinforceAtomWithClaims`), recorded as a `wiki_reinforce` activity
  with the new Claim ids as `used`. The Insight's body is deliberately
  not rewritten — regeneration stays the way text changes, and a later
  re-lift regenerates from the grown support set.

**World-model grounding retriever (Phase 2 / PR 2B + 2C).** A separate
lane that scores a knowledge piece against external world knowledge.
**User-triggered by default** (banner button or list-view bulk action),
never on file open; an opt-in setting ("Auto-ground new knowledge",
default OFF) adds a serialized, debounced background sweep that reacts to
new insights (`wikiMetas` changes) and grounds un-checked ones one at a
time (`useAutoGrounding`). PR 2C dropped both domain partitioning and
subject tagging — Graphium is a general-purpose note editor, so a
single KB covers claims from any field (cooking, economics, software,
materials, etc.), and asking the LLM to pick a subject label per entry
hit the same boundary-case problem as domain selection without giving
the retriever or any UI filter something useful to operate on.

Two-layer retrieval:

| Layer | Source | Cost | Updated by |
|---|---|---|---|
| seed KB | `public/grounding-kb/seed.v1.json` (build-bundled, single file) | free | manual curation, PR review |
| cache KB | `appdata` key `grounding-kb-cache` (per-user, single key) | free on hit | LLM-judged results sediment here automatically |
| LLM judge | `POST /api/world-grounding/check` → `groundingModel` (Settings → AI) | one model call | called only on KB miss |

`src/features/world-grounding/index.ts → checkValidity` is the facade:
KB lookup first (cheap), miss → LLM judge → sediment back into the
cache layer if the result passes the sedimentation rules
(`kb-cache.ts → isValidForCaching`: 4-value verdict + non-empty
`generatedByModel` + non-empty `claim` / `keywords`). The next check
on a similar claim is served from the cache layer at no LLM cost.

**Auto-upgrade of legacy entries.** A cache hit is served as-is only when
it is web-grounded (`KbEntry.grounded === true`) or a manual seed entry
(`generatedByModel === "manual-curated@v1"`). A *model-sedimented
parametric* entry (judged from memory before web evidence existed) is
treated as a miss and re-grounded once via the web path; on a successful
web-grounded sediment the old entry is removed (`removeFromKbCache`) so it
does not shadow the upgrade. If the re-ground fails (e.g. network down),
the old parametric verdict is kept rather than degrading to an error.

The LLM judge runs in one of two modes, picked per request in
`server/routes/world-grounding.ts`:

- **web-grounded** (whenever evidence can be retrieved): before judging,
  the route gathers evidence and then judges the claim *against that
  evidence* (`buildWebGroundedSystemPrompt`), pre-retrieval — the model
  never drives the search itself. Evidence comes from two layers:
  - **keyless built-in providers, always on** (`services/grounding-providers.ts`):
    Wikipedia full-text search (general) + OpenAlex (scholarly: DOI,
    citation count, abstract). No API key, no hard monthly cap (polite-pool
    style), URLs are verifiable — the default that works out of the box and
    fits the "is this claim known in the literature" question directly.
  - **a connected MCP search tool, on top** (`services/grounding-search.ts →
    findSearchTool` + `runGroundingSearch`): adds broad general-web coverage
    when the user has wired one up (e.g. Tavily / Brave). Optional.

  The verdict is grounded in real results rather than the model's memory;
  `null` means "searched and found no direct prior art — not a proof of
  novelty" (search cannot prove a negative). Output URLs are constrained to
  the URLs that actually appeared in the evidence
  (`parseWorldGroundingOutput` in `evidence` mode), so a model-invented URL
  is discarded by provenance, not by a domain list. No network existence
  check is needed — the URLs were retrieved seconds ago and may live on any
  domain.
- **parametric** (no evidence gathered — both layers empty/failed, e.g. the
  search APIs are down): the judge answers from its own knowledge and emits
  **no URLs at all** (`parseWorldGroundingOutput` in `none` mode strips every
  `url`; the prompt also instructs text-only citations). A recalled URL/DOI
  is almost always wrong — the high-entropy tail is fabricated and can
  *resolve to an unrelated paper* (observed: opus emitted an Acta Cryst DOI
  whose tail differed from the real one by three characters and resolved to a
  different article). The `ref` citation text is kept so the user can search
  for it; verifiable links come only from the web-grounded path. This is why
  the old hostname-whitelist + network-existence-check (which only proved a
  DOI *resolves*, not that it matches the citation) were removed entirely.

Web-grounded judgments are surfaced with `checkedBy: "web-search"` and
`KbEntry.grounded: true` (the real model id is still stored as
`generatedByModel` for the cache entry).

The lane is strictly separate from `epistemicStatus` /
`hypothesisStatus` — `attachValidity` never writes those fields. See
[DATA_MODEL.md §3.7](./DATA_MODEL.md) for the contract and
sedimentation rules.

Settings → Grounding data tab lists the merged seed + cache, filters by
verdict and free-text search, and lets the user delete individual
sedimented entries that the model produced (seed entries are read-only
from the UI; editing them requires changing `seed.v1.json` through a
PR).

**Idea authoring (Cmd-K Composer).** Ideas are produced through the
Cmd-K Composer flow rather than a server-side pipeline. The user
selects the Insights they want to weave, builds a citation note, and
invokes the LLM with that as the search-space constraint. The neck of
the hourglass is human-driven; the server-side pipeline handles only
Notes → Claims → Insights.

The relationship between Notes, Claims, Insights, and Ideas is described
philosophically in [CONCEPT.md §5](./CONCEPT.md#5-the-hourglass-where-portable-knowledge-is-born).

**Epistemic provenance (Phase η).** Every Claim and every Insight carries an
`epistemicStatus` (`speculation` / `interpretation` / `observation` /
`established`, low → high). The Ingester sets the Claim's status from the
note's linguistic surface (hedge markers → `speculation`, measurement language
without mechanism → `observation`, textbook framing → `established`). The
Atomizer then propagates the **lowest** status from a candidate Insight's
source Claims to the Insight itself — a structural rule, not a judgment call,
so a single `speculation` Claim cannot launder itself into an `established`
Insight by sharing a pattern with two `observation` Claims. Together these
rules let the knowledge layer absorb casual musings (the "maybe this is
true" half of a notebook) without contaminating the layers above.

**Toulmin extension (Phase γ).** The Knowledge Layer adds the three Toulmin
(1958) elements that were previously absent: **Rebuttal**, **Backing**, and
**Modal qualifier**.

- **Rebuttal** (`rebuttalConditions[]`) names the boundary conditions under
  which a Claim breaks down ("works except when temperature exceeds the
  decomposition point", "only holds while the user count stays below the
  inflection"). It is extracted at the Claim layer by the Ingester from the
  note's own "ただし〜" / "except when" phrasing, and the Atomizer **only**
  propagates it to the Insight layer when 2+ source Claims share a rebuttal
  on the same axis — a single Claim's boundary stays at the Claim layer.
- **Backing** (`backing[]`) grounds the Warrant (the inferential rule the
  Claim is leaning on) in a textbook principle, external paper, or another
  internal Claim. It stays at the Claim layer only — Insights are
  context-stripped, so the original Claim's Warrant no longer applies.
- **Modal qualifier** (`modalQualifier`) records the user's expressed
  certainty about a Claim (`necessarily` / `probably` / `possibly` /
  `rarely`), distinct from the system's `confidence` score and from
  `epistemicStatus`. Like backing, it is Claim-only — once the Insight
  factors out a recurring pattern, the original speaker's hedging no longer
  attaches.

The schema mirror is on `NoteIndexEntry.{rebuttalConditions, backing,
modalQualifier}` and the on-disk version is now
`INDEX_SCHEMA_VERSION = 16`.

**Empirical quality control.** The Wiki pipeline's discovery quality is
regression-tested by `bench/` (corpus + ground-truth + adversarial probes +
metrics). Each roadmap phase declares which metrics it must improve;
`pnpm bench:compare main` is required on every PR that touches the
ingester / atomizer / cross-updater / linter. See the README's "Knowledge
Layer benchmark" section and `docs/internal/benchmark.md` for the metric
definitions, corpus rationale, and merge rules.

### 3.4 Storage layer

A single interface (`src/lib/storage/types.ts`) abstracts where notes
live. Three providers ship today:

| Provider | Where notes live | Used in |
|---|---|---|
| **`local`** | Browser IndexedDB | Web (PWA) |
| **`filesystem`** | OPFS (browser) or native FS via Tauri | Desktop |
| **`server-fs`** | Filesystem on the Node server | Self-hosted (Docker) |

The provider is selected at runtime by `src/lib/storage/registry.ts` and
exposed via the `useStorage()` React hook.

A separate **shared storage** subsystem (`src/lib/storage/shared/`)
handles content addressed by hash for the Library / Fork features
(see §5).

## 4. Distribution targets

The same `src/` tree is built three different ways.

### 4.1 Web (PWA)

- Entry: `index.html` → `src/main.tsx`
- Storage: `local` provider (IndexedDB)
- AI features: optional, point at any reachable server URL
- Hosting: GitHub Pages today, Docker self-host for richer setups

### 4.2 Desktop (Tauri v2)

- Entry: `src-tauri/src/lib.rs` boots a webview that loads the same `src/`
  bundle
- Storage: `filesystem` provider, default path `~/Documents/Graphium/`
- Tauri commands (`list_note_files`, etc.) are defined in `lib.rs` and
  matched by TypeScript wrappers
- AI / Knowledge features run inside the app via a Node sidecar:
  `scripts/fetch-node.mjs` downloads Node 22 and renames it to
  `binaries/graphium-server-<triple>[.exe]` so Tauri can spawn it as a
  sidecar. `src/lib/sidecar.ts` resolves `sidecar/server.mjs` via
  `resolveResource()` and passes it as the first argument.
- LLM API keys are stored in the macOS Keychain (service
  `com.graphium.app`, account `<model-id>`) rather than on disk. The
  sidecar is started with `GRAPHIUM_USE_KEYCHAIN=1` on macOS, and the
  first read of an existing `models.json` migrates any plaintext
  `apiKey` field into the Keychain and rewrites the file without it.
  The Keychain path is macOS-specific (`security` CLI): on **Windows and
  Linux desktop**, and on non-Tauri deployments (Docker / dev), keys live
  in `models.json` as plaintext. See `SECURITY.md` §"Key storage & threat
  model" for the recommended mitigations (disk encryption, scoped/capped
  keys) until a platform credential store is wired up.
- The webview runs under a restrictive Content Security Policy
  (`app.security.csp` in `tauri.conf.json`): `script-src 'self'` so
  injected scripts from note content / imported URLs / AI output cannot
  execute, with `img-src`/`connect-src` allowing `https:` for arbitrary
  bookmark images and user-pasted URL previews. `devCsp` additionally
  allows the Vite dev server (`localhost:5174` + its HMR websocket).
- Two Tauri commands that touch the host are deliberately narrowed:
  `kill_pid` refuses any PID that is not Graphium's own sidecar
  (`node .../sidecar/server.mjs`), and file export goes through
  `save_bytes_with_dialog`, which opens a native save dialog in Rust and
  writes only to the path the user picks — JavaScript never supplies a
  filesystem path.
- Sidecar stdout/stderr is appended to `~/Library/Logs/Graphium/sidecar.log`
  on macOS (`<data_local_dir>/com.graphium.app/logs/sidecar.log` on other
  platforms). The file is rotated to `sidecar.log.1` once it exceeds
  5 MB, so old entries do not grow without bound.
- The sidecar carries an identity so a stale process is never reused. The
  app injects `GRAPHIUM_APP_VERSION` (its own build version) and
  `GRAPHIUM_PARENT_PID` (the app process id) when it spawns the sidecar, and
  `/api/health` echoes `version`, `pid` and `dataDir`. On startup
  `src/lib/sidecar.ts` reuses an already-running sidecar only when both
  `dataDir` and `version` match; a foreign `dataDir` (a stale worktree) or a
  mismatched `version` (a sidecar left over from before an auto-update) is
  sent `SIGTERM` and replaced. The sidecar additionally runs a watchdog that
  exits as soon as `GRAPHIUM_PARENT_PID` is gone, so it can never outlive the
  app and orphan port 3001 — an orphan would otherwise let a newer app reuse
  old code and return 404 for routes added after that build.
- The sidecar binds to loopback only (`127.0.0.1`; override with
  `GRAPHIUM_BIND_HOST`). Most of the local API is unauthenticated, so the
  server must never be reachable from other machines on the network. The
  Docker image sets `GRAPHIUM_BIND_HOST=0.0.0.0` instead, because inside a
  container the exposure boundary is the container port mapping.
- **Mobile capture inbox.** Media shot on a phone reaches the desktop
  through a folder the user already syncs (iCloud Drive, Dropbox,
  Syncthing — the desktop side of Graphium never talks to those services).
  Files land in `<inbox-root>/Inbox/`; four Tauri commands enumerate that
  directory (`inbox_list`, returning name/size/mtime), read one file as
  base64 (`inbox_read`), delete an imported file (`inbox_discard`) or move
  it aside into `<inbox-root>/Inbox/_imported/` (`inbox_mark_imported`).
  All four reject an empty root and any name containing a path separator
  or `..`, so the reachable surface is exactly one flat directory. The
  inbox is a staging area rather than a category: importing hands the
  bytes to the active storage provider, so the file becomes an ordinary
  asset in the media library and leaves the inbox. After a successful
  import the inbox-side file is **deleted by default** — the content
  already landed in the vault, so only a redundant copy is removed and no
  processed files pile up in the synced cloud folder; a toggle in the
  inbox's folder settings keeps processed files in `_imported/` instead.
  Failed items are always left in the inbox for retry. Imports are
  idempotent — the content SHA-256 is matched against captures already in
  the media index — and the origin survives as an optional `capture`
  record on the media entry. The web build has no filesystem to
  enumerate, so the inbox is desktop-only.
  Besides media, the inbox understands Graphium's own capture files:
  versioned JSON documents with the dedicated `.graphium.json` extension
  (`{"graphium": 1, "kind": "memo" | "url", ...}`) that the phone writes
  for memos and URL bookmarks. The importer recognizes them by extension
  *and* payload shape — never by extension alone, so a user-placed plain
  `.json` is not hijacked — and lands them as real entities through
  injected handlers: a memo becomes an entry in the capture store (its
  phone-side `createdAt` preserved), a URL becomes a URL-bookmark entry in
  the media index carrying the metadata the phone already fetched. A
  malformed or newer-versioned capture file falls through to the ordinary
  asset import, so no data is ever dropped.
- **Phone side: send queue.** The phone cannot write into the synced
  folder itself (iOS has no File System Access API), so captures taken in
  the mobile view enter a store-and-forward queue first
  (`src/features/mobile-capture/inbox/push/`): each file is persisted
  blob-and-all into IndexedDB the moment it is shot, renamed to
  `graphium-<YYYYMMDD-HHmmss>-<seq>.<ext>` (MIME-first extension), and
  survives auth expiry, upload failures and the PWA being killed. The
  mobile home is built around this queue: a fixed bottom capture bar
  (Write / URL / Photo / Video / Voice / Library) enqueues straight into
  it and the pending list stays pinned to the top of the content — the
  Send action sits at the right edge of the queue's heading row, and the
  header carries a connection chip — until it drains; there is no
  separate send sheet. Written captures ride the same rail: the bar's
  Write (memo) and URL buttons reuse the existing input dialogs but
  serialize the result into a `.graphium.json` capture file (named
  `graphium-<stamp>-<seq>-<kind>.graphium.json`) and enqueue it next to
  the photos, instead of saving into this device's own stores —
  everything captured goes to the inbox. Queue rows show memo captures as
  a note icon with the first line of text and URL captures as a link icon
  with title and domain. The primary transport drains the queue serially to the
  user's own Google Drive `Graphium/Inbox/` via OAuth (GIS token model,
  `drive.file` scope only, no secret; ≤5 MB multipart, larger files
  resumable), from where Google Drive for desktop syncs it into the
  folder inbox above. Everything sent this way — media, memos, URL
  captures — is stored as ordinary files in the user's own cloud storage;
  transfers use TLS, but there is no end-to-end encryption. Because SPA
  tokens expire after about an hour, a token failure aborts the drain and
  leaves the remaining items queued for the next connect. Captures
  enqueue regardless of OAuth setup — the queue itself lives in this
  device's IndexedDB — and when no client ID resolves the queue shows
  setup guidance at send time; only when IndexedDB itself is unavailable
  does a capture drop back to this device's own media library. Avoiding
  OAuth altogether needs no Graphium code: the OS
  share sheet can save a capture into the synced `Graphium/Inbox`
  folder by hand (Photos → share → the Files/Drive app → the synced
  folder, the same on iOS and Android), and the desktop inbox imports
  those files exactly the same way.
- **Phone side: opt-in and settings.** The phone never opens the full
  settings modal and never sees the desktop-worded mobile-link toggle
  (the experiment flag is per-device localStorage, so the desktop
  toggle and the phone entry points stay independent). While the flag
  is off, the classic home shows a small opt-in card on top of the
  timeline; trying it opens a storage picker (Google Drive selectable,
  OneDrive as a disabled coming-soon slot for P1.5) and a successful
  connect raises the flag, turning the home
  queue-first in place. The same picker backs the queue's Connect
  storage button, and the provider that actually connected is
  remembered (`graphium-push-provider`) as the future branching point.
  While the flag is on, a header gear opens a phone-only minimal
  settings sheet: storage (status, connect/change, disconnect, and the
  folded client-ID override), language, app version, and a small
  leave-experiment action that only lowers the flag — queue, tokens
  and overrides stay on the device. The OAuth client ID resolves from
  that per-device override first, then from the ID bundled with the
  build, so pushing works out of the box; the override remains as the
  escape hatch for self-hosting or a dead bundled ID.
- **Connecting storage is phone-only; the desktop only receives.** The
  OAuth token and the client-ID override both live in per-device
  `localStorage`, so connecting on the desktop would grant the desktop
  an upload token the phone never sees — and the desktop never uploads.
  On top of that, Google Identity Services authorizes through
  `window.open`, which the Tauri WebView cannot open at all. The desktop
  therefore offers no connect, disconnect or client-ID control. Its
  Settings → Storage → Mobile upload section carries exactly the
  desktop's own half of the job: the inbox root picker (same shape as
  the shared-folder pickers) and the "keep processed files in
  `_imported/`" toggle, plus a locally rendered QR code (`qrcode.react`,
  inline SVG — no network) that opens Graphium on the phone, where the
  storage connection is actually made. Both settings live in the same
  `localStorage` keys the inbox view's folder menu writes; the setters
  broadcast a `graphium-inbox-config-changed` event so either entry point
  reflects a change made in the other without a reload. The QR target is
  the serving origin plus `BASE_URL + app/` in the web build (so a
  self-hosted LAN deployment encodes an address the phone can reach) and
  the public app URL in the desktop build, whose `tauri://` origin is not
  reachable from anywhere else.
- Shipped targets: macOS Apple Silicon (`aarch64-apple-darwin`) and
  Windows x64 (`x86_64-pc-windows-msvc`). Other targets are unverified.

### 4.3 Self-hosted (Docker)

- Entry: `docker-compose.yml` (or `docker-compose.standalone.yml` for the
  editor-only flavor)
- Server: `src/server/index.ts`, a Hono app on `@hono/node-server`
- Storage: `server-fs` provider; notes live on the host filesystem
- AI: ships with LLM and embedding endpoints wired up

## 5. Sharing and Library

Graphium has an opt-in sharing model that does **not** require a central
service. It is built on top of a content-addressed shared storage layer.

```mermaid
flowchart LR
    A["Personal note<br/>(local provider)"] -->|Share| B[("Shared<br/>storage<br/>(content-addressed)")]
    B -->|Library view| C["Other user / device"]
    C -->|Fork| D["Personal copy<br/>(local provider)"]
```

Key pieces:

- **`src/features/sharing/`** — Library view, Share / Unshare actions, Fork
- **`src/lib/storage/shared/`** — content-addressed blob layer (hashing in
  `hash.ts`, ID assignment in `id.ts`, local-folder backend in
  `local-folder.ts`)
- **Blob materialization** — when sharing a note that embeds media, the
  media is uploaded as `shared-blob:` references; on Fork, those blobs are
  re-materialized into the personal copy

Today the shared backend is a local folder. Other backends (cloud
buckets, S3, IPFS-style) can be added by implementing the same blob
interface.

## 6. The Node server (when present)

The server is built on [Hono](https://hono.dev/) and is intentionally
thin. It does four jobs:

1. **Run the Wiki pipeline** (`src/server/services/wiki-*`).
2. **Proxy LLM and embedding calls** so API keys never reach the browser.
   See `src/server/services/llm.ts`, `embedding.ts`.
3. **Expose REST endpoints** under `src/server/routes/` (`agent`, `wiki`,
   `prov`, `tools`, `models`, `profiles`, `storage`, `usage`, `health`).
4. **Record AI usage** for every LLM / embedding call so users can see
   per-feature token consumption and estimated cost. The recording layer
   is `src/server/services/llm-usage.ts`. Every call goes through either
   `runAgentLoop()` (which tags the event with a `feature` identifier
   like `"wiki.ingest"` or `"agent.chat"`) or `generateEmbeddings()`
   (feature `"embedding"`). The raw event log lives at
   `data/ai-usage-log.json`; events older than 90 days are folded into a
   monthly summary at `data/ai-usage-summary.json` on server start. The
   dashboard at Settings → Usage reads from `GET /api/usage`.

   Per-model pricing (`USD / 1M tokens`) is stored as `rate` on each
   registered model (`ModelConfig.rate` in `src/server/config/models.ts`).
   The rate at call time is snapshotted into the event so historical
   costs stay consistent when prices change. If a price was entered
   incorrectly, `POST /api/usage/recalculate` rewrites the last 90 days
   of raw events with the current per-model `rate`. Each event is matched
   to a registered model first by `modelConfigId`, then by
   `provider`+`modelId` (header-injected calls record a placeholder
   `modelConfigId`, so model name is the reliable key). Events with no
   matching priced model are left untouched, and the monthly summary is
   not affected. The Usage tab exposes this as a "Recalculate cost"
   button.

**Error responses.** AI routes answer failures as JSON
`{ error, code? }`. `error` is always an English, human-readable string
(the server does not know the UI locale). `code` is an optional
machine-readable identifier for AI-setup / authentication failures —
`NO_MODEL_REGISTERED`, `SUBSCRIPTION_AUTH_EXPIRED`, `INVALID_API_KEY`,
`API_KEY_FORBIDDEN`, `EMBEDDING_MODEL_UNSUPPORTED` — defined in
`src/lib/ai-error-codes.ts` (shared by server and client). The client
maps known codes to localized messages via `localizeAiError()`
(`src/lib/ai-error.ts`) and falls back to the raw `error` string for
unknown or missing codes, so mixed old/new client-server pairs degrade
gracefully. Auth errors (401) from any LLM call are normalized in one
place — `runAgentLoop()` / `describeAuthError()` in
`src/server/services/agent-loop.ts` — because every AI feature funnels
through that loop.

When running as PWA only, all of this is absent and the editor still
works.

### 6.1 Authentication and trust model (current state)

Today the server's trust model is **deliberately minimal**. The expected
deployment is one of:

- The Tauri sidecar — server talks only to `tauri://localhost` origins
  (CORS-enforced) and lives in the user's process tree.
- A self-hosted Docker behind the user's own boundary (VPN, LAN, or
  reverse proxy).

Tokens you may see in headers (`X-Graphium-Token`, `X-LLM-API-Key`,
`X-MCP-Servers`, `X-Registry-URL`/`X-Registry-Key`) are passthrough to
upstream LLM / MCP / Registry APIs, not authentication for the Graphium
server itself. `X-MCP-Servers` carries the user's directly-registered MCP servers; the
`agent` route resolves each into a connection. Two transports:

- **stdio (local)** — the server spawns the configured `command`/`args`
  as a child process and speaks MCP over its stdio, the same model as
  Claude Desktop. Only works where the backend can spawn processes
  (Tauri sidecar, Docker, dev) — not in a pure browser.
- **remote (HTTP/SSE)** — connects to an already-running server by URL,
  with an optional per-server bearer token.

Crucible is a **discovery source, not a connection**. The settings UI
calls `/api/tools` (with `X-Registry-URL`/`X-Registry-Key`) to list a
registry's MCP servers — each carrying a resolved `mcp_url`/`transport`
— and the user picks individual servers, which are stored as ordinary
remote entries with concrete URLs. The registry URL is remembered in
`savedRegistries` for re-browsing only; it is never auto-connected. The
legacy client `registryUrl` migrates into `savedRegistries` on load. One
exception stays server-side: an env default (`CRUCIBLE_API_URL`) is still
auto-expanded by the `agent` route via `fetchRegistryServers()` so a
self-hosted/Docker deployment gets its registry tools (and skills) with
zero per-user setup.

Clients are kept in a per-`id` connection pool and reused across
requests; editing a server's config re-signs the entry and transparently
reconnects. **Security note:** stdio servers run arbitrary local commands
the user configured — the same trust model as Claude Desktop. On a
self-hosted/Docker backend, anyone who can reach the API and set
`X-MCP-Servers` can run commands inside that backend; keep it behind the
user's own boundary. There is no built-in user
auth, multi-tenant isolation, or audit log on the server today.

Operators exposing the server to the public internet should put it
behind their own auth proxy. A first-class auth model is on the roadmap
once team-shared storage stabilizes.

## 7. Build and runtime stack

| Concern | Choice |
|---|---|
| Bundler | Vite 6 (`vite.config.ts`) |
| Type checking | TypeScript via `tsc --noEmit` |
| Tests | Vitest (`pnpm vitest run`) |
| Component dev | Storybook (port 6006) |
| Package manager | pnpm (npm/yarn are not used) |
| State management | React Context + feature-local stores; no global state library |
| Server runtime | Node ≥ 20 via `@hono/node-server` |
| Native shell | Tauri v2 (Rust) for desktop |

## 8. Source map

Where to look first when you want to change X. This is a **curated map of
the high-traffic areas**, not an exhaustive listing — `src/features/`
holds many more directories than appear here. For the complete picture,
just `ls src/features/` and `ls src/lib/`. The table below covers what
people most often need to find.

| Want to change | Look in |
|---|---|
| Block types or editor behavior | `src/blocks/`, `src/note-app.tsx` |
| Slash menu / inline `@`-link / label UI | `src/features/block-link/`, `src/features/context-label/`, `src/features/inline-label/` |
| PROV-DM graph generation | `src/features/prov-generator/` |
| Per-note edit history | `src/features/document-provenance/` |
| AI chat & note derivation | `src/features/ai-assistant/` |
| ⌘K palette (note search + ask) | `src/features/composer/` |
| ⌘F in-document find (highlight matches) | `src/features/document-search/` |
| Knowledge UI and service | `src/features/wiki/` |
| Knowledge pipeline (ingest / atomize / synthesize) | `src/server/services/wiki-*.ts` |
| Inter-note network graph (Cytoscape) | `src/features/network-graph/` |
| Storage provider | `src/lib/storage/providers/`, `src/lib/storage/registry.ts` |
| Note JSON shape and migrations | `src/lib/document-types.ts`, `src/lib/document-migration.ts` |
| Index file (note list, schema version) | `src/features/navigation/index-file.ts` |
| Sharing / Library / Fork | `src/features/sharing/`, `src/lib/storage/shared/` |
| Settings UI (model, profile, fonts) | `src/features/settings/` |
| Slash-template commands (Plan / Run) | `src/features/template/` |
| Skill (prompt template) documents | `src/features/skill/` |
| Reference table (related notes) | `src/features/index-table/` |
| Export (PROV-JSON-LD, PDF, DOCX import) | `src/features/prov-export/`, `src/features/pdf-export/`, `src/features/docx-import/` |
| Onboarding flow | `src/features/onboarding/` |
| URL-to-PROV / PDF-to-PROV ingestion | `src/features/url-to-prov/`, `src/server/services/prov-ingester.ts` |
| Mobile capture inbox (phone → desktop media) | `src/features/mobile-capture/inbox/` |
| Material-science benchmark harness | `tests/benchmark/material-science/` |
| Release notes UI | `src/features/release-notes/` |
| Tauri integration | `src-tauri/src/lib.rs`, `src/lib/menu-events.ts` |
| Landing page | `src/landing/` |

## 9. Compatibility and migrations

Graphium is OSS and shipped to real users, so a few invariants are
treated as load-bearing.

- **Note JSON (`GraphiumDocument`).** New fields go in as `optional`. Renames
  and removals require a migration in `src/lib/document-migration.ts`,
  applied at load time.
- **Index file.** `INDEX_SCHEMA_VERSION` in
  `src/features/navigation/index-file.ts` must be bumped on any
  `NoteIndexEntry` / `GraphiumIndex` shape change. The index is rebuilt
  on version mismatch.
- **Storage providers.** Changes to the `StorageProvider` interface
  (`src/lib/storage/types.ts`) require updates in all three providers
  (`local`, `filesystem`, `server-fs`). Optional methods are preferred
  for additive changes.
- **IndexedDB stores.** Schema changes require bumping the DB version
  and writing a `onupgradeneeded` migration in `local.ts`.
- **Tauri commands.** Commands added or renamed in `src-tauri/src/lib.rs`
  must be matched in TypeScript callers; the desktop and web builds share
  the same TS code.

The detailed expectations are written into the project's `CLAUDE.md`
"破壊的変更チェック" section. The data shapes themselves are documented
in [DATA_MODEL.md](./DATA_MODEL.md).

## 10. Known seams (technical debt I am tracking)

Areas where the current architecture works but has visible seams. Listed
so contributors do not mistake these for finished design.

- **Two "provenance" subsystems with no shared abstraction.** See §3.2.
  `prov-generator` (world model) and `document-provenance` (edit log)
  share a name and a directory neighborhood but no common interface. A
  third "provenance" concept (e.g. Wiki ingest provenance) would make
  this worse. A unifying domain layer is on the roadmap.
- **Wiki pipeline lacks an explicit orchestrator.** See §3.3. The five
  stages are independent services that read and write Wiki files
  directly. There is no event bus, no queue, and no centralized retry
  policy. This is fine at single-user scale but will need an orchestrator
  before adding more stages or supporting larger workloads.
- **Personal storage and shared storage are two separate abstractions.**
  `StorageProvider` (notes) and the content-addressed blob layer (`shared/`)
  have different shapes. Mostly intentional, but it means every feature
  that crosses the boundary (Share, Fork, materialize) has to bridge
  them by hand.
- **Tauri command signatures and TypeScript callers are synced manually.**
  No codegen between `src-tauri/src/lib.rs` and the TS wrappers. Mismatches
  surface only at runtime in the desktop build.
- **No first-class auth on the server.** See §6.1. Acceptable for the
  current deployment shapes (Tauri sidecar, self-hosted behind a proxy)
  but a known gap if the server is ever exposed publicly.

---

## See also

- [CONCEPT.md](./CONCEPT.md): the design philosophy
- [DATA_MODEL.md](./DATA_MODEL.md): on-disk file formats and schemas
- [README](../README.md): install and run
