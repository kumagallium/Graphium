# Getting started

Graphium is a notebook before anything else. This page walks the everyday parts first — write, capture, link, keep versions — and then opens three optional doors: AI at your side, visible procedures, and a knowledge base that grows out of your notes. Use what earns its place; ignore the rest.

## 1. Open Graphium

No account, no sign-up. Pick whichever fits:

- **Try it in your browser** — [kumagallium.github.io/Graphium/app](https://kumagallium.github.io/Graphium/app/). Notes live in this browser's storage, so treat it as a way to kick the tires.
- **Desktop app or Docker** — for durable files on disk and the AI features. See [Desktop app](/desktop-app) and [Storage & sync](/storage-and-sync).

Everything in sections 2–5 works in the plain browser version. The AI doors at the end need a model — see [Setting up AI](/ai-setup).

## 2. Write notes, catch memos

Click **+ Note** in the sidebar, give it a title, and write. It's a regular block editor: paragraphs, headings, lists, tables, images, formulas — type `/` on an empty line to see everything you can insert. Notes save automatically (`⌘S` works too, `Ctrl+S` on Windows/Linux).

For thoughts that don't have a note yet, don't open one — press `⌘⇧M` (`Ctrl+Shift+M`) or click **+ Memo** anywhere in the app. The memo lands in **Memos**, out of your way. Later you can insert it into a note (type `/memo`), cite it as a source, or just let it sit. On your phone, the same capture-first idea goes further — see [Mobile capture](/mobile).

Writing and memo-taking are the whole obligation. Everything below is optional.

## 3. Connect things with @

Type `@` in any note to link to another note, a memo, a material, or a knowledge page — or to create a new note on the spot. Renaming the target updates every mention, so links don't rot.

Links quietly build a network: the graph icon on the right shows how the current note connects to its neighbors, and the network pays off more the more you link. Details in [Notes & editor](/notes-and-editor).

## 4. Keep every version

You never need to worry about overwriting yourself:

- **Every save is recorded.** The **History** panel on the right shows who edited the note — you or an AI — and when.
- **Snapshots** freeze a version you care about: press `⌘⇧S` (or `⌘⌥S` if your system takes the first one). From the history you can open a snapshot read-only, or **Fork from here** to branch a new note off a past version and explore in a different direction.

## 5. Put everything in — it stays reusable

Graphium is built for the pack-rat workflow: keep tossing things in, and finding them again is the app's job, not yours.

**Putting in** — drag PDFs, web pages, Word files, images, audio, and video into notes or the **Materials** gallery; paste URLs; send photos and memos from [your phone](/mobile). You don't have to file anything anywhere.

**Getting back out** — search spans your notes *and* what's inside your materials: text in images is read on-device the moment they arrive, PDFs and web pages open in a reader where a selected passage becomes a quotable memo, and the notes list filters by label and author. Whatever you pull back out can be cited with `@`, carrying a link to where it came from. Details in [Materials & citations](/materials-and-citations).

## Going further — three doors

Each of these is optional and independent. Open the ones that match how you work.

### Write with AI beside you *(needs AI)*

Register a model once — your Claude subscription needs no API key, or bring keys for Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint ([Setting up AI](/ai-setup)). Then the chat panel discusses the note you're in, and `⌘K` (`Ctrl+K`) opens the Composer: type to jump to a note, or press `⌘Enter` to ask the AI with your own notes as context. Answers cite the notes they drew on, so you can check them. See [Chat & Ask](/ai-chat-and-ask).

### Make your process visible with steps <Badge type="tip" text="Added in v0.23.0 (2026-07-28)" />

When a note describes something you *did* — an experiment, a recipe, a build — steps turn prose into a traceable record. Take a bread-baking trial:

1. Type `/` and choose **Step** (under **Advanced**). A step block is a container for text, tables, and images; name it `Mix` and put the details inside.
2. In the step's header, click **Next step** → **Create new** for `Ferment`, and again for `Bake`. Graphium links the order for you (the **Prev step** chip rewires it; branches are fine, only cycles are blocked).
3. Optionally, select details inside a step's body and label them from the toolbar's second row: **Input** (`⌘⇧I`), **Tool** (`⌘⇧E`), **Parameter** (`⌘⇧P`), **Output** (`⌘⇧O`).

![A step block with its title and prev/next step links](/screenshots/step-block.png)

There is no generate button — the **Steps** panel opens when your first step appears and redraws as you edit. Steps become nodes, labels hang off them, and shared items flow between linked steps. You wrote a recipe; you got a traceable record of the run, exportable as standard **PROV-JSON-LD**.

![Editor with labels and the provenance graph that builds as you write](/screenshots/editor-with-graph_en.png)

Label as much or as little as you like — **the graph only shows the parts you chose to mark.** The full story is in [Labels & provenance](/labels-and-provenance).

### Turn notes into knowledge *(needs AI)*

Click **Add to Knowledge** in a note's header and Graphium distills it into short, editable pages — **Summaries**, **Claims**, and **Insights** — each citing the notes it came from. The chip flips to **In Knowledge**, and the results live under **Knowledge** in the sidebar. As your notes evolve, regenerate the pages; knowledge follows your notes, not the other way around. See [Knowledge layer](/knowledge-layer), and [World grounding](/ai-grounding) for checking claims against outside knowledge.

![The Add to Knowledge chip in the note header](/screenshots/add-to-knowledge-chip.png)

## Where to go next

- **Start from a scaffold** — type `/` and choose **Template** for a ready-made **Plan Template** or **Run Template**; the Run Template doubles as a worked example of labeled steps.
- **The editor in depth** — [Notes & editor](/notes-and-editor): blocks, formulas, callouts, templates, search.
- **Bring in outside material** — [Materials & citations](/materials-and-citations).
- **Capture from your phone** — [Mobile capture](/mobile).
- **The thinking behind it** — [CONCEPT.md](https://github.com/kumagallium/Graphium/blob/main/docs/CONCEPT.md) on GitHub.

Write as much, or as little, as you need. The deeper layers are there when you want them, and out of the way when you don't.
