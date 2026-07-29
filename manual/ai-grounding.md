# World grounding

Your notes produce claims and insights — but how do they relate to what the rest of the world already knows? World grounding checks a piece of knowledge against outside sources (Wikipedia, OpenAlex, and optionally a web search) and stamps it with a verdict. It answers "is this already known, supported, or contested out there?" so you can decide where to dig deeper.

Treat the verdict as a positioning aid, not a truth oracle. It tells you where a claim sits relative to a knowledge base — the final call on whether your claim holds always stays with you.

::: info Requirements
World grounding is part of Graphium's AI features, so you need a backend (the desktop app or a self-hosted server) and at least one registered model — see [AI setup](/ai-setup). Evidence from Wikipedia and OpenAlex works out of the box with no API keys; adding a web-search MCP server (for example Tavily) broadens the evidence to the general web.
:::

## Checking a claim against the world <Badge type="tip" text="Added in v0.8.0 (2026-05-21)" />

Open a knowledge item — **Claims**, **Insights**, or **Ideas** under **Knowledge** in the sidebar — and look at the banner above the text. Next to **Regenerate** there is a **Check world** button.

![A claim open in the editor, with the Check world button and a verdict chip in the banner](/screenshots/world-grounding-verdict.png)

Clicking it runs the check and stores the result on that knowledge item: a verdict, a rationale, and sources. A progress toast keeps you posted while it runs. **Summaries** cannot be grounded — they describe one of your notes rather than assert something about the world.

You can also ground several items at once. In the Claims, Insights, or Ideas list, a **World** column shows the latest verdict for each row (sortable by verdict strength). Select rows with the checkboxes and click **Check world** with the selection count — running it again overwrites the previous verdict, so the same button doubles as a re-check.

## Reading the verdict

The verdict appears as a chip in the banner, phrased as the knowledge base's position (hover it to see **KB position** and the rationale):

| Chip | What it means |
|---|---|
| **Aligned with established** | The claim lines up with well-established, textbook-level knowledge. |
| **Aligned with supported** | The claim lines up with knowledge that has published support, but is less settled. |
| **KB sees as weakly-grounded** | The knowledge base found only weak grounding for this claim. |
| **KB has counter-evidence** | The knowledge base holds evidence that cuts against the claim. |
| **Checked · no KB match** | The check ran, but nothing matched — the claim is neither supported nor refuted. |

For the full picture, scroll to the bottom of the item. A **World check** section shows the **Rationale**, the **Sources** (each one a link you can open), the **Matched keywords**, and **Checked by** — which tells you whether the answer came from the local knowledge base, from a web-evidence-backed judgment, or from a model answering from its own knowledge.

When two insights ground to the same world fact, Graphium links them: the section **Insights grounded to the same world fact** lists other insights that touched the world at the same point. This is a connection an isolated AI answer cannot hold for you.

## How it works: a knowledge base that grows

World grounding is built as two layers, and understanding them explains why it gets faster with use:

1. **A local knowledge base answers first.** Every check starts against a local KB (a small curated seed plus everything cached from earlier checks). A hit answers instantly, at zero cost, with no model call.
2. **Only misses go to the model.** On a KB miss, the world-grounding model gathers evidence — Wikipedia and OpenAlex always, plus a web-search MCP tool if you have one connected — and judges the claim against it. If no evidence turns up, the model falls back to its own knowledge.

Each model judgment settles back into the local KB. The next check on a similar claim is a KB hit, so the KB adapts to your own field over time and checks get faster and cheaper the more you use them.

The verdict stored on a note and the KB cache are separate: clearing a verdict from a note does not touch the KB, and deleting a KB entry does not remove verdicts already stamped on notes.

## Auto-grounding <Badge type="tip" text="Added in v0.13.3 (2026-06-02)" />

By default, grounding only runs when you ask for it. If you want new knowledge checked as it appears, open **Settings** → **AI**, find the **World grounding** section, and switch on **Auto-ground new knowledge** (off by default).

With the toggle on, newly created claims and insights are checked one at a time in the background — silently, with no toasts. Only items that have never been checked are picked up, and because the KB is consulted first, the model is only called for claims not yet known.

## The world-grounding model

In the same **World grounding** section of **Settings** → **AI** you can pick a dedicated **World-grounding model**. Left empty (**Same as Chat & Insight model**), grounding uses your Chat & Insight model and then falls back to the default model — you usually don't need to set this separately.

See [AI setup](/ai-setup) for registering models and the other model assignments.

## Re-grounding and clearing verdicts <Badge type="tip" text="Added in v0.13.5 (2026-06-03)" />

- **Re-ground**: press **Check world** again. The new result replaces the old one.
- **Clear**: in the **World check** section at the bottom of the item, press **Clear result** to remove the verdict and sources stored on that item. Use this when a wrong judgment or a broken link got baked in. In the list view, select rows and use **Clear result** with the count to strip verdicts in bulk.

::: tip
A manually cleared item is deliberately skipped by auto-grounding — clearing signals "don't re-stamp this automatically". Press **Check world** yourself when you want a fresh verdict.
:::

## Grounding scope for AI answers <Badge type="tip" text="Added in v0.16.8 (2026-07-02)" />

A related control with the same name appears when you ask the AI a question: the **Grounding** chip in the AI chat panel and the ⌘K Composer chooses what an answer draws on — **External** (forced web search), **Internal** (your citations plus a cross-search of your knowledge), or **This note** (only what the note cites; the default). See [choosing what grounds the answer](/ai-chat-and-ask#choosing-what-grounds-the-answer) for the full breakdown and what **External** needs to reach the web.

## Managing grounding data

**Settings** → **Grounding data** is where you inspect and prune the knowledge base that world grounding checks against. It starts empty and grows as you run checks.

![The Grounding data tab in Settings, listing cached KB entries with verdict filters](/screenshots/grounding-data-tab.png)

- The header shows the entry count, and you can narrow the list with verdict filter chips or the **Search KB...** box.
- Each entry carries a badge: **seed** for curated entries bundled with the app (these cannot be deleted from the UI), **model** for entries sedimented from a model judgment — hover the badge to see which model produced it.
- Delete a single cached entry with its trash button, or press **Clear sedimented entries** with the count to wipe every model-cached entry at once. Seed entries are kept either way.

Deleting entries only affects future checks — it is how you evict a judgment you no longer trust so the next **Check world** re-derives it from fresh evidence.
