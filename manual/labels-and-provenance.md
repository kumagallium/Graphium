# Labels & provenance

This is the heart of Graphium. By splitting what you did into steps and marking the inputs, tools, parameters, and outputs inside them, you turn an ordinary note into a machine-readable record of *how* a result came to be — a provenance graph built on the W3C PROV-DM standard. This page covers step blocks, the labels, the graph they produce, standards export, derived notes, and the bigger graph views that connect notes together.

The philosophy fits in two lines:

- **Steps and labels are always optional.** A note without a single one is a perfectly good note — see [Notes & editor](/notes-and-editor) for everyday writing.
- **The graph only shows what you chose to mark.** Nothing is inferred behind your back — every node traces back to something you marked.

## Step blocks <Badge type="tip" text="Added in v0.23.0 (2026-07-28)" />

A step block is the editor's only container: it holds the text, tables, and images that belong to one action, and each step becomes an *Activity* in the graph. Insert one from the slash menu (**Step**, in the **Advanced** group). New steps are titled **Step 1**, **Step 2**, … automatically, and the title is the activity's name.

![A step block with a Prev step chip in the header and a Next step chip at the bottom](/screenshots/step-block.png)

- The **Prev step** chip in the header links this step to the one it follows. It lists **Steps** first; a step that has outputs opens its **Outputs** behind a chevron. Picking an output also records the handoff in the text (the same-named input is added to this step, and the graph draws a solid edge). Choose **Without a specific output** when you only mean "this came after that". Loops are refused ("Blocked: this would create a cycle").
- The **Next step** chip at the bottom jumps ahead: with no successor it creates one (**Create new**) pre-linked to the current step; with successors it opens a picker to link, unlink, or add.

Chaining steps gives you the run order for free — that order becomes the arrows in the graph. Because a label needs a step to attach to, the labeling UI below only appears while your cursor is inside one. Outside of steps, Graphium stays a plain, quiet editor.

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

- On a **table**, the hint reads **Each row → one Entity**: every row becomes its own entity, which is why per-cell inline labels are unnecessary. The label shows as a small chip just above the table, aligned to its right edge — click it to change or remove it. <Badge type="tip" text="Added in v0.28.0 (2026-08-04)" />
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
| Card with a blue band | A step (a PROV *Activity*). The card shows its name and how many parameters it has |
| Colored node | An entity — **Input** (green), **Tool** (amber), **Output** (terracotta) |
| Panel below the graph | The selected step's tables — parameters, inputs, tools, outputs — editable here |
| Green edge (`used`) | The step consumed this entity |
| Terracotta edge (`wasGeneratedBy`) | This entity was produced by the step |
| Dashed blue edge (`wasInformedBy`) | Order only: B came after A, but the note doesn't say which output was handed over |

The expand button (**Expand view**) opens the graph full-screen, still editable.

**Repeated referents collapse into one node.** If step B's **Input** text matches step A's **Output** text (and B is linked to A as its next step), Graphium unifies them: "the powder A produced" and "the powder B used" become a single entity, and the chain reads continuously across steps. This is also what keeps branches straight when a step has several outputs going to different steps.

### Editing from the graph <Badge type="tip" text="Added in v0.30.0 (2026-08-09)" /> {#editing-from-the-graph}

The panel is a place to write, not just a picture to read. Everything you do here is written into the note — the graph holds no data of its own.

- **Add step** — the button in the top-right adds a step block to the note.
- **Select a step card** to rename it, jump to its text (**Go to text**), or delete it. A step with content asks for confirmation, telling you how many blocks go with it.
- **Connect** by dragging the dot under a node onto a step — the entity becomes that step's input. Drop it on empty canvas instead and a new step is created to receive it. Connecting two steps records order only (the dashed edge). Cycles are blocked.

**The panel is the step's contents.** Selecting a node — the step or any of its entities — opens the same panel below the graph (to the right when full-screen): the step's tables, one card per table, in the note's label colors. Selecting an entity just highlights its row. Each card *is* the table in your note — editing here and editing the table in the note are the same act. While nothing is selected the panel folds away to give the graph the room; the divider between them can be dragged to taste (double-click resets it).

| Section | Shape | To add |
|---|---|---|
| **Parameter** | one column per key, one row of values | **Column** adds a key |
| **Input** / **Tool** / **Output** | one row per entity, one column per attribute | **Add row** adds an entity |

A kind the step doesn't have yet still shows as a table — a dashed card with one empty row. Type into that first cell and the labeled table appears in the note with what you typed already in it (the key for a parameter table, the name for the others). Leave it alone and nothing is written, so a step never fills up with empty tables you didn't ask for.

**Entities you highlighted in a sentence** keep working as they are, and appear right inside their kind's table as grayed rows — highlighted parameters as grayed columns. Renaming one edits the text in place. **Add to the table** (or clicking its grayed cells) takes it in for real. The sentence is left exactly as it was, highlight and all — adding only adds. Its bound attributes come along as columns (they are values, and keeping them in both places would count the same fact twice), and the grayed row disappears because the highlight and the new row are the same entity. Highlighting and tables are the same data seen two ways, so you can move over at your own pace.

**The same tool used in several steps is one entity.** Write "mortar" as a tool in two steps and the graph draws one node with an edge to each — no duplicates. In the step whose table doesn't hold its row it shows grayed, labeled with where it lives (**In &lt;step&gt;**), and **Add to the table** gives this step its own row for it — still one entity in the graph, because same-named materials and tools merge.

## Exporting PROV-JSON-LD

The note menu (the **⋯** button at the top right of the editor) includes **PROV-JSON-LD**. It downloads the current note's provenance graph as a `.jsonld` file following the W3C PROV-JSON-LD serialization — readable by standard provenance tools outside Graphium.

The export is scoped to the current note. It includes the labeled steps and entities, the note's edit-history agents (human and AI), and any [Knowledge layer](/knowledge-layer) entries derived from the note. The menu item is disabled while the note has no provenance data.

## The note's own history

Provenance has a second axis: not just "how was the result made," but "how was the *note* made." Every save is recorded with who made it — you or an AI — and you can pin versions on purpose. That side of provenance is part of everyday writing, so it lives in [Notes & editor → History and versions](/notes-and-editor#history-and-versions).

## Derived notes

When a new experiment builds on an old one, don't copy-paste — derive. The note menu (**⋯**) has **Derive whole note**, and the drag handle (⠿) menu has **Derive new page** for branching from a single block. The copy opens as a new note carrying a **Derived note** banner with a **Source note** link back to the original, and the derivation is recorded in both notes' histories and in the lineage graph.

## Turning a URL, PDF, or Word file into a pre-labeled note

If the procedure already exists — a synthesis section of a paper, a protocol on the web — AI can do the labeling pass for you. In the sidebar's **Materials** section (your [materials](/materials-and-citations) gallery), open the action menu on a URL, PDF, or Word material and choose **Extract steps into a note**. Select several materials and the same action appears as a bulk button.

Graphium reads the source, splits it into step blocks, applies **Input** / **Tool** / **Parameter** / **Output** highlights, links the steps in order, and records the source material in the note's lineage. A toast tracks progress, and the result is a normal note — review the labels and edit anything the AI got wrong. This requires a [configured AI model](/ai-setup).

Two habits keep the imported labels tidy. Step titles hold the **operation only** — a source that mills for 0 h, 1 h and 3 h produces three steps all named "Ball milling", told apart by their **Parameter** values and by what each one produces, rather than three titles with the duration baked in. And names already used elsewhere in your workspace are offered back to the AI, so the same mill comes back as the same tool instead of a near-duplicate.

## Graph views beyond one note

Labels and links also feed graphs that span your whole workspace:

![The network graph view](/screenshots/network-graph.png)

- **Neighbors** — in the right panel's **Graph** tab: the current note and everything linked within two hops.
- **Lineage** — the second sub-tab of **Graph**: a tree of the current note's upstream sources — the notes, materials, and versions it was derived from.
- **Global Graph** <Badge type="tip" text="Added in v0.16.5 (2026-06-29)" /> — in the sidebar: every note at once, layered as **Sources**, **Notes**, and **Claim · Insight** ([Knowledge layer](/knowledge-layer) entries), with edges for **Derived**, **Used**, and **Reference** relations. Toggle **Hide references** or **Show isolated**, color nodes by type or context, and **Group by context** to pull related notes into clusters.
- **Activity graph editor** — the **Steps (only)** view described [above](#the-provenance-graph-panel), where the step order itself can be rewired by dragging.

Together these answer the question labels exist for: not just "what did I write," but "where did this come from, and what did it lead to."
