# Getting started

This is the five-minute path from a blank page to your first **provenance graph** — the picture of what you did, with what, in what order. We use a bread-baking trial as the example, but the same steps fit a cooking experiment, a piece of writing, a study session, or a lab run. Anything you figure out by trying things.

::: tip Just want to write?
You can. Steps and labels are optional, and a note with none of them is a perfectly good note. This guide shows what you *get* when you add them, so you can decide how far to go. For the bigger picture of *why* Graphium works this way, see [What is Graphium?](/) or the design essay [CONCEPT.md](https://github.com/kumagallium/Graphium/blob/main/docs/CONCEPT.md).
:::

## 1. Open Graphium

No account, no sign-up. Pick whichever fits:

- **Try it in your browser** — [kumagallium.github.io/Graphium/app](https://kumagallium.github.io/Graphium/app/). Notes live in this browser's storage, so treat it as a way to kick the tires.
- **Desktop app or Docker** — for durable files on disk and the AI features. See [Desktop app](/desktop-app) and [Storage & sync](/storage-and-sync).

The browser preview is enough for steps 2–6 below. Step 7 (the Knowledge layer) needs an AI model, which means the desktop app or the Docker setup — see [AI setup](/ai-setup).

## 2. Create your first note

Click **+ Note** in the sidebar and give it a title:

```
Bread dough trial #3
```

Then just write what you know going in — the goal, the ingredients, a stray hunch:

```
Trying a longer ferment than trial #2.

Bread flour   300 g
Water         200 g
Dry yeast       3 g
Salt            5 g
```

That's already a complete note. Everything from here is optional detail you add only where it earns its place.

## 3. Mark the steps <Badge type="tip" text="Added in v0.23.0 (2026-07-28)" />

On an empty line, type `/` and choose **Step** (under **Advanced**). A step block is a container: it holds text, tables, and images, and the whole bundle counts as one action in your process (PROV-DM calls it an *Activity*).

1. Rename the title from **Step 1** to `Mix`, and put the details inside — the ingredient list can move in here, since mixing is what consumes it.
2. In the step's header, click **Next step** → **Create new**. Graphium inserts the following step *and links the order for you*. Name it `Ferment`.
3. Repeat once more for `Bake`.

You can also wire order by hand: the **Prev step** chip in each step's header lets you pick which step came before (branches and merges are fine; only cycles are blocked).

This pass alone gives you the *skeleton* of the graph: what happened, in what order.

![A step block with its title and prev/next step links](/screenshots/step-block.png)

## 4. Highlight the details (inline labels)

Now go inside a step's body and select a span of text. The formatting toolbar grows a second row with four label buttons:

| Label | Shortcut | Use it for | In the bread note |
|-------|----------|-----------|-------------------|
| **Input** | `⌘⇧I` | something consumed or transformed | `Bread flour`, `Water`, `Dry yeast`, `Salt` |
| **Tool** | `⌘⇧E` | equipment or instrument | an oven, a stand mixer |
| **Parameter** | `⌘⇧P` | a condition or setting | `300 g`, `30 min`, `200 °C` |
| **Output** | `⌘⇧O` | what the step produced | `dough`, `baked loaf` |

On Windows/Linux, use `Ctrl+Shift` with the same letter. (`E` stands for equipment — `T` is taken by the browser.)

Two things to know:

- Labels attach only inside a step's **body**. The step's title is the activity's name, so it can't be labeled — and if the label row doesn't appear, check that your cursor is inside a step.
- This is a second, independent pass over the same text. You can label every detail, a few, or none — **the graph only shows the parts you chose to mark.** That gradient is the whole idea.

![Editor with labels and the provenance graph that builds as you write](/screenshots/editor-with-graph_en.png)

## 5. Watch the graph draw itself

There is no generate button. The first time a step appears, the **Steps** panel (the branch icon on the right) opens on its own, and from then on the graph redraws automatically as you edit.

Reading it: each step becomes a node, your **Input** / **Tool** / **Output** highlights hang off the steps they belong to, **Parameter** values attach as conditions, and the prev-step links you made in step 3 give the arrows their direction. Mark `dough` as the **Output** of *Mix* and as an **Input** of *Ferment*, and — because the two steps are linked — the graph draws it as a single node flowing from one to the other.

Two view toggles sit at the bottom of the panel: **Steps (all)** shows everything, **Steps (only)** shows just the process flow. You can also export the graph as **PROV-JSON-LD** — see [Labels & provenance](/labels-and-provenance).

You wrote a recipe. You got a traceable record of the run.

## 6. Link and revisit your notes

- **Reference another note** with `@` — type `@` in the text and pick a note (or create one on the spot). Over time these links form a network you can browse as a graph; see [Notes & editor](/notes-and-editor).
- **Search inside a note** with `⌘F` (`Ctrl+F` on Windows/Linux).
- **Every save is recorded.** The **History** panel on the right shows who edited the note — you or an AI — and when, so you can always see how it got to where it is. See [Labels & provenance](/labels-and-provenance).

## 7. Turn notes into reusable knowledge *(optional, needs AI)*

So far everything works with no AI. Connect a model and Graphium grows a second, editable layer on top of your notes — a small wiki it builds *from what you wrote*.

1. Set up a model once: open **Settings**, go to the **AI** tab, and click **Add model** (Anthropic, OpenAI, Google Gemini, an OpenAI-compatible endpoint, or your Claude subscription — no API key needed for the last one). This requires the desktop app or Docker; the full walkthrough is in [AI setup](/ai-setup).
2. On a note, click **Add to Knowledge** in the header. Graphium distills the note into knowledge pages, each citing back to its source, and the chip flips to **In Knowledge**.
3. The results appear under **Knowledge** in the sidebar, sorted into four kinds — **Summaries**, **Claims**, **Insights**, and **Ideas**. You don't need them on day one; see [Knowledge layer](/knowledge-layer) when you're ready.

![The Add to Knowledge chip in the note header](/screenshots/add-to-knowledge-chip.png)

Once a model is registered, `⌘K` (`Ctrl+K` on Windows/Linux) opens the Composer from any note: type to jump to a note (`#label` and `@author` filter the list), or keep typing and press `⌘Enter` to ask the AI, with your own notes as context. See [AI chat and Ask](/ai-chat-and-ask).

## Where to go next

- **Start from a scaffold** — type `/` and choose **Template** for a ready-made **Plan Template** or **Run Template**. The Run Template comes with pre-labeled steps, so it doubles as a worked example of a fully labeled note.
- **The editor in depth** — [Notes & editor](/notes-and-editor): blocks, formulas, callouts, templates.
- **Labels and the graph in depth** — [Labels & provenance](/labels-and-provenance).
- **Bring in outside material** — [Materials & citations](/materials-and-citations): PDFs, web pages, Word files.
- **The thinking behind it** — [CONCEPT.md](https://github.com/kumagallium/Graphium/blob/main/docs/CONCEPT.md) on GitHub.

Write as much, or as little, as you need. The provenance layer is there when you want it, and out of the way when you don't.
