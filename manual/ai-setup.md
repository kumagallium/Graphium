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
| **Claude (Subscription · Claude Code)** | No API key — see below |

For the API-key providers: enter your **API Key**, click **Fetch available models**, pick one from the list (or use **Or enter model ID manually**), optionally set a **Display name**, and click **Add**. The first model you register becomes the default, and the AI features appear throughout the app.

### Using a Claude subscription — no API key <Badge type="tip" text="Added in v0.16.0 (2026-06-19)" />

If you have a Claude Pro, Max, or Team plan, you can run Graphium's AI through your subscription instead of a metered API key. This route uses the Claude Code CLI (`claude`) installed on your machine — its login is separate from the Claude desktop app.

1. Install the Claude Code CLI and sign in: run `claude` in a terminal (or `claude setup-token`).
2. In the AI tab, click **Use your Claude subscription — no API key**. The button appears on the desktop app when the CLI is detected.
3. Graphium registers a subscription model. The model IDs `sonnet`, `opus`, and `haiku` are aliases that always resolve to the latest version — no manual updates needed.

Once registered, the tab shows which account is active: "Signed in as … (Claude Code CLI)". To switch accounts (say, personal to team), run `claude` in a terminal, type `/login`, pick the account, then restart Graphium.

::: warning Subscription requests failing with an authentication error?
When the subscription login expires, AI calls fail with a message like "Claude subscription authentication has expired." The fix is always the same: run `claude` in a terminal to log in again, then restart Graphium. Graphium itself has no login button — the CLI is the single source of truth for subscription auth.
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
