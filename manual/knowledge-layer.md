# Knowledge layer

Notes are your working memory: dated, contextual, full of detail. The Knowledge layer is what Graphium distills out of them — a personal wiki of short, editable pages that each state one reusable point and cite the notes they came from. This page explains the three kinds of knowledge, how to add notes to it, and how to browse, maintain, and trust what the AI builds.

::: info Needs AI
The Knowledge layer runs only with an AI backend, which ships inside the [desktop app](/desktop-app), with at least one model registered. See [AI setup](/ai-setup). In the browser preview the **Knowledge** section shows an upgrade notice instead.
:::

## Notes vs. knowledge

A lab note answers "what happened on Tuesday". A knowledge page answers "what do I now know". Graphium keeps both, linked in one direction: every knowledge page ends with a **References** section whose **Source:** entries link back to the notes it was distilled from, so you can always drop back into the original context.

Because knowledge is *derived*, regeneration is normal. When your notes change, the pages built from them can be rebuilt — knowledge follows your notes, not the other way around.

## The three kinds

Graphium's knowledge follows an hourglass: context-rich notes narrow into short general statements, which then connect back outward across your work — **notes → claims → insights**. The reasoning model behind this is documented in [Inference types in Graphium](https://github.com/kumagallium/Graphium/blob/main/docs/inference-types.md).

| Kind | What it is |
|---|---|
| **Summaries** | A short AI summary of a single note |
| **Claims** | A grounded assertion extracted from your notes |
| **Insights** | A pattern that recurs across two or more claims |

Each kind carries a semantic type badge. Claims have a role (**Finding**, **Decision**, **Anomaly**, **Question**, **Setup**, **Interpretation**, **Issue**); insights have a pattern type (**Causal**, **Mechanistic**, **Conditional**, and so on).

## Adding a note to knowledge

The main entry point is the **Add to Knowledge** chip in the note editor header (it also appears in the side peek and in the note's header menu). Click it and the AI reads the note, then writes a summary and extracts claims from it.

Progress appears in a toast at the corner of the screen — **Generating Knowledge (1/3)** — which you can collapse with **Minimize** and reopen with **Show details**. When it finishes you'll see **Done: 2 generated**, and the chip flips to **In Knowledge**; clicking it now jumps to the generated entry. Running it again on an updated note regenerates the existing entries rather than duplicating them.

Other routes into knowledge:

| From | How |
|---|---|
| Note list | Select multiple notes, then **Add 3 to Knowledge**. A **Knowledge** column shows which notes are already in |
| [Materials](/materials-and-citations) | Select URLs / PDFs in the gallery, then **Add 3 to Knowledge**; memos can be ingested directly too |
| [AI chat](/ai-chat-and-ask) | **Make Knowledge** on an answer (see below) |
| The Composer (`⌘K`, `Ctrl+K` on Windows/Linux) | The **Add this note to Knowledge** suggestion card |

::: tip
Ingestion is always something you trigger — Graphium never turns notes into knowledge behind your back. Skills marked **Auto-apply on Ingest** let you inject your own standing instructions (terminology, style) into every run.
:::

## Browsing knowledge

The sidebar has a **Knowledge** section (collapsed by default) listing **Summaries**, **Claims**, and **Insights** with counts. Click a kind to open its list view, which offers:

- Columns: **Title**, **Type**, **Sources** (how many source notes), **Refs out** / **Refs in**, **Model**, **Created**, **Modified**, and **World** (latest [world-grounding](/ai-grounding) verdict)
- Search, per-column type filters, sorting, and drag-to-range multi-select
- Bulk actions on selected rows: **Regenerate 3**, **Move 3 to trash**, **Check world (3)**

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

## Log and Health

Two buttons at the bottom of the sidebar's **Knowledge** section open maintenance views:

- **Log** — an activity log of every knowledge operation (ingest, merge, cross-update, regenerate, delete), grouped by day, each entry linking to the affected page.
- **Health** — the **Knowledge Health Check**. Press **Run Check** and choose **Quick (local only)**, which finds stale and orphaned entries without any LLM call, or **Full (AI analysis)**, which also finds **Contradiction**, **Gap**, and **Redundant** issues. Each issue offers one-click fixes: **Regenerate**, **Archive**, or **Open**.

## Discovering insights from claims

Insights are found by scanning claims for patterns that recur across two or more of them. This happens incrementally during ingestion, and you can run it across your whole corpus from [Settings](/settings) → **Knowledge** → **Discover Insights from Claims** → **Discover Insights**. Existing insights are sent to the model so duplicates aren't recreated — when a new claim supports an insight you already have, the insight is reinforced instead of duplicated.

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
