# Settings

Every preference in Graphium lives in one modal: click **Settings** at the bottom of the sidebar. The modal has seven tabs — **Display & Language**, **Storage**, **AI**, **Grounding data**, **Knowledge**, **Usage**, and **About** — arranged in setup order, so a first-time setup reads top to bottom and left to right. This page is a map of every tab; the deep-dive pages linked from each section explain the workflows in full.

![Settings modal open on the AI tab](/screenshots/settings-ai-tab.png)

::: info Platform availability
Some groups only appear on certain platforms: folder pickers, sharing, mobile inbox receiving, and update checks need [the desktop app](/desktop-app), while the server-storage token only appears on a self-hosted (Docker) deployment. Each table below notes these cases.
:::

## Display & Language

How Graphium looks and reads.

| Group | What it does |
|---|---|
| **Language** | Switch the UI between **English** and **日本語** (Japanese). |
| **Reading font** | Set Latin and Japanese fonts independently — the Latin font applies to alphanumerics, the Japanese font to kana and kanji. |
| **Provenance label names** | Rename the provenance labels shown throughout the app; see [Labels & provenance](/labels-and-provenance). |

Latin font options: **Default (Inter)**, **Atkinson Next + Inter numerals (dyslexia-friendly)**, **Atkinson Next only (digits with slashed 0)**, and **Lexend (reading-speed optimized / NASA study)**. Japanese font options: **Default (OS system font)**, **Zen Kaku Gothic New (relaxed body gothic)**, and **BIZ UDPGothic (Japanese UD gothic)**.

Under **Provenance label names**, five labels are renameable — the defaults are **Step**, **Input**, **Tool**, **Parameter**, and **Output** — and each row shows its underlying PROV-DM role (`prov:Activity`, `prov:used`, `prov:Entity`, `prov:wasGeneratedBy`). Leave a field empty to use the default; **Reset to defaults** clears all custom names at once.

## Storage

Where your notes live and how they move between devices. Full details in [Storage & sync](/storage-and-sync).

| Group | What it does |
|---|---|
| **Server storage** | Self-hosted (Docker) only — enter the auth token the server requires so this browser can read and write notes. |
| **Local save location** | Desktop only — change the folder where notes, media, and knowledge are stored (point it at a Dropbox/Drive/OneDrive folder to sync without OAuth). |
| **Your identity** | Set your display name and email, used as the author on shared notes and provenance entries. |
| **Shared storage** | Desktop only — pick a shared folder (lab NAS, synced folder) plus a blob folder for large binaries, with a **Test connection** round-trip check. |
| **Mobile upload** <Badge type="tip" text="Added in v0.23.1 (2026-07-29)" /> | The desktop half of phone capture: a QR code that opens Graphium on your phone (storage is connected there), the **Inbox folder** picker for the synced folder that receives captures, and the **Keep processed files in `_imported/`** option. See [Mobile capture](/mobile). |
| **Export & backup** | Download all notes as Markdown files, or a raw-data JSON backup covering every note, knowledge, and skill document. |

::: warning
Changing the **Local save location** does not move existing notes automatically — copy the old folder's contents into the new one first, then restart Graphium.
:::

## AI

Everything AI-related, ordered as a setup flow: register models first, then assign them to roles, then optional extras. Full walkthrough in [AI setup](/ai-setup).

| Group | What it does |
|---|---|
| **Registered Models** | Add and manage models — Anthropic, OpenAI, Google Gemini, OpenAI-compatible endpoints, or your Claude subscription (no API key) — with optional per-model pricing. |
| **Model assignment** | Choose which registered model plays each role: **Default model**, **Chat & Insight model**, and **Embedding model** (with a **Test embedding** check). |
| **World grounding** | Turn on **Auto-ground new knowledge** and optionally set a dedicated grounding model; see [World grounding](/ai-grounding). |
| **MCP Servers** <Badge type="tip" text="Added in v0.13.6 (2026-06-04)" /> | Connect external tool servers directly — **Paste JSON** from a server's README, configure one by hand with **Manual**, or pull candidates **From registry**. |

If no backend is reachable, this tab shows a notice instead: AI features require the desktop app or a self-hosted setup. MCP servers come in two types — **Local** (launched and managed by Graphium; desktop or self-hosted backend only) and **Remote** (connects to an already-running server by URL).

::: tip
Adding a web-search MCP server (e.g. Tavily) lets External grounding search the live web with any model — see [AI chat and Ask](/ai-chat-and-ask).
:::

## Grounding data

A browser for the knowledge base that [world grounding](/ai-grounding) checks against. It starts empty and grows on its own: whenever a check misses the KB, the model's judgment is cached here and reused, so checks get faster and cheaper over time.

| Group | What it does |
|---|---|
| Entry list | Search and filter all KB entries; each shows a **seed** badge (curated, bundled) or **model** badge (cached from a model judgment). |
| Per-entry delete | Remove a single cached entry; seed entries cannot be deleted from the UI. |
| **Clear sedimented entries** | Bulk-remove all model-cached entries while keeping the bundled seed set. |

## Knowledge

Maintenance jobs for the [Knowledge layer](/knowledge-layer). These run LLM calls, so each job asks for confirmation and reports token cost on the [Usage](#usage) tab.

| Group | What it does |
|---|---|
| **Connection Status** | Shows the health of each backend component, with a **Restart backend** button on the desktop app. |
| **Re-embed all Wikis** | Rebuilds the embeddings behind AI chat citation search — use it if citation lookup stops working. |
| **Bulk regenerate Knowledge** | Rebuilds existing Knowledge pages after you change prompts or models, with **Target kinds** filters (**Claims** / **Summaries** / **Insights**), an optional model override, cancel support, and **Retry failed only**. |
| **Discover Insights from Claims** | Scans all Claims at once and factors out shared insights that recur across two or more of them. |

## Usage

<Badge type="tip" text="Added in v0.12.0 (2026-05-28)" />

The **AI Usage** dashboard: token consumption per AI feature, so you always know what your setup costs.

| Group | What it does |
|---|---|
| Time range | Switch the **Tokens over time** chart between **Day**, **Month**, and **Year** granularity. |
| Totals | **Total tokens** and **Estimated cost**, computed from the per-model pricing you set on the [AI](#ai) tab. |
| **By feature** | Per-feature breakdown of which parts of Graphium consumed the tokens. |
| Currency | Display costs in USD or JPY with an editable **1 USD = ¥** exchange rate. |
| **Recalculate cost** | Recomputes the last 90 days of cost with the current per-model pricing. |

Subscription models are flagged separately — **Subscription (no per-token cost)** — since they don't bill per token. Usage tracking needs the desktop app or a self-hosted server.

## About

The app's identity card.

| Group | What it does |
|---|---|
| **About this app** | Shows the app name and **Version**. |
| **Updates** | Desktop only — Graphium checks automatically on launch and every 24 hours, and **Check for updates** runs a check on demand; see [Updating](/desktop-app#updating). |

In the browser version, the **Updates** group simply notes that update checks are only available in the desktop app.
