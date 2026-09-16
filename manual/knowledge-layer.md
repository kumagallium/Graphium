# Knowledge layer

Notes are your working memory: dated, contextual, full of detail. The Knowledge layer is what Graphium distills out of them — a personal wiki of short, editable pages that each state one reusable point and cite the notes they came from. This page explains the three kinds of knowledge, how to add notes to it, and how to browse, maintain, and trust what the AI builds.

::: info Needs AI
The Knowledge layer runs only with an AI backend, which ships inside the [desktop app](/desktop-app), with at least one model registered. See [AI setup](/ai-setup). In the browser preview the **Knowledge** section shows an upgrade notice instead.
:::

## Notes vs. knowledge

A lab note answers "what happened on Tuesday". A knowledge page answers "what do I now know". Graphium keeps both, linked in one direction: every knowledge page ends with a **References** section whose **Source:** entries link back to the notes it was distilled from, so you can always drop back into the original context.

Because knowledge is *derived*, regeneration is normal. When your notes change, the pages built from them can be rebuilt — knowledge follows your notes, not the other way around.

## The three kinds

Graphium's knowledge follows an hourglass: context-rich notes narrow into short general statements, which then connect back outward across your work — **notes → claims → insights**. The reasoning model behind this is documented in [Inference types in Graphium](https://github.com/kumagallium/Graphium/blob/main/docs/inference-types.md). Topics sit alongside this hourglass rather than inside it: they group claims by concept and are never fed into insight discovery.

| Kind | What it is |
|---|---|
| **Topics** | A page that groups related claims by concept, with two-hop provenance (topic → claim → note) |
| **Claims** | A grounded assertion extracted from your notes |
| **Insights** | A pattern that recurs across two or more claims |

Each kind carries a semantic type badge. Claims have a role (**Finding**, **Decision**, **Anomaly**, **Question**, **Setup**, **Interpretation**, **Issue**); insights have a pattern type (**Causal**, **Mechanistic**, **Conditional**, and so on).

Graphium used to generate a fourth kind, **Summaries** — a short AI recap of a single note — but generation has stopped in favor of Topics, which now carry that grouping role. If you made some before this change, they haven't gone anywhere: a **Previous Summaries** row appears at the end of the sidebar's Knowledge list whenever you have any. They can still be viewed and deleted, but not regenerated.

## Adding a note to knowledge

The main entry point is the **Add to Knowledge** chip in the note editor header (it also appears in the side peek and in the note's header menu). Click it and the AI reads the note, extracts claims from it, and groups them into topics.

Progress appears in a toast at the corner of the screen — **Generating Knowledge (1/3)** — which you can collapse with **Minimize** and reopen with **Show details**. While it runs, the toast header also has a **Stop** button (■): it interrupts the in-flight AI call, keeps whatever already finished, and marks the rest **Stopped** — useful when a slow model turns out to be slower than you expected. When it finishes you'll see **Done: 2 generated**, and the chip flips to **In Knowledge**; clicking it now jumps to the generated entry. Running it again on an updated note regenerates the existing entries rather than duplicating them.

Other routes into knowledge:

| From | How |
|---|---|
| Note list | Select multiple notes, then **Add 3 to Knowledge**. A **Knowledge** column shows which notes are already in |
| [Materials](/materials-and-citations) | Select URLs / PDFs in the gallery, then **Add 3 to Knowledge**; memos can be ingested directly too |
| [AI chat](/ai-chat-and-ask) | **Make Knowledge** on an answer (see below) |
| The Composer (`⌘K`, `Ctrl+K` on Windows/Linux) | The **Add this note to Knowledge** suggestion card |

::: tip
Ingestion is always something you trigger — Graphium never turns notes into knowledge behind your back. Skills marked **Auto-apply on Ingest** let you inject your own standing instructions (terminology, style) into every run.

Two built-in skills define the default writing voice (Japanese / English). When an app update ships an improved default, skills you never edited pick it up automatically. If you have edited one, an **Update available** badge appears in the skill list instead, and **Reset to default** replaces your version with the new content. <Badge type="tip" text="Added in v0.30.0 (2026-08-09)" />

Prompts take trial and error, so skills support the same manual version snapshots as notes: while editing a skill, press `⌘⇧S` or click **Save version** in the **History** tab to pin the current prompt, and use **Restore this version** on any saved version to switch the skill back to it. The restore itself is recorded in the edit history. <Badge type="tip" text="Added in v0.30.0 (2026-08-09)" />
:::

## Browsing knowledge

The sidebar has a **Knowledge** section (collapsed by default) listing **Topics**, **Claims**, and **Insights** with counts (plus **Previous Summaries** if any legacy summaries remain). Click a kind to open its list view, which offers:

- Columns: **Title**, **Type**, **Sources** (how many source notes — for topics, how many member claims it groups instead), **Refs out** / **Refs in**, **Model**, **Created**, **Modified**, and **World** (latest [world-grounding](/ai-grounding) verdict)
- Search, per-column type filters, sorting, and multi-select by dragging over the rows or shift-clicking a range
- Bulk actions on selected rows: **Regenerate 3**, **Move 3 to trash**, **Check world (3)**, and for Topics (select 2 or more) **Merge**, which asks which topic to keep and moves the other(s) into it

Claims also show an evidence status: **?candidate** (used in only 1 note) or **✓verified** (used in 2+ notes). A claim that gets corroborated by a second independent note is promoted automatically, and its page shows a **Corroborated** badge.

![Knowledge list view showing claims with type, sources, and status columns](/screenshots/knowledge-list.png)

## Knowledge pages are editable notes

A knowledge page opens like any other note, and you can edit it like one. What makes it special is the banner at the top:

- **Regenerate** — rebuild the page from its current sources with your configured model
- **Derived from** — the page's provenance: source **Notes**, **Source claims** (for insights), and **Related insights**
- **Check world** — locate the statement against external knowledge (see [World grounding](/ai-grounding))
- **Epistemic status** — how firmly the statement is grounded, from speculation to established

The body ends with a **References** section linking back to sources. Keep in mind that **Regenerate** rewrites the body from the sources — so make lasting corrections in the source notes where you can, and treat hand-edits to knowledge pages as provisional.

![A knowledge page with the banner showing Derived from and Regenerate](/screenshots/knowledge-page-banner.png)

## Merging topics

Topics can drift apart over wording, particles, or an overly narrow per-sample title even when they're the same concept. There are four ways to merge them, none of which need you to open Settings unless you want the AI to judge the whole corpus at once:

- **Topics list** — select 2 or more Topics and press **Merge**; pick which one to keep and the rest move their member claims into it, then go to trash.
- **A topic's own banner** — shows a **Similar topics** chip when a candidate is found nearby (same normalized title, or embedding similarity when an embedding model is set); press **Merge** to absorb it into the page you're viewing.
- **Health check** — a **Redundant** issue for two Topics gets a one-click **Merge** button alongside the usual Regenerate/Archive/Open actions.
- **Settings → Knowledge → Organize topics** — the only entry point that has the AI scan every existing Topic and decide which ones are the same concept, in one pass.

The first three don't call a model — you've already made the decision by picking the topics. Organize topics and the AI-analysis Health check use your **Chat model** (Settings → AI) to judge whether topics are the same concept.

## Log and Health

Two buttons at the bottom of the sidebar's **Knowledge** section open maintenance views:

- **Log** — an activity log of every knowledge operation (ingest, merge, cross-update, regenerate, delete), grouped by day, each entry linking to the affected page.
- **Health** — the **Knowledge Health Check**. Press **Run Check** and choose **Quick (local only)**, which finds orphaned and duplicate-topic entries — plus any Insight pairs already flagged as **Contradiction** during discovery (see below) — without any LLM call, or **Full (AI analysis)**, which additionally has the AI look for **Gap**, **Stale**, **Redundant**, and any other Contradictions it can spot across the whole corpus. There's no threshold behind these — Stale means the AI found a specific newer page or note that supersedes it (not "hasn't changed in a while"), and Redundant means two pages assert the same specific claim. A Contradiction issue offers **Open** on both affected pages so you can compare them yourself — Graphium never decides which one is right.

## Discovering insights from claims

Insights are found by scanning claims for patterns that recur across two or more of them. This happens incrementally during ingestion, and you can run it across your whole corpus from [Settings](/settings) → **Knowledge** → **Discover Insights from Claims** → **Discover Insights**. Existing insights are sent to the model as a shortlist first (embedding similarity), then the AI judges each shortlisted pair: a genuine duplicate reinforces the existing insight instead of creating a new one, but a pair that actually disagrees (opposite direction, conflicting condition) is kept as two separate insights and flagged as a Contradiction in the Health Check — Graphium never silently merges conflicting findings into one page.

**Every scan reports how much it looked at** <Badge type="tip" text="Added in v0.45.0 (2026-08-25)" />. Claims are scanned cluster by cluster, and the result reports the coverage it measured — **covered n/m** after an ingest, **Claims in view: n/m** in the corpus-wide run — meaning how many of your claims were in view at least once. So "no new insights" is never ambiguous: you can see whether the scan looked at everything and found nothing new, or simply hasn't reached the rest of your corpus yet. The corpus-wide run continues until every claim has been in view, and tells you up front how many LLM calls that takes; ingest-time scanning is capped by **Scans per ingest** in [Settings](/settings) → AI, so you decide what each ingest costs. If Insights are rare, the [FAQ](/faq) walks through how to tell whether it's your material or your model.

## Bulk regeneration and re-embedding

The [Settings](/settings) → **Knowledge** tab holds corpus-wide maintenance:

| Tool | When to use it |
|---|---|
| **Bulk regenerate Knowledge** | After changing models — rebuild pages by kind (**Target kinds**), with an optional **Model override (optional)**, progress display, cancel, and **Retry failed only** |
| **Re-embed all Knowledge** | When AI-chat citation search stops finding your knowledge — rebuilds the embeddings for every page |

Both show a confirmation with the count first; regeneration issues LLM calls and consumes tokens.

## Saving chat findings as knowledge <Badge type="tip" text="Added in v0.16.8 (2026-07-02)" />

When an [AI chat](/ai-chat-and-ask) answer contains something worth keeping, press **Make Knowledge** under the answer. Instead of saving the whole reply, Graphium proposes discrete candidates in a picker titled **Knowledge candidates (select to save)** — each with a **Claims** or **Insights** badge, a title, and a preview. Check the ones you want (or **Select all**) and press **Save selected (2)**. Only what you pick enters your knowledge.

## Knowledge in the global graph

Open **Global Graph** from the sidebar to see your whole workspace as three layers: **Sources** at the bottom, **Notes** in the middle, and **Claim · Insight** on top. Knowledge sits at the crystallized tip — you can watch clusters of notes funnel into a few claims and insights, and spot notes that haven't been distilled yet.

## Provenance of knowledge <Badge type="tip" text="Added in v0.17.3 (2026-07-13)" />

Knowledge is held to the same provenance standard as everything else in Graphium:

- Every page's **Derived from** panel and **References** section cite its sources; insights additionally record which claims they were lifted from.
- Growth events — ingest, merge, reinforcement, regeneration — are recorded as first-class activities in the page's history, so the [history panel](/labels-and-provenance) shows *which* sources fed each revision.
- Deleted pages go to the trash, and merged ones are archived rather than destroyed, so existing citations keep resolving.

You can also cite knowledge back into your notes: type `/` in the editor and pick **Claims** or **Insights** under the **Existing knowledge** group to insert references to existing pages (multi-select supported).
