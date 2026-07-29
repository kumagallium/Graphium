# Labels & provenance

This is the heart of Graphium. By marking the inputs, tools, parameters, and outputs of your work as you write, you turn an ordinary note into a machine-readable record of *how* a result came to be — a provenance graph built on the W3C PROV-DM standard. This page covers the labels themselves, the graph they produce, the note's own edit history, version snapshots, derived notes, and the bigger graph views that connect notes together.

The philosophy fits in two lines:

- **Labels are always optional.** A note without a single label is a perfectly good note.
- **The graph only shows what you chose to mark.** Nothing is inferred behind your back — every node traces back to a highlight you made.

## Where labels live: step blocks

Labels describe *what happened inside a procedure step*, so they live inside [step blocks](/notes-and-editor#the-step-block) <Badge type="tip" text="Added in v0.23.0 (2026-07-28)" />. A step block is a container you insert from the slash menu (**Step**, in the **Advanced** group). One step = one activity; the step's title is the activity's name.

Because a label needs a step to attach to, the labeling UI only appears while you are working inside a step. Outside of steps, Graphium stays a plain, quiet editor.

## Inline labels

Select a span of text inside a step's body and a second row appears on the formatting toolbar with four label buttons. Each button carries its keyboard shortcut as a small keycap.

| Label | What it marks | Shortcut |
|---|---|---|
| **Input** | Something the step consumed — a sample, a dataset, a reagent | `⌘⇧I` (`Ctrl+Shift+I` on Windows/Linux) |
| **Tool** | The instrument or software used | `⌘⇧E` (`Ctrl+Shift+E`) |
| **Parameter** | A setting or condition — temperature, duration, concentration | `⌘⇧P` (`Ctrl+Shift+P`) |
| **Output** | What the step produced | `⌘⇧O` (`Ctrl+Shift+O`) |

(The **Tool** shortcut uses E — think *equipment* — because `⌘⇧T` is taken by the browser.)

![The selection toolbar's label row, with the keyboard shortcut for each label](/screenshots/label-shortcut-keycaps.png)

A few rules about where inline labels work:

- **Step body only.** Step titles name the activity itself, so they can't carry entity labels.
- **Not inside table cells.** To bring a table into the graph, label the whole table instead (see below).
- **Removing is always allowed**, even outside a step: select the highlighted text and click the same label button (or press its shortcut) again to toggle it off. You can also click the small label badge on a labeled block and choose **Remove label**.

Clicking an existing highlight opens a **Link & merge** popover, where you can merge two highlights that refer to the same thing or change which entity a highlight binds to. Most of the time you won't need it — the defaults do the right thing.

### Labeling a whole media block

Images, videos, audio, files, and PDFs can carry a label as a whole block — "this photo *is* the output of this step." Click the media block to select it and the same four label buttons appear on its toolbar (without keycaps — the shortcuts apply to text selections only). The block becomes a single entity in the graph.

## Context labels on tables and media

The drag handle (⠿) menu offers a **Label** submenu for tables and media blocks — the same four labels, applied at block level:

- On a **table**, the hint reads **Each row → one Entity**: every row becomes its own entity, which is why per-cell inline labels are unnecessary.
- On a **media block**, the hint reads **Whole block = one Entity** — equivalent to labeling it from the toolbar.

![The Label submenu in the drag-handle menu](/screenshots/label-dropdown.png)

As with inline labels, new context labels can only be applied inside a step; existing ones can be changed or removed anywhere. Clicking a label in the menu again removes it.

::: info Legacy heading labels
Older Graphium notes marked procedure steps by labeling headings with **Step**, **Plan**, or **Result**. Step blocks replaced that style, so there is no way to add these labels to a fresh heading — but headings that already carry one still show the **Label** submenu so you can change or remove them.
:::

### Renaming labels

If "Input / Tool / Parameter / Output" doesn't match your field's vocabulary, rename them: [Settings](/settings) → **Display & Language** → **Provenance label names**. Your custom names appear everywhere (toolbar, graph legend, badges), the underlying PROV-DM role stays standard, and **Reset to defaults** brings the originals back.

## The provenance graph panel

Once a note has at least one step or label, a **Steps** tab appears in the right-hand panel. Open it and you'll see the provenance graph, which regenerates automatically about half a second after every edit — there is no "generate" button to press.

![A note with its provenance graph in the right panel](/screenshots/editor-with-graph_en.png)

What you're looking at:

| Element | Meaning |
|---|---|
| Circle node | A step (a PROV *Activity*) |
| Square / diamond nodes | Entities — **Input**, **Output**, **Parameter** (squares) and **Tool** (diamond), colored to match their highlights |
| Green edge (`used`) | The step consumed this entity |
| Red edge (`wasGeneratedBy`) | This entity was produced by the step |
| Blue edge (`wasInformedBy`) | This step followed another step |

**Repeated referents collapse into one node.** If step B's **Input** text matches step A's **Output** text (and B is linked to A as its next step), Graphium unifies them: "the powder A produced" and "the powder B used" become a single entity, and the chain reads continuously across steps.

The panel has two views, and an expand button (**Expand view**) for a full-screen look:

- **Steps (all)** — the complete graph: steps plus every labeled entity.
- **Steps (only)** — just the steps and their order. This view is also an editor: as the hint says, **Drag the blue dot under a step onto another step to connect them**. Connections you draw here are the same prior-step links you can set in a step's header (**Prev step** / **Next step**), and **Delete link** removes ones you added. Cycles are blocked.

## Exporting PROV-JSON-LD

The note menu (the **⋯** button at the top right of the editor) includes **PROV-JSON-LD**. It downloads the current note's provenance graph as a `.jsonld` file following the W3C PROV-JSON-LD serialization — readable by standard provenance tools outside Graphium.

The export is scoped to the current note. It includes the labeled steps and entities, the note's edit-history agents (human and AI), and any [Knowledge layer](/knowledge-layer) entries derived from the note. The menu item is disabled while the note has no provenance data.

## The note's own history

Provenance has a second axis: not just "how was the result made," but "how was the *note* made." The **History** tab in the right panel records every save — what changed (blocks, labels) and who did it. Human edits carry the name and email from your author profile ([Settings](/settings) → **Storage**); AI edits carry an "AI" badge and the model that made them, with entry types like **Edit**, **Derive**, **AI Generate**, and **Template**.

![The history panel with revisions and versions](/screenshots/history.png)

### Version snapshots <Badge type="tip" text="Added in v0.18.0 (2026-07-15)" />

Automatic history is fine-grained; sometimes you want to pin a moment on purpose — "the state we submitted." Press `⌘⇧S` (`Ctrl+Shift+S` on Windows/Linux; `⌘⌥S` works too, for keyboards where `⌘⇧S` is taken) or click **Save version** at the top of the **History** tab.

Saved versions are listed in the same panel. Each one offers:

| Action | What it does |
|---|---|
| **Open** | View the version side-by-side, marked **Read-only** |
| **Fork from here** | Create a new note from this version, with lineage back to the original |
| **Rename** | Give the version a meaningful name |
| **Delete** | Remove the version (the note itself is untouched) |

## Derived notes

When a new experiment builds on an old one, don't copy-paste — derive. The note menu (**⋯**) has **Derive whole note**, and the drag handle (⠿) menu has **Derive new page** for branching from a single block. The copy opens as a new note carrying a **Derived note** banner with a **Source note** link back to the original, and the derivation is recorded in both notes' histories and in the lineage graph.

## Turning a URL, PDF, or Word file into a pre-labeled note

If the procedure already exists — a synthesis section of a paper, a protocol on the web — AI can do the labeling pass for you. In the sidebar's **Materials** section (your [materials](/materials-and-citations) gallery), open the action menu on a URL, PDF, or Word material and choose **Extract steps into a note**. Select several materials and the same action appears as a bulk button.

Graphium reads the source, splits it into step blocks, applies **Input** / **Tool** / **Parameter** / **Output** highlights, links the steps in order, and records the source material in the note's lineage. A toast tracks progress, and the result is a normal note — review the labels and edit anything the AI got wrong. This requires a [configured AI model](/ai-setup).

## Graph views beyond one note

Labels and links also feed graphs that span your whole workspace:

![The network graph view](/screenshots/network-graph.png)

- **Neighbors** — in the right panel's **Graph** tab: the current note and everything linked within two hops.
- **Lineage** — the second sub-tab of **Graph**: a tree of the current note's upstream sources — the notes, materials, and versions it was derived from.
- **Global Graph** <Badge type="tip" text="Added in v0.16.5 (2026-06-29)" /> — in the sidebar: every note at once, layered as **Sources**, **Notes**, and **Claim · Insight** ([Knowledge layer](/knowledge-layer) entries), with edges for **Derived**, **Used**, and **Reference** relations. Toggle **Hide references** or **Show isolated**, color nodes by type or context, and **Group by context** to pull related notes into clusters.
- **Activity graph editor** — the **Steps (only)** view described [above](#the-provenance-graph-panel), where the step order itself can be rewired by dragging.

Together these answer the question labels exist for: not just "what did I write," but "where did this come from, and what did it lead to."
