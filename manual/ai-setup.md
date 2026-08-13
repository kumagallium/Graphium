# Setting up AI

AI in Graphium is optional — the app is a complete note editor without it. Until you register at least one model, every AI control (chat, the Composer, Knowledge generation, AI actions on materials) stays hidden, so nothing nags you to configure anything. This page takes you from zero to a working model: where AI runs, how to add a model, where your API keys live, what each model assignment does, and how to track what AI costs you.

## Where AI runs

AI features need a small local backend that talks to your model provider, and that backend ships inside the [desktop app](/desktop-app) — it starts automatically, with nothing to install separately. The browser version is an editor preview with no backend, so its AI controls stay hidden and the AI tab shows an upgrade notice with a **Get the desktop app** button instead.

There is no Graphium cloud service in between: the backend runs on your own machine and sends requests directly to the provider you configure.

## The AI tab

Open [Settings](/settings) and pick the **AI** tab. Everything on this page lives there, except the Usage tab covered at the end.

![AI tab with registered models and model assignment](/screenshots/settings-ai-models.png)

::: info Checking the connection
The AI tab checks the backend each time you open it. A per-component **Connection Status** panel lives on the **Knowledge** tab; when the backend is down, the desktop app also offers a **Restart backend** button there, with **Show log** to see what went wrong.
:::

## Adding a model

Under **Registered Models**, click **Add model** (or **Add your first model**). Pick a provider:

| Provider | What you need |
|---|---|
| **Anthropic** | An Anthropic API key |
| **OpenAI** | An OpenAI API key |
| **Google Gemini** | A Google AI API key |
| **OpenAI Compatible (Groq, Ollama, etc.)** | An **API Base URL** (e.g. `http://localhost:11434` for Ollama) and a key if the endpoint wants one |
| **GitHub Copilot (Subscription · Copilot CLI)** <Badge type="tip" text="Added in v0.33.0 (2026-08-13)" /> | A GitHub Copilot plan, with the `copilot` CLI installed and signed in on this machine — no API key |

For the API-key providers: enter your **API Key**, click **Fetch available models**, pick one from the list (or use **Or enter model ID manually**), optionally set a **Display name**, and click **Add**. The first model you register becomes the default, and the AI features appear throughout the app.

**GitHub Copilot (Subscription · Copilot CLI)** skips the key entirely: it uses the GitHub Copilot CLI login on this machine, so install the CLI with `npm install -g @github/copilot` and run `copilot` once in a terminal to sign in first. Prompts count toward your Copilot plan's usage allowance. The preselected `default` model follows the CLI's current default — click **Fetch available models** to pick a specific one. To switch GitHub accounts later, run `copilot` in a terminal, type `/login`, then restart Graphium.

::: info The Claude subscription provider was removed
Earlier versions offered a **Claude (Subscription · Claude Code)** provider that ran AI through a Claude Pro/Max plan. It was removed because Anthropic's terms do not permit third-party apps to use subscription authentication. Any model registered through it disappears from the list on first launch after updating — register another provider instead. Anthropic API keys are unaffected, and the GitHub Copilot provider above fills the same no-API-key role.
:::

### Where your API keys live

Keys never leave your machine except to reach the provider you registered. On the macOS desktop app they are stored in the macOS Keychain; on Windows they live in a local file inside your Graphium data folder. Prefer a scoped, spending-capped key — details in [SECURITY.md](https://github.com/kumagallium/Graphium/blob/main/SECURITY.md).

### Per-model pricing

Click **Edit** on a registered model to set its **Pricing** — input and output rates in USD per 1M tokens, both optional. For well-known models Graphium shows a reference price you can apply with one click (**Use … / …**). These rates feed the cost estimates on the Usage tab; models without pricing simply show token counts.

## Model assignment

Under **Model assignment**, you decide which registered model handles which job. Only the default matters at first — the rest are optional refinements.

| Assignment | Used for |
|---|---|
| **Default model** | Fallback for everything, and directly for background tasks (ingest, lint, rewrite, cross-update) |
| **Chat & Insight model** | [AI Chat](/ai-chat-and-ask) and Insight generation. Falls back to the default model when empty |
| **Embedding model** | Semantic search over notes and Knowledge. Requires an OpenAI or OpenAI-compatible provider; leave empty for a text-match fallback. Use **Test embedding** to verify the model actually supports embeddings before saving |
| **World-grounding model** | Judging claims against world knowledge on [world grounding](/ai-grounding) checks. Falls back to the Chat & Insight model, then the default — you usually don't need to set it |

The **World grounding** section also has an **Auto-ground new knowledge** toggle (off by default), which world-checks newly created insights and claims in the background. See [World grounding](/ai-grounding) for how checks and the local knowledge base work.

## MCP servers <Badge type="tip" text="Added in v0.13.6 (2026-06-04)" />

MCP (Model Context Protocol) is an open standard that lets the AI chat call external tools — web search, file access, your own APIs. Graphium connects to MCP servers directly; under **MCP Servers**, click **Add MCP server** and pick one of three modes:

| Mode | How it works |
|---|---|
| **Paste JSON** | Paste the `mcpServers` JSON straight from a server's README and click **Import**. Multiple servers, both local and remote, in one paste |
| **Manual** | Fill the form yourself. **Local** servers take a **Command**, **Arguments (one per line)**, and **Environment (KEY=value, one per line)**; **Remote** servers take an **Endpoint URL**, a **Transport** (**SSE** or **Streamable HTTP**), and an optional **API key** |
| **From registry** | Enter a **Registry URL** for a [Crucible Registry](https://github.com/kumagallium/Crucible), click **Fetch servers**, and add candidates from the list |

**Local** servers are launched and managed by Graphium over stdio, the same way Claude Desktop does — you never start or stop a process yourself. This requires the desktop app, since a browser can't launch local processes. **Remote** connects to an already-running server by URL.

Every server in the list can be toggled on and off, edited, or removed. One practical tip from the app itself: adding a web-search server (e.g. Tavily) lets External grounding search the live web on any model.

## The Usage tab <Badge type="tip" text="Added in v0.12.0 (2026-05-28)" />

The **Usage** tab in Settings shows **AI Usage**: token consumption per AI feature, so you can see where your budget actually goes.

- Switch the range with **Day** / **Month** / **Year**; the tab shows **Total tokens**, **Estimated cost**, a **Tokens over time** chart, and a **By feature** breakdown.
- Costs display in USD or JPY — toggle the currency and edit the conversion rate (**1 USD = ¥**) inline.
- Subscription models are marked **Subscription (no per-token cost)** — tokens are counted, but no cost is estimated.
- Changed a model's pricing after the fact? **Recalculate cost** recomputes the last 90 days of events with the current per-model rates. Older monthly summaries are unaffected.

Usage tracking runs on the backend, so it is part of the desktop app.

## Next steps

With a model registered, the AI surfaces light up across the app: [AI chat and the Composer](/ai-chat-and-ask), the [Knowledge layer](/knowledge-layer), and [world grounding](/ai-grounding).
