# Graphium — Data Model

This document describes the on-disk shapes Graphium uses: notes,
Knowledge layer documents (Summaries / Claims / Insights / Ideas), the
navigation index, shared storage entries, and the IndexedDB layout of
the browser provider. It is the reference for anyone who wants to read,
write, migrate, or interoperate with Graphium files.

> **Label vs. identifier.** UI labels (English / Japanese) and on-disk
> identifiers differ on purpose — identifiers are part of the file
> format and must not break existing data.
>
> | UI label (EN / JA) | On-disk `WikiKind` |
> |---|---|
> | Summaries / 要約 | `summary` |
> | Claims / 知見 | `claim` |
> | Insights / 洞察 | `atom` |
> | Ideas / 発想 | `synthesis` |
>
> Type names (`AtomType`, `SynthesisMode`) and field names
> (`atomType`, `synthesisMode`) also keep the historical identifiers
> for the same reason. The rest of this document uses the on-disk
> identifiers for technical accuracy.

The corresponding source of truth in code:

- `src/lib/document-types.ts` — `GraphiumDocument`, `WikiMeta`, labels
- `src/features/navigation/index-file.ts` — `GraphiumIndex`,
  `NoteIndexEntry`, `INDEX_SCHEMA_VERSION`
- `src/lib/storage/types.ts` — `StorageProvider`
- `src/lib/storage/shared/types.ts` — `SharedEntry`, `BlobRef`
- `src/lib/storage/providers/local.ts` — IndexedDB layout

For *why* the shapes are this way, see [CONCEPT.md](./CONCEPT.md). For
how the layers fit together, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Design principles

A few invariants underpin every schema in this document.

- **Plain JSON.** Notes and Wiki documents are JSON. You can read, diff,
  and grep them without Graphium. Binary attachments are referenced, not
  embedded.
- **Versioned shapes.** Every persisted document carries a numeric
  `version` (notes) or a schema version (index). Mismatches trigger
  migrations or rebuilds.
- **Additive by default.** New fields are optional. Renames and removals
  require a migration path. See §8.
- **Provenance is not optional metadata.** PROV-DM information lives
  next to the content it describes (block labels, inline highlights),
  not in a parallel sidecar that might drift.

## 2. The note: `GraphiumDocument`

Each note is a single JSON file (or one row in IndexedDB for the `local`
provider). The top-level shape:

```ts
type GraphiumDocument = {
  version: 1 | 2 | 3 | 4 | 5;
  title: string;
  pages: GraphiumPage[];

  // ── identity / lineage ──────────────────────────────
  noteLinks?: NoteLink[];           // outgoing @-links to other notes
  derivedFromNoteId?: string;       // upstream note (for derived notes)
  derivedFromBlockId?: string;      // upstream block within that note
  // @-cited document assets (PDF/docx) referenced from this note's body.
  // Each entry is a media-index fileId of the cited material itself (not a
  // note). Cmd-K / chat AI reads each cited asset's full text + highlight
  // memos so you can write from the source. Distinct from noteLinks (notes)
  // and sourcePdfFileId (a note *generated from* a PDF).
  citedAssetFileIds?: string[];

  // ── user-assigned context labels ────────────────────
  // Free-form categories the user attaches by hand (e.g. "eureco",
  // "philosophy", "MCP research"). Note-level, multiple allowed. Orthogonal
  // to PROV block labels (procedure/material/…, auto-extracted) and to
  // wikiMeta.theme (a Synthesis-only lens). Used for note-list display /
  // filtering; mirrored to NoteIndexEntry.noteContexts (index v21) and
  // intended to later scope AI context to a chosen context.
  noteContexts?: string[];

  // ── authorship / agent ──────────────────────────────
  generatedBy?: {
    agent: string;
    sessionId: string;
    model?: string;
    tokenUsage?: { input_tokens; output_tokens; total_tokens };
    user?: { username: string; email?: string };
  };
  source?: "human" | "ai" | "skill";   // default: "human"

  // ── conversational layer ────────────────────────────
  chats?: ScopeChat[];              // per-scope AI chat history

  // ── document provenance (edit log) ──────────────────
  documentProvenance?: DocumentProvenance;

  // ── Knowledge layer metadata (only when source === "ai") ────
  wikiMeta?: WikiMeta;

  // ── shared storage refs (Phase 2) ───────────────────
  sharedRef?: { id; type: "note"; sharedAt; hash };
  forkedFrom?: { sharedId; hash; authorName; authorEmail; forkedAt };

  // ── skill metadata (only when source === "skill") ───
  skillMeta?: SkillMeta;

  // ── layout ───────────────────────────────────────────
  // true = the editor body spans the full window width (Notion's
  // "Full width"). Unset/false = readable fixed-width column (default).
  fullWidth?: boolean;

  // ── external source ─────────────────────────────────
  // Set when the note was generated from an external URL (URL-to-PROV)
  sourceUrl?: string;
  sourceFetchedAt?: string;
  sourceTitle?: string;
  sourceTextFileId?: string;  // media fileId of the persisted URL source text (B-persist)
  // Set when the note was generated from a PDF (PDF-to-PROV)
  sourcePdfFileId?: string;  // media-index fileId of the source PDF
  sourcePdfName?: string;    // display filename
  // Set when the note was generated from a document asset (.docx etc.)
  // imported through the materials library.
  sourceDocumentFileId?: string;  // media-index fileId of the source document
  sourceDocumentName?: string;    // display filename

  // ── plan note backref ──────────────────────────────
  // Set on execution notes when one source describes multiple synthesis
  // procedures and a separate plan note groups them. The plan note has
  // no `partOfPlanNoteId` (it is the plan). Independent of
  // `derivedFromNoteId`: membership in a plan is not derivation.
  partOfPlanNoteId?: string;

  createdAt: string;   // ISO 8601
  modifiedAt: string;  // ISO 8601
};
```

### 2.1 `version` history

The `version` field tracks the *content shape* of the note (not the app
version). Migrations live in `src/lib/document-migration.ts` and run at
load time.

| `version` | Change |
|---|---|
| **1** | Initial format. `links` field mixed PROV and knowledge layers. |
| **2** | `links` split into `provLinks` and `knowledgeLinks`. |
| **3** | Label values normalized from Japanese brackets (`[材料]`) to internal keys (`material`). |
| **4** | Internal key `result` (Output Entity) renamed to `output`. Phase labels `plan` / `result` introduced. |
| **5** | Inline-type labels (`material`, `tool`, `attribute`, `output`) moved from block-level labels to inline highlights. `LabelStore` is heading-only (`procedure` / `plan` / `result` / `free.*`), with **table blocks** as the one entity-label exception — see §2.3 (structured tables). |
| **6** | Procedures become `step` blocks. Each `procedure`-labelled heading is converted into a `step` block that **keeps the heading's id** and takes the heading's scope (following blocks up to the next same-or-higher heading, recursively for nested procedures) as its children — so `activity_<id>`, `informed_by` links and block anchors all survive and the generated graph is unchanged. `plan` / `result` labels are stripped (phase was withdrawn; pre-v6 graphs may contain `_plan` nodes that no longer regenerate). Free-form tags are left as inert data. |

Loaders accept any prior version and migrate forward. Saving always
writes the latest version.

### 2.2 `GraphiumPage`

Pages are the units inside a note (most notes have one). Each page
carries blocks plus the provenance overlays.

```ts
type GraphiumPage = {
  id: string;
  title: string;
  blocks: BlockNoteBlock[];          // BlockNote.js block tree

  // ── block-level labels (#) ───────────────────────────
  labels: Record<string, string>;    // blockId → label key
                                     // v5+: heading-only (procedure / plan / result / free.*),
                                     // plus material / tool / output on table blocks (§2.3)

  // ── provenance graph edges ──────────────────────────
  provLinks: ProvLink[];             // DAG-constrained
  knowledgeLinks: KnowledgeLink[];   // cycles allowed

  // ── inline highlights (v5+) ─────────────────────────
  highlights?: InlineHighlight[];    // material / tool / attribute / output
  mediaInlineLabels?: Record<string, MediaInlineLabel>;  // for image/video/audio/pdf/file blocks

  // ── table annotations ───────────────────────────────
  tableMeta?: Record<string, TableMeta>;
                                     // tableBlockId → caption + per-column behaviors +
                                     // row-to-note links (see below). Tables stay
                                     // *standard* BlockNote tables whose cells are plain
                                     // strings, so they survive Markdown export; only the
                                     // annotations live here (same approach as
                                     // mediaInlineLabels).

  // ── on-device image OCR ─────────────────────────────
  mediaOcr?: Record<string, MediaOcrEntry>;
                                     // blockId → text read out of an image with
                                     // Tesseract.js, entirely on the user's device.
                                     // An annotation layer over the *standard* image
                                     // block (same approach as mediaInlineLabels), so
                                     // any image can be read later regardless of how it
                                     // was inserted — no dedicated block to paste into.

  // ── block alignment ─────────────────────────────────
  blockAlignments?: Record<string, "left" | "center" | "right">;
                                     // blockId → alignment, for blocks WITHOUT a
                                     // BlockNote `textAlignment` prop (table / audio / file).
                                     // Paragraph / heading / image / video / callout store
                                     // alignment in their own `textAlignment` block prop instead.

  // ── lineage ─────────────────────────────────────────
  derivedFromPageId?: string;
  derivedFromBlockId?: string;

  // ── deprecated ──────────────────────────────────────
  links?: any[];                     // v1 only; loaders convert to provLinks/knowledgeLinks
  indexTables?: Record<string, Record<string, string>>;
                                     // superseded by tableMeta (note-link columns);
                                     // loaders convert, writers no longer emit it
  logTables?: Record<string, Record<string, unknown>>;
                                     // superseded by tableMeta (datetime-auto columns
                                     // plus caption); loaders convert, writers no
                                     // longer emit it
};
```

#### Table annotations (`tableMeta`)

There is only **one** kind of table. What used to be two kinds — the *log
table* (rows get a timestamp) and the *index table* (rows link to notes) —
were in truth two behaviors of the **first column**, so they are expressed as
per-column annotations instead. Both are still one drag-handle (⠿) toggle away,
and a table can carry both at once.

```ts
type ColumnType =
  | "datetime-auto"   // adding a row stamps this column's empty cell with the current time
  | "note-link";      // a row's value can create / open a note of its own

type TableMeta = {
  caption?: string;                        // any table can be named; empty means no caption
  columns?: Record<string, ColumnType[]>;  // column name → behaviors on that column
  noteLinks?: Record<string, string>;      // row value → note file ID (note-link data)
  source?: TableSource;                    // where an imported table came from
};

type TableSource = {
  kind: "delimited-file";
  fileName: string;                        // name of the imported file
  fileId?: string;                         // media index ID, when the file is kept as an asset
  importedAt: string;                      // ISO 8601
  options: {                               // the settings the table was read with
    headerRow: number;                     // 1-based line number of the header row
    endRow: number;                        // 1-based line number of the last data row
    delimiter: "comma" | "tab" | "space" | "custom";
    customDelimiter?: string;              // single character, when delimiter is "custom"
    collapseConsecutive: boolean;          // treat runs of the delimiter as one
  };
  meta?: { key: string; value: string }[]; // `key: value` lines read from the preamble
};
```

- **Cells stay strings.** Timestamps and note names live in the table itself, so
  a Markdown export is an ordinary table. This is the deliberate split from
  app-only database blocks.
- **`columns` is keyed by column name**, matching how the chart block references
  columns (`xColumn` / `yColumn`). Renaming a column does *not* break anything
  today: behaviors are applied to the first column, and the key records which
  column they were attached to. Strict positional resolution by name arrives with
  the column-header UI.
- **The value is a list** because one column can carry more than one behavior —
  a timestamped column whose rows also open per-entry notes is a real usage.
- **Only the minimum set of behaviors exists.** Value types such as `number` or
  `text` are deliberately absent until something needs them; adding a behavior
  later is additive.
- **Captions apply to every table.** Named tables show the name above the table
  (academic caption position) and charts use it as the reference name. Tables with
  a `datetime-auto` column additionally fall back to a document-order auto-name
  ("Table 1"), which is display-only and never saved.
- **`source` records where an imported table came from.** Instrument logs
  (`.txt` / `.dat` / `.csv`) are turned into ordinary tables, and the conversion
  parameters — which lines were read, with which delimiter — are kept here rather
  than thrown away. Dropping them would make the numbers untraceable back to the
  raw file, which is exactly the thing this app exists to prevent. The preamble a
  converter normally discards (`# Device Model: ENV-MONITOR-X9`) is kept as
  `meta`, because for a lab note those lines *are* the measurement conditions.
  When the file was also registered as an asset, `fileId` links the table back to
  it and the import can be re-run with the stored settings.

### 2.3 PROV-DM label model

PROV-DM information attaches to blocks in four places:

| Carrier | What it labels | Field |
|---|---|---|
| **`step` block type** | The block itself is a PROV *Activity*. Its children are the Activity's contents, and its title is the Activity label. Carries no label — the block type says it. This is the only way to author a procedure. | `page.blocks[]` (`type: "step"`) |
| **Block label** | On **table blocks** *inside a step*: a `material` / `tool` / `output` *structured-table* marker, or `attribute` for a *parameter table* (see below). Applied from the drag-handle menu. The `#` affordance is gone entirely. Legacy heading labels no longer survive loading: the v6 migration converts `procedure` headings into `step` blocks and strips `plan` / `result` (§2.1). Free-form tags in older notes remain as inert data and can be removed. | `page.labels[blockId]` |
| **Inline highlight** | Spans of text inside a block as PROV *Entity* (with `material` / `tool` / `output` subtypes) or as a *Property* (`attribute`) on the parent. | `page.highlights[]` |
| **Media inline label** | Same as above but for non-text blocks (image / video / audio / pdf / file) where BlockNote inline styles do not apply. | `page.mediaInlineLabels[blockId]` |

**Structured tables.** A table is a block whose cells are atomic values,
so inline highlights do not apply inside cells (the formatting toolbar
hides the entity-label buttons there). Instead the **whole table** may
carry a `material` / `tool` / `output` block label via the drag-handle menu.
The PROV generator then expands it: the **header row supplies attribute
keys**, and **each data row becomes one Entity** — the first column is the
Entity name, the remaining columns become its attributes (`key=value`). A
table needs at least a header row plus one data row; otherwise it falls
back to a single Entity for the whole table.

A table labelled `attribute` is read as a **parameter table** instead: the
**header row supplies parameter keys** and the **first data row supplies
the values**, and the resulting `key=value` map is merged into the
`params` of the enclosing Step (Activity) — or of the parent Entity, when
the table is nested under one. This is the structured counterpart of an
inline `attribute` highlight, which attaches a single property to its
parent.

```ts
type InlineHighlight = {
  id: string;
  blockId: string;     // host block (no cross-block highlights)
  from: number;        // char offset within the block
  to: number;
  label: "material" | "tool" | "attribute" | "output";
  entityId: string;    // identity key — same entityId = same PROV Entity
  text: string;        // snapshot of highlighted text (for recovery)
};

type MediaInlineLabel = {
  label: "material" | "tool" | "attribute" | "output";
  entityId: string;    // shares namespace with InlineHighlight.entityId
};
```

`entityId` is the deduplication key. Multiple highlights pointing to the
same referent share an `entityId` so the PROV generator emits one
*Entity* node.

`entityId` is also the handle for editing an entity that lives in prose:
renaming and removing from the flow view rewrite the underlying inline
span (`src/features/inline-label/entity-edit.ts`) rather than any graph
state. To make parameters addressable the same way, the generator carries
the originating `entityId` into the emitted attribute entries as
`graphium:entityId`. Removal is conservative: a span that is the sole
content of its paragraph is deleted with the paragraph, while a span
inside prose only loses its mark — the text is never destroyed.

**Tables are the bridge for graph-side editing.** Entities born from a
**structured table** carry the node id `entity_<tableBlockId>_<rowName>`
(outputs use the historical `result_` prefix), which is enough to write
back the row's first cell (its name), any cell matched by header column,
or to delete the row (`src/features/network-graph/table-row-edit.ts`).
Adding an input, tool or output from the graph appends a row to that
step's labelled table — creating and labelling one if the step has none —
so the note accumulates a sample table rather than one-word paragraphs.
Duplicate row names resolve to the first matching row, and a column that
is not in the header is a no-op.

A step's **parameters** are a table too: the columns of a table labelled
`attribute` inside the step, where the header row holds the keys and the
first data row the values (`ensureParameterTable`). Only the first data
row is read, which is why the flow view offers new columns rather than
new rows there. The label is what makes the generator read the table at
all, so it is applied automatically whenever the table is created from
the graph.

An entity that only exists as a prose highlight can be **moved into the
table** in one step: the row is appended and the span loses its mark, so
the sentence survives while the entity gains a place to hold attributes.
Its node id changes from `inline_<label>_<entityId>` to the table form as
a result — consumers that track a selection across regenerations must
tolerate that.

**Handoffs between steps.** `informed_by` is desugared into
`used`/`wasGeneratedBy` through an output entity (§2.3). When the previous
step has exactly one explicit output it is used as that entity; with
several outputs and no name match the generator does **not** pick one —
it falls back to the "result of X" placeholder, since choosing would
assert a handoff the note never stated (branching procedures make that
guess visibly wrong). To pin a specific output, name it among the next
step's inputs: text-equal unification then merges the two into a single
Entity, which is what the flow view draws as a solid edge. Both inline
output spans and `result_*` outputs (output-labelled paragraphs and table
rows) take part in that unification, and the output side always survives
the merge so table-row attributes are preserved.

**Same-named materials and tools merge.** Within a note, material or tool
entities whose labels match (case- and whitespace-insensitive) collapse
into one Entity used by every step that mentions them — "乳鉢" written in
two steps yields one mortar with two `used` edges, with the table-row
occurrence preferred as the surviving node so graph-side edits land in a
table. The merge refuses to destroy information: same-named rows of the
same table stay separate (writing two rows was deliberate), plan/result
phases stay separate (they are related by `wasDerivedFrom` instead), and
entities whose parameter values conflict ("量: 1g" vs "2g") stay
separate. Outputs merge only **within one step**, where a prose highlight
and a table row of the same name are the same thing — this is what lets
"add to the table" leave the highlight in place without splitting the
entity in two. Across steps, outputs never merge this way; the
informed_by-gated handoff unification above is the only mechanism for
that.

The generator (`src/features/prov-generator/`) consumes both label
sources and the block structure to produce the PROV-DM graph. Activity
containment is inferred, never stated by the user:

- Blocks inside a `step` belong to that step's Activity. Containment is
  the parent–child relation itself, so moving a block in or out with the
  drag handle rebinds it. Nested steps bind to the innermost one.
- Blocks outside any step fall back to heading levels, which feed a
  `scopeStack` that infers containment from document structure.

Headings inside a step are ordinary subheadings and produce no Activity,
so a block is never bound to two Activities at once.

#### Plan / Execution phase (removed)

`[Plan]` / `[Result]` phase labels were withdrawn: a marked plan pays off
only when one protocol is compared across several runs, and that
granularity is served by note-level plan/execution splitting
(`partOfPlanNoteId`, §2). The v6 migration strips any remaining phase
labels on load (§2.1), so loaded documents never carry a phase and newly
generated graphs never contain `graphium:phase` metadata or `_plan`
entity nodes. Graphs exported before v6 may still contain them; their
historical semantics were: `graphium:phase` marked an Entity as
`"plan"` or `"execution"`, plan Entities carried an `_plan` id suffix,
and a matching plan/execution pair was joined by `prov:wasDerivedFrom`
from the executed Entity to the planned one.

#### Image OCR

On-device OCR results (Tesseract.js; stored in `page.mediaOcr[blockId]`,
§1) are deliberately **not** projected into the PROV graph. The graph
describes the procedure the user wrote; an automatic OCR pass is tooling
provenance, not a step of that procedure, and an earlier release that did
project image → OCR → extracted-text chains put distracting noise next to
hand-labelled steps, so the projection was withdrawn. The extracted text
still powers full-text search (`ocrText` in the note index, §5) and the
asset gallery's detail panel.

The same text is also mirrored onto the *material* it was read from
(`MediaIndexEntry.ocrText` in the media index), which is what makes an image
findable on its own — in the asset gallery and in the `⌘K` Composer's
**Images** section — rather than only through the note it happens to sit in.
Two paths write it: reading from the gallery stores it directly, and reading
an image inside a note mirrors it across (`page.mediaOcr[blockId]` stays the
source of truth for the block). Text read before the media index reached
schema version 5 is recovered on the next rebuild, which walks every note and
copies `page.mediaOcr` onto the matching material; a value already written
from the gallery is never overwritten.

### 2.4 Document provenance (edit log)

`documentProvenance` is a separate concern from the PROV-DM graph above.
It records the *edit history of the note itself* — who edited what,
when, with which agent (`human` / `ai`). Defined in
`src/features/document-provenance/types.ts`.

This is intentionally not unified with the PROV-DM graph. The graph
describes *the world the note talks about*; the edit log describes *the
note as an artifact*. See [ARCHITECTURE.md §3.2](./ARCHITECTURE.md#32-provenance-layer-prov-dm).

Each edit operation is an `EditActivity` with a `type`. Besides the
note-editing types (`human_edit` / `human_derivation` / `ai_generation`
/ `ai_derivation` / `template_create` / `derive_source`), the Knowledge
Layer's growth operations record their own dedicated types so that a
merge is distinguishable from a regeneration in the provenance record:

| `EditActivityType` | Recorded when |
|---|---|
| `wiki_ingest` | a Wiki entry is created from a source (note / PDF / URL / Word / chat / manual intake) |
| `wiki_merge` | the ingester's *merge* suggestion rewrites an existing Wiki entry to absorb new content |
| `wiki_cross_update` | a cross-update revises an existing Wiki entry after another note was ingested |
| `wiki_dedup_merge` | the lint pipeline auto-merges a redundant Wiki entry into a kept one |
| `wiki_regenerate` | an existing Wiki entry is regenerated from its recorded sources |
| `wiki_atomize` | an Insight (atom) is generated by structural abstraction over Claims |
| `wiki_reinforce` | an existing Insight gains new supporting Claims: a discovery candidate that duplicated it (by embedding similarity) is folded into its `derivedFromClaims` instead of being dropped. The body is not touched — the grown support set feeds the next regenerate |

An `EditActivity` may also carry `used?: string[]` (PROV-DM `used`): the
ids of the sources the operation ingested — note ids, Wiki ids, or
prefixed external-source ids (`pdf:` / `url:` / `document:` / `chat:` /
`memo:`).
Unlike `wikiMeta.derivedFromNotes` (a cumulative *current-value set*),
`used` keeps the per-operation attribution: which save was caused by
which source. Both fields are optional additions, so documents written
by older builds load unchanged.

The revision log is **uncapped**. Every save appends a `RevisionEntity`
(hash + activity + timestamps) and the entry is kept indefinitely;
provenance is the core promise of Graphium, so silently dropping old
revisions would contradict it. Each entry is small (a few hundred bytes
of metadata, no content snapshot), so the file size grows roughly
linearly in number of saves. If this becomes a measured problem,
preferred mitigations are content-hash deduplication or
user-controlled pruning, not silent truncation.

Separately from the automatic edit log, a user can pin a **manual
version snapshot** of a note or a Skill document ("Save version").
Unlike revisions, which store only diff metadata, a snapshot is a full
`GraphiumDocument` copy, so an old version can be reopened in its
entirety. Snapshots live in the provider's app-data channel and never
enter `listFiles()`, so they do not appear in the note list, search, or
graphs, and no index schema change is involved:

```ts
type SnapshotMeta = {
  id: string;          // full document stored under key snapshot:<id>
  noteId: string;      // meta list stored under key snapshot-index:<noteId>
  version: number;     // auto-numbered 1..N per note
  label?: string;      // optional user-given name
  savedAt: string;     // ISO 8601
  contentHash: string; // same page hash as the revision log
};
```

Versions are immutable once taken; taking a snapshot whose content hash
equals the latest one is a no-op instead of a duplicate. The history
panel interleaves snapshots with the automatic revision log into a
single timeline ordered by timestamp.

Restoring differs by document kind. Notes offer **Fork from here** (a
new note derived from the version). Skill documents instead offer
**Restore this version**: the current content is overwritten with the
snapshot, management metadata (`createdAt`, the provenance chain, and
the built-in default sync fields of `SkillMeta`) is carried over from
the current document, and the operation is appended to the provenance
log as a `snapshot_restore` activity — so a restore is itself part of
the history rather than a rewrite of it.

### 2.5 Conversational layer

```ts
type ScopeChat = {
  id: string;
  scopeBlockId: string;
  scopeType: "heading" | "block" | "page";
  messages: {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    // User messages only: references to notes attached via @-mention, or to
    // a material (PDF/URL) attached via "Ask AI" from the material side-peek.
    // The attached items' contents are expanded into the model prompt at
    // send time (not stored in `content`); these references allow the
    // expansion to be reproduced when the message is edited & resent or
    // the response is regenerated. For `kind: "asset"`, `id` is the material's
    // fileId and `assetType` is its MediaType ("pdf" / "url").
    attachments?: {
      id: string;
      title: string;
      isWiki?: boolean;
      kind?: "asset";
      assetType?: string;
    }[];
  }[];
  generatedBy?: { agent; sessionId; model?; tokenUsage? };
  // Present only on chats created by forking another chat: the parent
  // chat's id and the index of the last message carried over (inclusive).
  forkedFrom?: { chatId: string; messageIndex: number };
  createdAt: string;
  modifiedAt: string;
};
```

Chats are anchored to a scope (a heading, block, or page) so they can be
re-attached to the same context after edits.

Where a chat is stored depends on where it was started. A chat opened
from a note lives in that note's `chats` field (§1). A chat opened from
the **material full view**'s "Ask AI" panel has no note to belong to, so
it is stored per material under the `asset-chats:<fileId>` app-data key
(§6.1), as the same `ScopeChat[]` shape with `scopeType: "page"` and an
empty `scopeBlockId`. Notes persist their chats as part of saving the
note; the material view has no explicit save action, so it writes on a
short debounce whenever the conversation changes and flushes once more
when the view closes. Deleting the last chat writes `null`, the same
logical delete used for snapshots.

A chat can be **forked**: the messages up to a chosen point are copied
into a new `ScopeChat` (new `id`, `forkedFrom` pointing at the parent)
while the original chat is preserved unchanged. Editing a past user
message and resending it, or regenerating an assistant response,
rewrites the active chat in place: messages after the edit point are
discarded and replaced by the new exchange.

## 3. Knowledge layer documents

A Wiki document is a regular `GraphiumDocument` with `source: "ai"` and
a populated `wikiMeta`. It opens in the same editor as a human note.

```ts
type WikiKind = "summary" | "claim" | "atom" | "synthesis";

type WikiMeta = {
  kind: WikiKind;
  // Upstream source IDs. Usually a plain note/Knowledge ID, but when the
  // Knowledge was ingested directly from an asset (not a note) the ID carries
  // a prefix identifying the external source:
  //   "pdf:<mediaFileId>"      ingested from a PDF asset
  //   "url:<url>"              ingested from a URL
  //   "document:<mediaFileId>" ingested from a Word (.docx) / document asset
  //   "chat:<timestamp>"       ingested from an AI chat session
  //   "memo:<captureId>"       ingested from a memo (capture) — no note is created
  // Lineage / graph views resolve these prefixes to external source nodes
  // (see features/network-graph/external-source.ts).
  derivedFromNotes: string[];
  derivedFromChats: string[];
  generatedAt: string;            // ISO 8601
  generatedBy: { model: string; version: string };

  lastIngestedAt?: string;
  skillsUsed?: string[];
  editedSections?: string[];      // blockIds protected from re-ingest
  sectionEmbeddings?: { sectionId: string; modelVersion: string }[];
  language?: string;

  // Claim-only
  level?: "principle" | "finding" | "bridge";
  status?: "candidate" | "verified";
  evidenceSpan?: string;

  // Atom-only
  derivedFromClaims?: string[];

  // Knowledge cited/examined when this note was created from a Cmd-K verb
  // answer ("Make a Claim/Insight"). Distinct from derivedFromClaims (Atom
  // re-generation) and derivedFromNotes (regenerate assumes plain notes):
  // read only by the PROV-JSON-LD export to emit wasDerivedFrom edges.
  citedKnowledgeIds?: string[];

  // Self-evaluated confidence (Synthesis especially)
  confidence?: number;            // 0.0 – 1.0

  // Semantic types (Phase 1, all optional — additive, back-compatible)
  claimRole?: ClaimRole[];    // Claim only. Multi-valued.
  atomType?: AtomType;            // Atom only. Logical character of the statement.
  shape?: AtomShape;              // Atom only. Relationship-shape FORM (structure-mapping leaf).
  shapeFamily?: ShapeFamily;      // Atom only. Upper axis of the shape. Derived deterministically from `shape`.
  transfer?: AtomTransfer;        // Atom only. Cross-domain analogy, kept only if the judge confirms a structural match.
  synthesisMode?: SynthesisMode;  // Synthesis only.
  hypothesisStatus?: HypothesisStatus; // Synthesis only. Default "speculative" when mode is set.
  procedureContext?: ProcedureContext; // Claim only. Atom/Synthesis are context-stripped by contract.

  // World-model grounding (Phase 2 / PR 2A onwards). Separate lane from epistemicStatus
  // and hypothesisStatus: writers never overwrite those fields; promotion is `suggests` only.
  // PR 2A populates `validity` from a distilled KB (no LLM, no external search).
  grounding?: GroundingProfile;
};

type ClaimRole =
  | "finding" | "decision" | "anomaly" | "question"
  | "setup"   | "interpretation" | "issue";

type AtomType =
  | "causal" | "correlational" | "mechanistic" | "conditional"
  | "definitional" | "methodological" | "observational" | "boundary";

// Relationship-shape: the structure-mapping axis the atomizer classifies into
// (it classifies, it does not invent — this is what keeps abstraction from going vacuous).
// Classification is 2-level: the atomizer first picks a FAMILY (the axis) then a FORM
// (the leaf) inside it. `shape` stores the form (unchanged, 10 values); `shapeFamily`
// stores the family. Each form belongs to exactly one family (SHAPE_FORM_TO_FAMILY),
// so the family is derivable from the form — `shapeFamily` is additive/optional and the
// parser self-heals any family/form mismatch by trusting the form.
type AtomShape =  // the FORM (leaf)
  | "monotonic-increase" | "monotonic-decrease" | "optimal-middle" | "threshold"
  | "trade-off" | "enabling-condition" | "composition-structure"
  | "reinforcing-loop" | "balancing-loop"   // feedback cycles (systems-thinking R/B loops)
  | "other";

type ShapeFamily =  // the upper axis; SHAPE_FORM_TO_FAMILY maps each form to exactly one
  | "functional-dependence"  // monotonic-increase/-decrease, optimal-middle, threshold, trade-off
  | "structural"             // composition-structure
  | "conditional"            // enabling-condition
  | "dynamic-feedback"       // reinforcing-loop, balancing-loop
  | "other";                 // other

// Cross-domain analogy. The atomizer proposes a candidate; a skeptical judge keeps it
// only when the example instances the SAME shape + role-structure. Absent if forced/none.
type AtomTransfer = { field: string; example: string };

// UI surfacing: `shape` is shown (form), prefixed by its `shapeFamily` (family) when the
// family is known, in the detail view's context drawer (alongside world-grounding /
// derived-from), as understated text rather than a badge.
// `transfer` is generated and stored but intentionally NOT surfaced — spotting where an
// Atom transfers to another field is the user's creative work, and pre-filling it would
// anchor the reader (it is reserved for a future human-triggered "Idea" layer). `shape`
// and `shapeFamily` are read directly from the full `WikiMeta`, so nothing is mirrored into
// `WikiMetaSummary` / `NoteIndexEntry` and `INDEX_SCHEMA_VERSION` is unchanged. Legacy atoms
// (with `shape` but no `shapeFamily`) recover their family for free via `resolveShapeFamily(shape)`.

type SynthesisMode =
  | "deductive" | "abductive" | "analogical" | "dialectic";
  // "inductive" was retired in PR-B4 — induction is the Claim → Atom operation,
  // not a Synthesis mode. See docs/inference-types.md for the rationale.

type HypothesisStatus = "speculative" | "tested" | "confirmed" | "refuted";

type ProcedureContext = {
  derivedFromNotes: string[];
  protocolFingerprint?: string;
  keyParameters?: { name: string; value: string; necessity: "critical" | "important" | "incidental" }[];
  keyTools?: string[];
  validityRange?: string;
};
```

### 3.1 `kind` semantics

| Kind | Role | Carries context? |
|---|---|---|
| `summary` | Internal-facing summary of one note. | yes |
| `claim` | Cross-note claim extracted from notes (fact-based; the hourglass widens here). | yes |
| `atom` | Experimental layer. One context-free claim with citations. | **no** (the hourglass waist) |
| `synthesis` | Experimental layer. New insight built from atoms. | yes (re-applied) |

`synthesis` documents are authored through the Cmd-K Composer flow
rather than an automatic pipeline: the user selects Insights, builds a
citation note, and invokes the LLM with that as the search-space
constraint.

### 3.2 `level` and `status` for Claims

Claims can be qualified along two axes:

- **`level`** (abstraction):
  - `principle` — a general principle the note actually relied on in its
    reasoning, even if textbook-known.
  - `finding` — a transferable proposition that emerged from the user's
    experience.
  - `bridge` — an abstraction across multiple findings (produced by the
    cross-updater).
- **`status`**:
  - `candidate` — supported by one source. Every newly generated Claim
    starts here.
  - `verified` — supported by two or more independent sources.
    Promotion is automatic and evaluated at the wiki save chokepoint
    (`handleSaveWikiFile` / `handleCreateWikiFile` in
    `src/hooks/use-file-manager.ts`, using
    `promoteClaimStatusIfCorroborated` from
    `src/features/wiki/wiki-service.ts`): a `candidate` Claim whose
    `derivedFromNotes` contains two or more distinct *independent*
    sources is promoted. Independent means the id is not the wiki's
    own id (legacy self-references exist from an old regenerate bug)
    and not another wiki page's id (the orphan auto-link can add
    those); external-source ids (`pdf:` / `url:` / `document:` /
    `chat:` / `memo:`) do count. Promotion never reverses — removing a source
    later does not demote, and a regenerate (which rebuilds
    `wikiMeta` as `candidate`) carries the previous `verified` over.
    Verified Claims show a "Corroborated" badge on the entry banner;
    this is a separate axis from world-grounding verdicts and
    `epistemicStatus`.

### 3.3 Section embeddings

`sectionEmbeddings` records which sections have embeddings and with
which model version. The actual vectors live in
`src/lib/embedding-store.ts` (per-section, addressed by `sectionId`).

### 3.4 Edit protection on re-ingest

Any block whose ID appears in `wikiMeta.editedSections` is treated as
human-edited and skipped during re-ingest. This is how a user can
correct a Knowledge entry without losing the correction the next time
ingest runs.

### 3.5 Semantic types (Phase 1)

Three orthogonal type dimensions are attached as metadata on Knowledge
notes. The user never picks them — the generating LLM auto-infers them.
All fields are optional and additive: existing Wiki notes from prior
versions stay valid with these fields absent.

| Field | Where it lives | Vocabulary |
|---|---|---|
| `claimRole[]` | Claim | finding, decision, anomaly, question, setup, interpretation, issue |
| `atomType` | Atom | causal, correlational, mechanistic, conditional, definitional, methodological, observational, boundary |
| `shape` | Atom | The FORM (leaf) of the structure-mapping axis: monotonic-increase, monotonic-decrease, optimal-middle, threshold, trade-off, enabling-condition, composition-structure, reinforcing-loop, balancing-loop, other. The atomizer classifies into this (2-level: family → form). |
| `shapeFamily` | Atom | The upper axis (family) of `shape`: functional-dependence, structural, conditional, dynamic-feedback, other. Additive/optional; derivable from `shape` via `SHAPE_FORM_TO_FAMILY` (each form → exactly one family), so legacy atoms recover it for free. |
| `transfer` | Atom | `{ field, example }` — a cross-domain analogy kept only when the transfer judge confirms a structural match (forced ones are dropped) |
| `synthesisMode` | Synthesis | deductive, abductive, analogical, dialectic (induction relocated to Atom layer; see `docs/inference-types.md`) |
| `hypothesisStatus` | Synthesis | speculative (default), tested, confirmed, refuted |
| `epistemicStatus` | Claim, Atom | speculation, interpretation, observation, established (Phase η — see §3.6) |
| `rebuttalConditions[]` | Claim, Atom | free-form short strings; Atom level only carries rebuttals that 2+ source Claims share (Phase γ) |
| `backing[]` | Claim | `{ source: "textbook" \| "external-paper" \| "internal-claim", citation, url?, internalClaimId? }` (Phase γ) |
| `modalQualifier` | Claim | necessarily, probably, possibly, rarely (Phase γ) |
| `relatedAtoms[]` | Atom (also stored on Claim, currently produced for Atom) | `{ atomId, relationType, citation }` with fixed `relationType` vocabulary (Phase δ). 0–3 entries, quality-over-quantity. |
| `theme` | Synthesis | Legacy field preserved on existing synthesis docs for back-compat; new Cmd-K Composer authoring does not populate it. |

These dimensions are **orthogonal to the existing context labels**
(`procedure / plan / result / material / tool / attribute / output`),
which carry PROV-DM ontological roles inside a note. The semantic types
describe **what kind of reasoning move the Wiki note makes** —
information that the context-label layer cannot express.

`procedureContext` carries the **procedural skeleton** the claim
depends on: key parameters, key tools, validity range. It lives at the
Claim layer only — Atom and Synthesis are context-stripped by contract
(the hourglass waist). When a reader of an Atom or Synthesis needs the
reproducibility scaffold of an upstream Claim, they walk back via
`derivedFromNotes` / `derivedFromClaims` and read the source Claim's
`procedureContext`.

Populated at **Ingest time** (Phase 2.2/2.3): the client computes a
PROV summary of the source note with `summarizeNoteProv()` and sends it
to `/api/wiki/ingest` as `provSummary`. The server formats it into a
markdown block (`formatProvSummaryForPrompt`) that prepends the user
message, and the system prompt instructs the LLM to fill
`procedureContext` only on Claims whose validity actually depends on
the procedure. `parseProcedureContext` then sanitizes the LLM output:
invalid `necessity` values fall back to `"important"`, name-or-value-
empty parameters are dropped, and an all-empty `procedureContext` is
collapsed to `undefined` so the field never appears as a meaningless
husk in `wikiMeta`.

> History: PR-B3 briefly propagated `procedureContext` into Atom and
> Synthesis via an intersection-of-source-Claims fallback. PR-B4.5
> reverted that — having context on Atom contradicted "context-
> stripped" and made the hourglass model internally inconsistent. The
> `document-migration` step on load strips `procedureContext` from any
> Atom / Synthesis docs that still carry it.

#### Semantic types in the PROV-JSON-LD export (Phase 4)

When a note is exported as PROV-JSON-LD (`src/features/prov-export/`),
the Wiki Knowledge Layer entities carry the semantic types under
`graphium:*` attributes:

```jsonc
{
  "@type": "Entity",
  "@id": "graphium:wiki/Annealed%20thin%20film%20resists%20oxidation",
  "graphium:wikiKind": "claim",
  "graphium:claimRole": ["finding"],
  "graphium:claimLevel": "finding",
  "graphium:procedureContext": {
    "protocolFingerprint": "spin-coat → anneal",
    "keyParameters": [{ "name": "T_anneal", "value": "650°C", "necessity": "critical" }],
    "validityRange": "T_anneal ∈ [600, 700]°C"
  }
}
```

`atomType` is emitted for `wikiKind = atom`, `synthesisMode` and
`hypothesisStatus` for `wikiKind = synthesis`. The export contract is
the only place where these semantic types cross Graphium's boundary, so
the field names here are stable even as UI labels shift (Atom →
Insights, Synthesis → Ideas in PR-271 — internal identifiers are
unchanged). See ARCHITECTURE.md §3.2 for the full export table.

### 3.6 Toulmin extension (Phase γ)

Phase γ adds the three Toulmin (1958) elements that were previously absent
from the Knowledge Layer schema: **Rebuttal**, **Backing**, and **Modal
qualifier**. The earlier layers already covered Claim, Data (evidence),
Warrant (implicit in claim text + level), and Qualifier-of-confidence
(`confidence` field). With Phase γ the Knowledge Layer carries all six
Toulmin elements explicitly.

| Toulmin element | Field | Layer | Notes |
|---|---|---|---|
| Claim | (the document body) | Claim, Atom, Synthesis | |
| Data (evidence) | `derivedFromNotes`, `externalReferences` | Claim, Atom | |
| Warrant | implicit in body | Claim, Atom | |
| **Backing** | `backing[]` | **Claim only** | grounding for the Warrant: textbook / external paper / internal Claim |
| **Modal qualifier** | `modalQualifier` | **Claim only** | user-facing certainty: necessarily / probably / possibly / rarely |
| **Rebuttal** | `rebuttalConditions[]` | **Claim and Atom** | conditions under which the Claim breaks down. Atom layer only carries rebuttals that 2+ source Claims share (Atomizer's propagation rule) |

Why the asymmetry — Atom carries `rebuttalConditions` but not `backing` /
`modalQualifier`:

- **Rebuttal** describes when the Claim's relation between subject and
  effect ceases to hold. That structural boundary often transfers
  cleanly through domain-lifting (e.g., "above a temperature threshold"
  / "below a population threshold" are both expressible as
  "above/below a regime boundary"). When 2+ source Claims share the
  same rebuttal axis, lifting it to Atom level is itself a useful
  abstraction.
- **Backing** is the grounding of the *Warrant* — the inferential rule
  the Claim is leaning on. The Warrant of an Atom is no longer the
  Warrant of any single source Claim (the lift has stripped the
  specifics), so importing the Claim-level backing would be a category
  error.
- **Modal qualifier** is the *speaker's expressed certainty* about a
  specific Claim. When the Atom factors out the recurring abstract
  idea, the original speaker's hedging is no longer attached to the
  lifted statement.

#### Atomizer propagation rule

The Atomizer applies a strict guard when emitting an Atom-level
`rebuttalConditions`:

1. Look at the `rebuttalConditions` array of each source Claim.
2. Only propagate when **2 or more source Claims** carry a rebuttal.
3. Domain-lift the rebuttal wording the same way the Atom's title and
   body are lifted — replace specific domain entities with the
   abstract category they belong to.
4. If only one Claim has a rebuttal, leave the Atom's
   `rebuttalConditions` empty. A single Claim's rebuttal stays at the
   Claim layer.

`parseAtomizerOutput()` enforces this guard server-side: when the
caller passes a `conceptIdToRebuttals` map, atoms emitted by the LLM
without ≥2 source rebuttals get their `rebuttalConditions` reset to
`undefined`. This is a structural propagation rule, not a judgment
call — the same shape as Phase η's lowest-status inheritance.

#### Fold verification (co-structure judge)

When an Atom folds **2 or more** Claims into one insight, it asserts
those Claims all instance the *same* structural shape — that is why it
cites them together in `derivedFromClaims`. A separate skeptical judge
(mirroring the transfer judge, in the `/atomize` route) checks that
claim of co-structure and **restricts `derivedFromClaims` to the subset
that genuinely folds** into the insight. A Claim whose relationship is
actually a different shape is dropped from the citation list. Semantics:

1. Only Atoms with `derivedFromClaims.length >= 2` are judged.
2. The judge returns the coherent subset; the route narrows both
   `derivedFromClaims` **and** `derivedFromConceptTitles` together
   (they stay positionally paired) to that subset.
3. If the judge confirms none cohere, the insight is **never deleted** —
   it collapses to its single best-cited Claim (the first-listed one).
   The principle survives; only the over-broad fold is trimmed.
4. The judge **fails open**: on any error or unparseable output the Atom
   keeps its original `derivedFromClaims` (an unverifiable fold is the
   atomizer's honest best guess). This is the opposite of the transfer
   judge, which fails closed — dropping an unverifiable analogy is pure
   upside, but dropping unverifiable citations would degrade real atoms.

The narrowed `derivedFromClaims` is what persists; a transport-only
`foldDroppedClaims` count is exposed for display/audit but is **not**
written to `WikiMeta`.

#### Honesty defaults

The Ingester treats these fields conservatively:

- **Do NOT invent rebuttals** when the source note has no boundary
  language. The default is an empty array.
- **Do NOT fabricate backing citations**. If the user wrote "教科書に
  よると…" without naming the textbook, the backing entry uses
  `{ source: "textbook", citation: "<the user's framing>" }` — never
  a made-up title.
- When `modalQualifier` is ambiguous, default to `probably` rather
  than picking a stronger or weaker qualifier on a guess.

These defaults match the conservative spirit of Phase η's
`epistemicStatus`: it is safer to under-tag a claim than to falsely
launder it into established certainty.

### 3.6.1 Atom-to-Atom dimensional relations (Phase δ)

`relatedAtoms[]` captures axial-coding relations between Atoms. Each
entry is `{ atomId, relationType, citation }` where:

- `atomId` is the noteId of another Atom (or, in principle, a Claim).
  Unresolved or archived IDs surface in the wiki context drawer as
  `(unknown)` with the link disabled.
- `relationType` is drawn from a fixed vocabulary defined in
  `src/lib/document-types.ts`:
  `extends`, `is-special-case-of`, `shares-mechanism`,
  `shares-precondition`, `contradicts`,
  `applies-to-different-domain`.
- `citation` is a one-sentence natural-language description of the
  relation, quality-over-quantity (max ~3 relations per Atom).

The Atomizer parser sanitises every entry and caps the array at 3.

Surface: the wiki context drawer (`WikiContextDrawer`, rendered below the
note body) renders `relatedAtoms` inside the "Derived from" collapsible
(the same section as `derivedFromNotes` / `derivedFromClaims`). The slim
identity strip (`WikiBanner`) stays above the body; the relational
sections moved below it (D2 layout). Keeping the collapsible count low is
deliberate: every extra collapsible section costs readability.

### 3.6.2 Synthesis authoring (Cmd-K Composer)

`synthesis` documents are produced through the Cmd-K Composer flow:
the user selects the Insights they want to weave, builds a citation
note, and invokes the LLM with that as the search-space constraint.
The resulting Idea inherits citations to the selected Insights via the
standard `derivedFromAtoms` / `derivedFromClaims` machinery.

Legacy `synthesis` JSON files on disk remain readable; the
`wikiMeta.theme` field stays for back-compat (see §3.5 field table).


### 3.7 World-model grounding (Phase 2)

Phase 2 adds a `grounding` field on `WikiMeta` that answers a different
question from `epistemicStatus` / `hypothesisStatus`: **"how does this
piece of knowledge stand against the world outside the user's notes?"**

```ts
type GroundingValidityVerdict = "contested" | "weak" | "supported" | "established";

type GroundingSource =
  | { kind: "distilled"; ref: string; note?: string; url?: string };
  // PR 2B will add kind: "model" | "search".

type GroundingProfile = {
  validity?: {
    score?: number;                          // 0..1 (raw, not directly surfaced in PR 2A UI)
    verdict?: GroundingValidityVerdict;
    rationale?: string;
    sources?: GroundingSource[];
    matchedKeywords?: string[];              // KB keywords that hit (PR 2A audit field)
    checkedBy?: string;                      // "distilled-kb@v1" (KB hit) | "web-search" (web-grounded) | "<model-id>" (parametric) | "no-engine"/"engine-error"
    checkedAt?: string;                      // ISO 8601
    entryId?: string;                        // KB entry this grounded to (world-grounding edge)
    dismissed?: boolean;                     // user manually cleared the verdict (see below)
  };
  // Promotion of an existing status field is "suggest" only — never write.
  suggests?: { field: "hypothesisStatus" | "epistemicStatus"; to: string; reason: string };
};
```

The lane is **strictly separate** from the existing layers:

- `grounding` writers never overwrite `epistemicStatus` or
  `hypothesisStatus`. `attachValidity()` in
  `src/features/world-grounding/index.ts` is the only attach path and
  is regression-tested for this invariant.
- `verdict` shares the spelling `established` with one of the
  `epistemicStatus` enum values, but the two are independent axes.
  `epistemicStatus` is the speaker's own epistemic stance about the
  Claim; `grounding.validity.verdict` is how a curated KB sees the
  Claim against the broader literature.
- The verdict is allowed to be **absent**. When the distilled KB has no
  hit, `validity` still records `{ checkedBy, checkedAt }` so the UI
  can say "checked but unmatched" without lying.
- `GroundingSource.url` is populated **only** for web-grounded judgments,
  where the URL is constrained to one that appeared in the retrieved
  evidence (Wikipedia / OpenAlex / a search MCP). A purely parametric
  judgment (model memory, when search is unavailable) emits **`ref` text
  only, no `url`** — a recalled DOI/URL is high-entropy and can resolve to
  an unrelated paper, so verifiable links come only from retrieval. See
  [ARCHITECTURE.md §3.3](./ARCHITECTURE.md) for the two judge modes.
- `entryId` records the KB entry the claim grounded to (the matched seed
  entry, or the `gen-…` id of a freshly sedimented LLM result). This is a
  **world-grounding edge**: two insights with the same `entryId` are
  grounded to the same world fact. The wiki context drawer surfaces
  siblings ("insights grounded to the same world fact"). What accumulates is the
  *edge* between the user's insights and the world — not a copy of the
  world's knowledge — so it stays distinct from being a lossy LLM mirror.
  Absent when the verdict is null (no match / not sedimented).
- `dismissed` marks a verdict the user **manually cleared** from the note.
  It distinguishes "never checked" (no `grounding` at all) from "checked,
  then deliberately removed". A dismissed entry renders like an un-grounded
  one (no badge, no list tag) and is **excluded from auto-grounding**, so an
  explicit clear is not silently re-attached while auto-grounding is on. A
  manual "Check world" re-run replaces the whole `validity`, dropping the
  flag. (Regeneration drops `grounding` entirely, so regenerated content is
  re-grounded as usual.)

`INDEX_SCHEMA_VERSION` does NOT bump when `grounding` lands. A minimal
slice (`verdict`, `checkedAt`, `entryId`, `dismissed`) is mirrored into the
**runtime** `WikiMetaSummary.groundingValidity` for the list verdict column and the
context-drawer edge lookup, but it is **not** persisted into `NoteIndexEntry`,
so the on-disk index schema is unchanged. A future PR that needs the
verdict in the persisted index (e.g. cross-session quadrant badges) is
responsible for adding that column and bumping the schema version (§5.1).

Grounding is **user-triggered by default** (banner button or bulk action
on the list view) — there is no open-time auto-check. An **opt-in**
setting (Settings → AI → "Auto-ground new knowledge", default OFF) adds a
background sweep that grounds un-checked insights/claims one at a time
(`useAutoGrounding` / `pickNextUngrounded`). It reacts to `wikiMetas`
changes — i.e. fires when an insight is created — serialized and
debounced so a bulk creation (e.g. atomize) coalesces instead of
bursting. It is
KB-first, so cost converges to "one model call per genuinely novel world
fact" as the KB grows. The default stays manual to honor the cost-floor
rule and to avoid surprising existing users on upgrade. The verdict is
presented as the KB's positioning of the claim, not as a judgment of the
user's stance — the final call stays with the user (SPEC §8-1 / §8-4).

PR 2B flips the validity engine into a **two-layer KB + LLM fallback**, and
PR 2C drops both domain partitioning *and* subject tagging so the KB works
across any topic (cooking, economics, software, materials — Graphium is a
general-purpose note editor, not a materials-only tool). LLM-driven subject
classification was considered and rejected: it ran into the same
boundary-case problem domain partitioning did (one claim often spans
"materials / chemistry / food-science" with no canonical label) without
giving the retriever or the cache anything useful in return — the retriever
already matches on `keywords`, and a filter UI surfacing one auto-coined
label per entry would just be noise:

1. KB lookup — seed `public/grounding-kb/seed.v1.json` (single file, no
   domain split) merged with user-local `appdata` cache `grounding-kb-cache`
   (single key). Hit returns instantly with no LLM call.
2. KB miss → user's configured `groundingModel` (Settings → AI tab)
   judges the claim via `POST /api/world-grounding/check`. The model
   must output strict JSON with `verdict` (4 values or `null`),
   `rationale`, a domain-general `normalizedClaim`, and `keywords`.
3. If the model returns a 4-value verdict with `normalizedClaim` and
   `keywords`, the result is **sedimented** into the local appdata
   cache as a new KB entry tagged with `generatedByModel`. The next
   check on a similar claim is served from the KB at no LLM cost — the
   KB grows by use.

Sedimentation rules (enforced in code by
`src/features/world-grounding/kb-cache.ts → isValidForCaching`):

- **`not_found` is never cached.** `verdict: null` (insufficient evidence
  for or against) is *not* written. Re-checking later goes back to the
  model, preserving the chance for a future verdict.
- **`generatedByModel` is required.** Entries marked `manual-curated@v1`
  are seed-only and refused by the cache.
- **`claim` and `keywords` must be non-empty** or the entry is
  unindexable.
- **Form-1 (individual judgments / note contents) are never cached.**
  The model is instructed to emit a domain-general `normalizedClaim` —
  experiment-specific parameters / sample IDs / lab names are stripped
  before sedimentation. The cache stays strictly local; a shared
  cache layer would need convergence-validation (kickoff §6) and is out
  of scope.

PR 2C migration: when a user that ran PR 2B has a `grounding-kb-cache-materials`
key in their appdata, the first `loadKbCache()` call after the update folds
those entries into the unified `grounding-kb-cache` and deletes the legacy
key. No data loss.

The `groundingModel` Settings slot follows the same degrade pattern as
`chatSynthesisModel` — when empty, falls back to the default model;
when no model is registered at all the check returns `checkedAt`-only
and the badge shows "checked · no KB match" without erroring.

The Settings → Grounding data tab now exposes per-entry deletion for
sedimented (model-judged) entries. Seed entries are read-only from the
UI; editing them requires changing `public/grounding-kb/seed.v1.json`
through a PR.

## 4. Skill documents

A "Skill" is a prompt template, also stored as a `GraphiumDocument` with
`source: "skill"`.

```ts
type SkillMeta = {
  description: string;            // one-line summary
  availableForIngest: boolean;    // auto-apply during ingest
  createdAt: string;
  systemSkillId?: string;         // identifier for built-in skills (cannot be deleted)
  language?: "ja" | "en";         // restrict to a generation language
  systemSkillVersion?: number;    // last synced built-in default version
  defaultPromptHash?: string;     // normalized hash of that default prompt (edit detection)
};
```

Skills inherit storage / index treatment from notes; the `source` field
discriminates them downstream.

### 4.1 Built-in default versioning

Each built-in skill definition (`SystemSkillDefinition`) carries a
`version` number that is bumped whenever its shipped prompt changes. On
startup the app compares it with `skillMeta.systemSkillVersion`:

| Condition | Action |
|---|---|
| document has no version info (pre-versioning) | write current version + hash into `skillMeta`, leave content untouched |
| stored version ≥ shipped version | nothing |
| shipped version newer, prompt hash matches `defaultPromptHash` (never edited) | auto-update the prompt body to the new default |
| shipped version newer, hash differs (user edited) | show an "update available" badge; content is only replaced when the user hits *Reset to default* |

Edit detection hashes a normalized prompt (whitespace / blank lines
ignored) extracted through the same markdown ⇄ block pipeline on both
sides, so editor round-trips do not produce false "edited" states.
Auto-update and *Reset to default* both append a `skill_default_update`
activity to the document provenance chain instead of discarding it.

## 5. The navigation index: `GraphiumIndex`

A single JSON file aggregates the metadata of every note, Wiki document,
and Skill. It powers the left-nav list, search, back-link computation,
and label filters.

```ts
type GraphiumIndex = {
  version: number;     // INDEX_SCHEMA_VERSION
  updatedAt: string;
  notes: NoteIndexEntry[];
};

type NoteIndexEntry = {
  noteId: string;
  title: string;
  modifiedAt: string;
  createdAt: string;

  headings: { blockId: string; text: string; level: 2 | 3 }[];
  steps?: { blockId: string; text: string }[];   // step container titles (v23)
  labels:   { blockId: string; label: string; preview: string }[];
  outgoingLinks: {
    targetNoteId: string;
    targetBlockId?: string;
    layer: "prov" | "knowledge";
  }[];

  source?: "human" | "ai" | "skill";
  wikiKind?: WikiKind;
  author?: string;
  model?: string;
  derivedFromNotes?: string[];      // for source === "ai" only

  inlineLabels?: {
    blockId: string;
    label: "material" | "tool" | "attribute" | "output";
    text: string;
    entityId: string;
  }[];

  deletedAt?: string;               // trashed timestamp (user intent)
  archivedAt?: string;              // archived timestamp (user retire OR system retention)

  // Phase 1 semantic types — mirrored from wikiMeta for fast list-view filtering
  claimRole?: ClaimRole[];
  atomType?: AtomType;
  synthesisMode?: SynthesisMode;
  hypothesisStatus?: HypothesisStatus;

  // Phase η: epistemic provenance — mirrored from wikiMeta.epistemicStatus
  // (low → high: speculation < interpretation < observation < established).
  // Atomizer propagates the LOWEST status from source Claims to the Atom,
  // so a single speculation Claim cannot pass as established knowledge
  // through the Atom layer.
  epistemicStatus?: EpistemicStatus;

  // Phase γ: Toulmin extension — mirrored from wikiMeta.
  //   rebuttalConditions: Claim and Atom. Conditions under which the Claim
  //                       breaks down. Atom only carries those that 2+ source
  //                       Claims share (Atomizer propagation rule).
  //   backing:            Claim only. Grounding of the Warrant (textbook /
  //                       external paper / internal Claim).
  //   modalQualifier:     Claim only. User-facing certainty
  //                       (necessarily / probably / possibly / rarely).
  rebuttalConditions?: string[];
  backing?: BackingEntry[];
  modalQualifier?: ModalQualifier;

  // Phase δ (v17): Atom-to-Atom dimensional relations — mirrored from
  //   wikiMeta.relatedAtoms. 0–3 entries, used by list views to badge
  //   "Atoms with relations" and by downstream tooling to prioritise
  //   analogical / dialectic pairings.
  relatedAtoms?: AtomRelation[];

  // Legacy synthesis theme mirror. Preserved on existing synthesis
  //   docs for back-compat and UI grouping. New Cmd-K Composer
  //   authoring does not populate it.
  theme?: string;

  // v21: user-assigned context labels — mirrored from
  //   GraphiumDocument.noteContexts (normalised: trimmed, de-duped
  //   case-insensitively). Note-level free-form categories the user attaches
  //   by hand; used by the note list for the "Context" column display and the
  //   column-header filter. Orthogonal to PROV labels and to `theme`.
  //   Absent → undefined (treated as "uncategorised").
  noteContexts?: string[];

  // v22: concatenated text read on-device out of the note's images
  //   (collected from page.mediaOcr), newline-joined. Lets a note that only
  //   holds a scanned image be found by the words inside it (searchNotes
  //   includes this field).
  //   Absent → undefined (no image read yet, or none produced text).
  ocrText?: string;
};
```

### 5.1 `INDEX_SCHEMA_VERSION`

Defined in `src/features/navigation/index-file.ts`. Currently **25**.
Bumping rules:

| Version | Change |
|---|---|
| **4** | Added `source`, `wikiKind`. |
| **5** | Added `author`, `model`. |
| **6** | Labels normalized to internal keys (`procedure` / `material` / …). |
| **8** | Added `inlineLabelTypes` for label-filter UI (Phase D-3-α). |
| **9** | Replaced `inlineLabelTypes` with `inlineLabels` (richer, includes `text` and `entityId`). |
| **10** | Added `deletedAt` for trash. |
| **11** | Added `atom` to `WikiKind`. |
| **12** | Added `archivedAt` for soft-archive on auto-merge (preserves references that would otherwise dangle). |
| **13** | Added `claimRole` / `atomType` / `synthesisMode` / `hypothesisStatus` mirrors from `wikiMeta` (Phase 1 semantic types). |
| **14** | Renamed `WikiKind` value `"concept"` to `"claim"`. The on-disk migration (`migrateConceptKindToClaim` in `document-migration.ts`) also moves `derivedFromConcepts` → `derivedFromClaims` and `conceptRole` → `claimRole` in `wikiMeta`. |
| **15** | Added `epistemicStatus` (`speculation` / `interpretation` / `observation` / `established`) mirror from `wikiMeta` (Phase η). Existing entries are missing the field; `ensureIndex` rebuilds the index on the bump so Ingester / Atomizer outputs from this point forward populate it. The downstream Atomizer enforces lowest-status inheritance and the Synthesizer forces `hypothesisStatus: "speculative"` whenever any input carries `epistemicStatus: "speculation"` — see `docs/ARCHITECTURE.md` §3.3. |
| **16** | Added Toulmin extension mirrors from `wikiMeta` (Phase γ): `rebuttalConditions` (Claim and Atom), `backing` (Claim only), `modalQualifier` (Claim only). Atom-side `rebuttalConditions` only carries a value when the upstream Atomizer's propagation rule (2+ source Claims share a rebuttal) fired. The Synthesis router uses Atom-side `rebuttalConditions` to add `dialectic` to the candidate mode set even when the `causal` ≥ 2 trigger is not met — Toulmin rebuttals are first-class regime separators. |
| **17** | Added `relatedAtoms` (Phase δ — Atom-to-Atom dimensional relations, axial coding). Fixed `relationType` vocabulary (`extends` / `is-special-case-of` / `shares-mechanism` / `shares-precondition` / `contradicts` / `applies-to-different-domain`), 0–3 entries with a `citation` short sentence each. Mirrored from `wikiMeta.relatedAtoms` for list-view badging and Synthesizer pair selection. Existing pre-Phase-δ entries stay readable with the field undefined (back-compat). |
| **18** | Added `meta-atom` to `WikiKind` and `derivedFromAtoms` mirror (Phase ε — KJ-style mid-cluster + headline). Withdrawn at v19. |
| **19** | Withdrew Phase ε. Removed `"meta-atom"` from `WikiKind` and the `derivedFromAtoms` mirror. LLM-driven axis invention proved unreliable (outputs collapsed to the source domain even at Anthropic Opus). Existing meta-atom JSON files on disk are tolerated by `ensureIndex` — their wiki kind falls outside the new enum and the index entry is rebuilt as a regular note-less placeholder until the user trashes it. The replacement is a human-provided theme threaded through the Synthesizer, landing in a follow-up PR. |
| **20** | Added `theme` mirror on `NoteIndexEntry` for `synthesis` docs (theme-driven Synthesizer, 2026-05-23). `wikiMeta.theme` is a free-form lens string (e.g. "home cooking") that the user supplies when triggering Synthesis Discovery; the prompt re-casts the connection in that theme's vocabulary. Stays orthogonal to `synthesisMode`. Legacy syntheses keep `theme: undefined` and `ensureIndex` rebuilds without losing them. |
| **21** | Added `noteContexts` mirror on `NoteIndexEntry` — user-assigned, note-level context labels (free-form categories the user attaches by hand, e.g. "eureco" / "philosophy"). Mirrored from `GraphiumDocument.noteContexts` (normalised: trimmed, empty-dropped, de-duped case-insensitively). Powers the note-list "Context" column display and column-header filter; orthogonal to PROV block labels and to the Synthesis-only `theme`. Legacy notes keep `noteContexts: undefined` (treated as "uncategorised") and `ensureIndex` rebuilds on the bump without touching note JSON. Intended to later scope AI context retrieval to a chosen context. |
| **22** | Added `ocrText` mirror on `NoteIndexEntry` — the concatenated, newline-joined text read on-device out of the note's images, collected from `page.mediaOcr` in `buildIndexEntry` and included in `searchNotes`, so a note holding only a scanned image is findable by the words inside it. Legacy notes keep `ocrText: undefined` and `ensureIndex` rebuilds on the bump without touching note JSON. |
| **23** | Added `steps` on `NoteIndexEntry` — the titles of `step` container blocks, collected in document order (including steps nested inside another step). `headings` is typed `level: 2 \| 3` and cannot carry a step, so steps get their own field. Headings written *inside* a step are still collected into `headings` so the outline does not lose them. Notes that use no step keep `steps: undefined`, and `ensureIndex` rebuilds on the bump without touching note JSON. |
| **24** | Outline collection treats multi-column blocks (`columnList` / `column`) as transparent layout wrappers — headings and steps placed inside a column are collected as if they were top-level, so they appear in the outline and in search. No `NoteIndexEntry` field changed; the bump exists because the collection logic changed and column-using notes need a rebuild to be indexed correctly. Notes without columns produce identical entries. |
| **25** | `extractBlockText` now yields the `cachedTitle` / `fileName` snapshot of `sharedCitation` blocks (§7.5), so a note is findable by the title of the shared entry it cites. No `NoteIndexEntry` field changed; citation-using notes need a rebuild to pick up the searchable text. |

When a stored index has a version below the current one, `ensureIndex`
**rebuilds the entire index** by re-reading every note. This is the
escape hatch: any indexer logic change can ship behind a version bump
without writing a per-version migration.

### 5.2 Trash and archive semantics

Two orthogonal flags partition entries into a tri-state: **active** /
**archived** / **trashed**. Files on disk are never moved or deleted by
either flag — the file path stays the same so any link or
`derivedFromNotes` reference keeps resolving through `loadDoc`.

| State | Flag | Meaning | List/search/graph | Citation/regenerate |
|---|---|---|---|---|
| active | (neither) | normal | shown | resolve |
| archived | `archivedAt` | retired from the list but kept resolvable. Set either by the user (note header menu → Archive, when retiring a note whose derived versions should keep working) or by the system (auto-merge absorbing a Claim into another) | hidden | resolve |
| trashed | `deletedAt` | user delete intent | hidden | not resolved |

The "hidden" column covers list, search, graphs, and the citation picker.
A note can still be *reached* while archived or trashed, though: a stale
inline link, `@mention`, or index-table cell that predates the state change
still points at the (soft-deleted) file. Opening a note in either state
renders it **read-only** with a banner — an archive banner offering
"Restore from archive", or a trash banner offering "Restore from trash" —
so a lingering link never lets the user silently edit a note they thought
was retired or deleted. This is a UI guard, not resolution: the trashed
note is still "not resolved" for citations and regenerate.

Transitions:

- **active → trashed** via the trash action (manual).
- **active → archived** via the archive action (manual, note header
  menu) when the user wants to retire a note from the list while keeping
  its derivation links and citations alive — or via auto-merge (the
  absorbed Claim is archived, not deleted, so notes that cited it keep
  working). Unlike trash, archiving never warns about incoming
  references, since preserving them is the whole point.
- **archived → active** via the restore action. Note that a Claim
  archived by auto-merge will likely be re-archived on the next merge
  cycle unless the user edits its content to differentiate it.
- **archived → trashed** via the "Send to trash" action.
- **trashed → active** via restore.
- **trashed → gone** via permanent delete (removes the file and the
  index entry). There is no path from archived directly to permanent
  delete — archived items must pass through trash first.

`updateIndexEntry` and the wiki rebuild step both preserve `archivedAt`
and `deletedAt` on existing entries, so a save or a refresh will not
silently strip the flag.

## 6. Storage providers

### 6.1 The `StorageProvider` interface

A single TypeScript interface defines what every backend must do.
Defined in `src/lib/storage/types.ts`. The methods cluster into:

- **Auth** — `init`, `signIn`, `signOut`, `getAuthState`,
  `onAuthChange`.
- **File CRUD** — `listFiles`, `loadFile`, `createFile`, `saveFile`,
  `deleteFile`. Files are `GraphiumDocument` blobs.
- **Media** — `uploadMedia`, `getMediaBlobUrl`, `extractFileId`.
  Optional `saveMediaText?` / `loadMediaText?` persist plain source text
  (e.g. a URL's Reader-extracted original, before any LLM processing) as a
  separate channel from binary media, keyed by a caller-issued fileId that
  `GraphiumDocument.sourceTextFileId` points to.
- **Metadata** — `getUserEmail`, `getRevisionId?`.
- **App data** (optional) — `readAppData`, `writeAppData`. Used by the
  index file, manual version snapshots (`snapshot-index:<noteId>` /
  `snapshot:<snapshotId>`, see §2.4), material-scoped AI chats
  (`asset-chats:<fileId>`, see §2.5), and other internal metadata.
- **Knowledge / Skill CRUD** (optional) — separate listings for Knowledge and
  Skill documents so backends can store them in dedicated namespaces.

Three backends ship today:

| Provider | File location |
|---|---|
| `local` | IndexedDB (browser) |
| `filesystem` | OPFS in browser; native filesystem via Tauri |
| `server-fs` | Filesystem on the Node companion server |

Settings → Storage offers a provider-agnostic export built on `listFiles` /
`loadFile`: all notes as a zip of Markdown files, or a raw backup zip of
`.graphium.json` blobs (notes, knowledge, and skill documents — including
archived and trashed ones). The JSON backup is the supported data exit for
`local` (IndexedDB) users; media binaries are not included.

### 6.2 IndexedDB layout (`local` provider)

```
DB:    graphium-local
Vers:  1

Stores:
  files   (keyPath: "id")   — { id, name, content: GraphiumDocument, modifiedTime, createdTime }
  media   (keyPath: "id")   — { id, name, mimeType, blob, createdTime }
                            — saveMediaText adds text records { id, textContent, mimeType, createdTime } (no blob)
```

The DB version has stayed at 1 since launch. Adding a store or changing
keys requires bumping the version and writing an `onupgradeneeded`
migration; do not silently change the layout.

### 6.3 Filesystem layout (`filesystem` / `server-fs`)

Roughly:

```
Graphium/
├── notes/
│   └── <noteId>.graphium.json
├── wiki/
│   └── <wikiId>.graphium.json
├── skills/
│   └── <skillId>.graphium.json
├── media/
│   ├── <fileId>.<ext>         # media binary, stored byte-for-byte as uploaded
│   └── <fileId>.meta.json     # sidecar: original filename, mimeType, createdTime
├── media-text/
│   └── <fileId>.txt          # persisted URL source text (B-persist)
└── appdata/
    ├── note-index.json             # the GraphiumIndex
    └── asset-chats:<fileId>.json   # AI chats started from a material (§2.5)
```

Media binaries keep their original file extension (derived from the
uploaded filename, falling back to the MIME type) so the `media/`
folder stays usable outside Graphium — a JPEG is a plain `.jpg` file
you can open directly. Files saved by older desktop builds
(≤ v0.18.x) had no extension; on startup the desktop app renames them
in place using the `.meta.json` sidecar, and readers still resolve the
extensionless form as a fallback.

Concrete paths and naming may vary between provider implementations;
treat the layout above as a guide, and `local.ts` /
`filesystem.ts` / `server-fs.ts` as authoritative.

### 6.4 Server-side data directory (Node / Tauri sidecar)

When a Node server runs (desktop sidecar or self-hosted Docker), it
keeps its own state under `data/` (dev mode where the current working
directory is writable) or under the OS-specific application data
directory on packaged desktop builds:

| Platform | Default path |
|---|---|
| macOS | `~/Library/Application Support/com.graphium.app/server-data/` |
| Windows | `%APPDATA%\com.graphium.app\server-data\` |
| Linux | `$XDG_DATA_HOME/com.graphium.app/server-data/` (fallback: `~/.local/share/com.graphium.app/server-data/`) |

Earlier desktop builds (≤ v0.12.0) stored this state under
`~/Documents/Graphium/server-data/`. On the first launch of a newer
build, the sidecar copies `models.json`, `profiles.json`, and the
`usage/` directory from that legacy path into the new location if the
new path does not already contain them. The legacy files are left in
place so they remain available for manual recovery. The move was
forced by macOS Sequoia's TCC: a sandboxed sidecar spawned by Tauri
cannot reliably read files under `~/Documents/`, but the Application
Support directory is exempt from that prompt.

The schemas:

| File | Purpose |
|---|---|
| `models.json` | Registered LLM models (`ModelConfig[]`). On Tauri builds API keys live in Keychain instead; `models.json` only stores metadata. The optional `rate` field carries pricing (`{ input, output, cacheRead?, cacheWrite?, currency: "usd" | "jpy" }`); USD is the default if `currency` is omitted. |
| `profiles.json` | Agent profiles (system prompts). |
| `ai-usage-log.json` | Raw AI usage events for the last 90 days. Each entry: `{ ts, feature, provider, modelId, modelConfigId?, inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reasoningTokens?, totalTokens, durationMs?, rateSnapshot?, cost?, costCurrency? }`. The `feature` field identifies the calling pipeline (`wiki.ingest`, `wiki.lint`, `agent.chat`, `prov.from-url`, `embedding`, …). The legacy `costUsd` field is still tolerated when reading older logs. |
| `ai-usage-summary.json` | Monthly aggregates kept indefinitely. On server boot, events older than 90 days in `ai-usage-log.json` are folded into this file (`{ month: "YYYY-MM", feature, provider, modelId, callCount, inputTokens, outputTokens, …, costByCurrency }`) and removed from the raw log. `costByCurrency` is a partial map keyed by currency (`{ usd: 1.23, jpy: 184.5 }`) so USD-billed and JPY-billed models can coexist. |

`rateSnapshot`, `cost`, and `costCurrency` are populated when the
calling model has a `rate` configured (Settings → AI → per-model
Pricing). The snapshot is written at call time so price changes do
not *automatically* rewrite historical costs. To fix a mistyped price,
the user can trigger `POST /api/usage/recalculate` (the "Recalculate
cost" button on the Usage tab): it rewrites `rateSnapshot` / `cost` /
`costCurrency` for every raw event that resolves to a registered model —
first by `modelConfigId`, then by `provider`+`modelId` (header-injected
calls store a placeholder `modelConfigId`, so model name is the reliable
key) — using that model's current `rate`. Token counts are preserved;
events with no matching priced model are skipped, and the monthly
summary (older than 90 days) is left as-is.
The Usage tab converts to the user's chosen display currency at render
time using the `displayCurrency` / `usdJpyRate` settings persisted in
localStorage.

## 7. Shared storage and Library

The Library / Fork features run on a separate, content-addressed
abstraction that lives alongside (not under) `StorageProvider`. Defined
in `src/lib/storage/shared/types.ts`.

### 7.1 `SharedEntry`

```ts
type SharedEntryType =
  | "note" | "reference" | "data-manifest"
  | "template" | "claim" | "atom" | "report";

type SharedEntry = {
  id: string;                  // uuidv7
  type: SharedEntryType;
  author: AuthorIdentity;
  created_at: string;
  updated_at: string;
  hash: string;                // SHA-256 of body + meta (excluding hash itself)

  prov: {
    derived_from: string[];    // lineage within the shared pack
    local_origin?: string;     // informational only — origin in personal storage
  };

  history?: HistoryEntry[];    // hash log for minor revisions on same id
  version?: number;
  supersedes?: string;         // major-revision predecessor
  superseded_by?: string;
  attestations?: Attestation[];

  status?: "active" | "unshared";
  unshared_at?: string;
  unshared_by?: AuthorIdentity;

  extra?: Record<string, unknown>;  // type-specific narrowing
};
```

Key model choices:

- **`id` is uuidv7** (sortable, monotonic, content-independent).
  Persists across edits.
- **`hash` is content-addressed** over body + metadata (excluding hash,
  history, and `superseded_by` to avoid self-reference).
- **Minor vs major revision** — same-`id` writes append to `history`;
  major changes mint a new id and link back via `supersedes`.
- **Tombstones, not deletes** — `status: "unshared"` is the recovery
  path for accidental sharing. Hard delete is provider-optional.

### 7.2 `BlobRef`

Large binary content (images, datasets) is referenced, not embedded.

```ts
type BlobRef = {
  provider: string;            // "local-folder" | "s3" | "zenodo" | …
  uri: string;                 // file:///… , s3://… , zenodo://record/file
  hash: string;                // SHA-256
  size: number;
  filename?: string;
};
```

A single shared note can reference blobs from multiple providers (e.g.,
embedded media on a NAS, dataset on Zenodo).

### 7.3 Provider interfaces

Two interfaces, two axes of swap:

- **`SharedStorageProvider`** for shared text/metadata. v1 ships with
  `local-folder` only.
- **`BlobStorageProvider`** for binary blobs. Same providers may
  implement both (`local-folder`).

Both expose `verifyHash(id)` so a reader can independently check
content integrity.

### 7.4 Note-side references

A personal note that has been shared carries `sharedRef`:

```ts
sharedRef?: {
  id: string;       // SharedEntry.id
  type: "note";
  sharedAt: string; // ISO 8601
  hash: string;     // SharedEntry.hash at share time
};
```

A note created by forking a shared entry carries `forkedFrom`:

```ts
forkedFrom?: {
  sharedId: string;
  hash: string;
  authorName: string;
  authorEmail: string;
  forkedAt: string;
};
```

The fork is treated as a separate identity from the original; PROV
records the lineage between them.

### 7.5 Citation block (`sharedCitation`)

A note can cite a shared entry inline through the `sharedCitation`
custom block (`src/blocks/shared-citation/`). The block stores a
*reference plus a display snapshot* — never the body:

```ts
props: {
  sharedId: string;        // SharedEntry.id (uuidv7)
  citedHash: string;       // SharedEntry.hash last seen (advances on minor follow)
  entryType: string;       // SharedEntryType
  citedAt: string;         // ISO 8601 — first citation time, never updated
  // display snapshot: lets the card render without the shared root
  cachedTitle: string;
  cachedAuthor: string;
  cachedUpdatedAt: string;
  citedVersion: number;
  fileName: string;        // data-manifest only
  fileSizeLabel: string;
}
```

Render-time resolution (`src/blocks/shared-citation/resolve.ts`)
produces one of:

| Status | Meaning |
|---|---|
| `verified` | Entry read OK and `verifyHash` passes — the shared side is intact. |
| `mismatch` | Manifest hash no longer matches the stored body (corruption or an edit made outside Graphium). |
| `offline` | Web build, no shared root configured, or root unreachable (`shared_root_exists` fails) — the card renders from the snapshot. |
| `missing` | Root reachable but the entry is absent or an `unshared` tombstone. |

Minor updates (same id, new hash) are followed silently: the snapshot
props and `citedHash` advance in place. Major revisions
(`superseded_by`) are **not** followed — the card keeps pointing at the
cited version and shows a "newer version" banner linking to the
successor.

Provenance: when a save introduces a citation absent from the previous
save, that revision's `EditActivity.used` gains a `shared:<sharedId>`
source (the `shared:` prefix is registered in
`src/features/network-graph/external-source.ts`), which the
PROV-JSON-LD export resolves to a typed external entity. SidePeek saves
bypass revision recording by design, so citations inserted there are
not attributed to an edit activity.

## 8. Compatibility rules

Hard rules for changing any schema in this document.

| If you change | You must |
|---|---|
| `GraphiumDocument` (add field) | Make the field `optional`. No other action. |
| `GraphiumDocument` (rename / remove / retype) | Bump `version`, write a migration in `src/lib/document-migration.ts`. |
| `GraphiumPage` shape | Same as `GraphiumDocument`. |
| `WikiMeta` shape | Same as `GraphiumDocument`. New optional fields are free. |
| `NoteIndexEntry` / `GraphiumIndex` shape | Bump `INDEX_SCHEMA_VERSION` in `src/features/navigation/index-file.ts`. The index will be auto-rebuilt on mismatch — no per-field migration needed. |
| `StorageProvider` interface | Update all three providers (`local`, `filesystem`, `server-fs`). Prefer optional methods for additive changes. |
| IndexedDB stores or keys | Bump `DB_VERSION` in `local.ts` and write an `onupgradeneeded` migration. Do not silently change the layout. |
| `SharedEntry` / `BlobRef` shape | Bump the provider's stored format if needed; `verifyHash` must keep working against existing data. |
| Tauri command signatures | Update the matching TypeScript wrappers in lockstep. |

These rules are also captured in the project's `CLAUDE.md` "破壊的変更
チェック" section.

### Side stores and older builds

The annotation side stores (`tableMeta`, `mediaInlineLabels`, `mediaOcr`,
`blockAlignments`) are Graphium's own layer over *standard* BlockNote blocks. A
build that predates a given side store does not know its field, so opening and
saving a note in that build drops those annotations — the blocks themselves are
untouched, because the data that matters lives in the cells.

`tableMeta` superseded `indexTables` / `logTables` exactly this way: writers emit
only the new field, so a note saved by a current build loses its timestamp and
row-to-note behavior if an older build writes it back. Ship a change like this
with a release note telling users to update every device they sync from.

After any compatibility-affecting change, the verification ritual is:

```bash
pnpm exec tsc -p tsconfig.json --noEmit   # type check
pnpm vitest run                            # tests
pnpm build                                 # bundle
```

If `INDEX_SCHEMA_VERSION` was bumped, also run the app once and confirm
that an existing `appdata/note-index.json` rebuilds without errors.

---

## See also

- [CONCEPT.md](./CONCEPT.md): the design philosophy
- [ARCHITECTURE.md](./ARCHITECTURE.md): layers and components
- [README](../README.md): install and run
