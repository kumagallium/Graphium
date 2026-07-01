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

  // ── external source ─────────────────────────────────
  // Set when the note was generated from an external URL (URL-to-PROV)
  sourceUrl?: string;
  sourceFetchedAt?: string;
  sourceTitle?: string;
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

  // ── reference table feature ─────────────────────────
  indexTables?: Record<string, Record<string, string>>;  // tableBlockId → (sampleName → noteId)

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
};
```

### 2.3 PROV-DM label model

PROV-DM information attaches to blocks in three places:

| Carrier | What it labels | Field |
|---|---|---|
| **Block label (`#`)** | On headings: the role of the block in a process — PROV *Activity* (step) or *Phase* grouping. On **table blocks**: a `material` / `tool` / `output` *structured-table* marker, or `attribute` for a *parameter table* (see below). | `page.labels[blockId]` |
| **Inline highlight** | Spans of text inside a block as PROV *Entity* (with `material` / `tool` / `output` subtypes) or as a *Property* (`attribute`) on the parent. | `page.highlights[]` |
| **Media inline label** | Same as above but for non-text blocks (image / video / audio / pdf / file) where BlockNote inline styles do not apply. | `page.mediaInlineLabels[blockId]` |

**Structured tables.** A table is a block whose cells are atomic values,
so inline highlights do not apply inside cells (the formatting toolbar
hides the entity-label buttons there). Instead the **whole table** may
carry a `material` / `tool` / `output` block label via the `#` affordance.
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

The generator (`src/features/prov-generator/`) consumes both label
sources and the heading structure to produce the PROV-DM graph. Heading
levels feed a `scopeStack` that infers Activity containment without
requiring the user to nest blocks.

#### Plan / Execution phase

`[Plan]` and `[Result]` headings live *inside* a Step. They do not
create new Activities — the surrounding `[Step]` Activity remains the
sole Activity for both phases. Instead, they switch a *phase context*
over the inline Entities under them:

- Each Entity node carries a `graphium:phase` property — `"plan"` for
  Entities under a `[Plan]` heading, `"execution"` otherwise.
- Plan-phase Entities are emitted with an `_plan` suffix in their
  `@id` so they coexist as distinct nodes alongside their execution
  counterparts (e.g. `inline_material_ent_nacl_plan` vs
  `inline_material_ent_nacl`).
- When the same `(label, entityId)` pair appears in both phases, the
  generator emits a `prov:wasDerivedFrom` edge from the execution
  Entity to the plan Entity, expressing that the actual outcome was
  derived from the planned intent. The Step Activity that both
  Entities are `prov:used` by serves as the implicit activity of the
  PROV-DM derivation's full form.

The `prov:Plan` class itself is intentionally *not* applied to
individual plan-phase Entities; in PROV-DM `prov:Plan` denotes the
plan document an agent follows as a whole, not the individual
materials/tools/parameters within it. The `graphium:phase` attribute
preserves the planned-vs-executed distinction without misusing that
class.

### 2.4 Document provenance (edit log)

`documentProvenance` is a separate concern from the PROV-DM graph above.
It records the *edit history of the note itself* — who edited what,
when, with which agent (`human` / `ai`). Defined in
`src/features/document-provenance/types.ts`.

This is intentionally not unified with the PROV-DM graph. The graph
describes *the world the note talks about*; the edit log describes *the
note as an artifact*. See [ARCHITECTURE.md §3.2](./ARCHITECTURE.md#32-provenance-layer-prov-dm).

The revision log is **uncapped**. Every save appends a `RevisionEntity`
(hash + activity + timestamps) and the entry is kept indefinitely;
provenance is the core promise of Graphium, so silently dropping old
revisions would contradict it. Each entry is small (a few hundred bytes
of metadata, no content snapshot), so the file size grows roughly
linearly in number of saves. If this becomes a measured problem,
preferred mitigations are content-hash deduplication or
user-controlled pruning, not silent truncation.

### 2.5 Conversational layer

```ts
type ScopeChat = {
  id: string;
  scopeBlockId: string;
  scopeType: "heading" | "block" | "page";
  messages: { role: "user" | "assistant"; content: string; timestamp: string }[];
  generatedBy?: { agent; sessionId; model?; tokenUsage? };
  createdAt: string;
  modifiedAt: string;
};
```

Chats are anchored to a scope (a heading, block, or page) so they can be
re-attached to the same context after edits.

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
  shape?: AtomShape;              // Atom only. Relationship-shape (structure-mapping axis).
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
type AtomShape =
  | "monotonic-increase" | "monotonic-decrease" | "optimal-middle" | "threshold"
  | "trade-off" | "enabling-condition" | "composition-structure" | "other";

// Cross-domain analogy. The atomizer proposes a candidate; a skeptical judge keeps it
// only when the example instances the SAME shape + role-structure. Absent if forced/none.
type AtomTransfer = { field: string; example: string };

// UI surfacing: only `shape` is shown, and only in the detail view's context drawer
// (alongside world-grounding / derived-from), as understated text rather than a badge.
// `transfer` is generated and stored but intentionally NOT surfaced — spotting where an
// Atom transfers to another field is the user's creative work, and pre-filling it would
// anchor the reader (it is reserved for a future human-triggered "Idea" layer). `shape`
// is read directly from the full `WikiMeta`, so nothing is mirrored into
// `WikiMetaSummary` / `NoteIndexEntry` and `INDEX_SCHEMA_VERSION` is unchanged.

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
- **`status`** (mostly for `principle`):
  - `candidate` — supported by one note. Included in retrieval but
    rendered dimly in UI.
  - `verified` — supported by two or more notes. Treated as a principle
    the user repeatedly relies on.

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
| `shape` | Atom | monotonic-increase, monotonic-decrease, optimal-middle, threshold, trade-off, enabling-condition, composition-structure, other (structure-mapping axis; the atomizer classifies into this) |
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

The Settings → Grounding KB tab now exposes per-entry deletion for
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
};
```

Skills inherit storage / index treatment from notes; the `source` field
discriminates them downstream.

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
};
```

### 5.1 `INDEX_SCHEMA_VERSION`

Defined in `src/features/navigation/index-file.ts`. Currently **20**.
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
- **Metadata** — `getUserEmail`, `getRevisionId?`.
- **App data** (optional) — `readAppData`, `writeAppData`. Used by the
  index file and other internal metadata.
- **Knowledge / Skill CRUD** (optional) — separate listings for Knowledge and
  Skill documents so backends can store them in dedicated namespaces.

Three backends ship today:

| Provider | File location |
|---|---|
| `local` | IndexedDB (browser) |
| `filesystem` | OPFS in browser; native filesystem via Tauri |
| `server-fs` | Filesystem on the Node companion server |

### 6.2 IndexedDB layout (`local` provider)

```
DB:    graphium-local
Vers:  1

Stores:
  files   (keyPath: "id")   — { id, name, content: GraphiumDocument, modifiedTime, createdTime }
  media   (keyPath: "id")   — { id, name, mimeType, blob, createdTime }
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
│   └── <fileId>.<ext>
└── appdata/
    └── note-index.json        # the GraphiumIndex
```

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
