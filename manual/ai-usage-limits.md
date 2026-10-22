# AI usage and free tiers

How much AI each Graphium feature uses per run, and roughly how far each free AI service gets you in a month. Use it when you choose where to connect.

::: info About the numbers on this page
- Free-tier terms are taken from each service's official pages **as of 2026-10-22**. Free tiers change without notice; check the service's own page before you rely on one
- Graphium's numbers are medians from the developer's own usage log (2026-07 to 2026-10, about 12,000 calls). Real usage goes up or down with the length of your sources, the size of your knowledge, and the model
- **Model assumption**: every service is calculated with **gpt-oss-120b** (except Copilot, which uses its default model on the day of measurement). Models count tokens differently and think for different lengths before they answer, so another model can shift the numbers by 20–30%, and a model that thinks a lot can shift them further
- No service is recommended here. Services are listed in name order
:::

## How much AI each Graphium feature uses

AI usage depends on the **number of calls**, and on the **input tokens** sent and **output tokens** returned on each call. A token is roughly three-quarters of an English word, or one to two Japanese characters.

| Feature | Per run | Input (median) | Output (median) |
|---|---|---|---|
| **Knowledge ingest** (per 4,000 characters of source) | about 11 calls | about 90,000 tokens in total | about 10,000 tokens in total |
| One chat turn | 1 call or more (several when tools are used) | 6,000–10,000 (up to 90,000 on heavy turns) | 500–1,200 |
| Voice note cleanup (per segment) | 1 call | 1,000–4,000 | 1,000–3,000 |
| Voice note summary | 1 call | about 20,000 for a long meeting | about 1,000 |
| Extracting a procedure from a source | 1 call | about 17,000–19,000 | about 4,400 |
| World grounding (one claim) | 1 call | about 700 | 200–700 |
| Full knowledge check | 1 call | your whole knowledge (over 250,000 in the developer's case) | about 5,000 |
| Embeddings (for search) | about 17 calls per 4,000 characters | about 90 | — |

**Knowledge ingest is the heaviest feature.** A long source is read in windows of 4,000 characters. Each window runs:

- one claim extraction (it also sends the list of existing claims, so the input is large)
- about 0.6 topic routings
- about 3 topic page revisions
- about 6 source checks

As your knowledge grows, the number of checks and revisions grows with it.

A paper with 40,000–60,000 characters of body text is about 12 windows. The tables below count that as "one paper".

::: warning How much fits in one call (context length)
The first step of knowledge ingest (claim extraction) sends 60,000–110,000 tokens in a single call. A service that accepts less than this per call cannot run knowledge ingest.

The full knowledge check sends your whole knowledge in one call. When your knowledge is large, it may not fit in models limited to 128K (about 128,000) tokens.
:::

## Free AI services and their limits

| Service | How the free tier is counted | Free tier | Chat models on the free tier |
|---|---|---|---|
| Cloudflare Workers AI | **tokens** (Neurons), per day | 10,000 Neurons a day *1 | Several to choose from (gpt-oss-120b, Llama 3.3 70B, Gemma, Qwen and more) *2 |
| GitHub Copilot (Student) | **tokens** (AI credits), per month | 200 AI credits a month | No choice (automatic selection only) |
| Google Gemini API | requests and tokens, per minute / per day | Shown in Google AI Studio | Flash and Flash-Lite models, and Gemma |
| Mistral AI | requests and tokens | Shown in the admin panel | No official list |
| OpenRouter (free models) | **requests**, per day | 50 a day *3 | Models whose name ends in `:free` (the line-up changes over time) |
| Sakura AI Engine (free base-model plan) | **requests**, per month | Chat 3,000 a month, embeddings 10,000 a month | gpt-oss-120b only (plus two small preview models) |

- *1 gpt-oss-120b costs 31,818 Neurons per million input tokens and 68,182 per million output tokens
- *2 Kimi, GLM and some others need a paid plan
- *3 Up to 20 a minute. 1,000 a day once you have bought 10 credits or more in total

| Service | Used for training | What sign-up needs |
|---|---|---|
| Cloudflare Workers AI | No | A Cloudflare account |
| GitHub Copilot (Student) | Free, Pro and Pro+ are used by default (you can turn it off). GitHub does not say whether Student is included | A GitHub account and student verification |
| Google Gemini API | **Yes** (human reviewers may read it) | A Google account |
| Mistral AI | Yes by default (you can opt out) | An account (no card needed) |
| OpenRouter (free models) | Depends on the provider (a setting excludes providers that train) | An account |
| Sakura AI Engine | No | An account, phone verification and a credit card. Sign-ups are capped |

**How a free tier is counted matters most for Graphium.**

- **Services that count requests** don't care how large each call is, so they handle knowledge ingest, with its large inputs, well
- **Services that count tokens** spend a large share of the allowance on each ingest window. They suit short exchanges such as chat

### What a month gets you

Rough estimates, calculated from Graphium's numbers above.

| Service | Model used for the estimate | Ingest only | Chat only | Notes |
|---|---|---|---|---|
| Cloudflare Workers AI | gpt-oss-120b | 2–3 windows a day (about 7 papers a month) | about 40 turns a day | The allowance is daily, so a long source spills over into the next day |
| GitHub Copilot (Student) | The default model on the day measured (gpt-5.6-sol) | 3–4 windows a month (less than one paper) | about 40 turns a month | See "Converting credits" below |
| GitHub Copilot (Pro level, 1,500 a month) | Same as above | about 27 windows a month (about 2 papers) | about 300 turns a month | Teachers may get Pro for free |
| Google Gemini API / Mistral AI | — | Can't be calculated | Can't be calculated | The official pages give no numbers for the limits |
| OpenRouter (free models) | gpt-oss-120b:free | about 4 windows a day (about 10 papers a month) | about 50 turns a day | Which free models exist, and how much each accepts per call, varies by model |
| Sakura AI Engine | gpt-oss-120b | about 270 windows a month (about 20 papers) | about 3,000 turns a month | When busy, it may turn requests away for a while even within the allowance |

Rows that use different models differ in the quality of the answers, not only in amount. The Copilot rows in particular are figures for a stronger model than the other rows.

Chat and knowledge ingest share the same allowance. In a month when you chat a lot, less is left for ingest.

**Converting credits (Copilot):** GitHub sets 1 AI credit at $0.01, but publishes no table of how many credits a call uses. The estimates above come from the developer's own measurement on 2026-10-22. With the default model, a call used 400 units per million input tokens and 2,000 units per million output tokens. Those units are counted as credits here. On Student and Free, the model is chosen automatically, so usage changes with the model chosen.

### Services whose free tier doesn't fit

| Service | Why |
|---|---|
| Groq | Even the published limit (the Developer plan) is 8,000 tokens a minute for gpt-oss-120b, so the first ingest step can't go through. Free-plan limits are only shown in the console |
| Cerebras | No ongoing free tier (only a 30-day trial that needs a card). The trial is also limited to 30,000 tokens a minute |
| Hugging Face Inference Providers | No monthly allowance for free users |
| GitHub Models | Retired on 2026-07-30 |

## Hints for choosing

- **If you put in research data or unpublished results**, choose a service that doesn't use its free tier for training. Some services that do train let you turn it off
- **If you want to ingest many papers at once**, a service that counts requests, or a paid plan, fits better
- **If you mostly chat**, a service that counts tokens is often enough
- **You can combine services.** Under [Model assignment](/ai-setup#model-assignment), you can give knowledge ingest (the default model) and chat different services. Chat also sends your notes, though, so the chat service's training terms apply to them too

> Note: Graphium's developer is an employee of Sakura Internet. This page is information from a personal development project, not something the company asked for or paid for. Every service is measured against the same yardstick.

## Sources

- Cloudflare: [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) / [gpt-oss-120b](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/) / [Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- GitHub Copilot: [Plans](https://docs.github.com/en/copilot/get-started/plans) / [Usage-based billing for individuals](https://docs.github.com/copilot/concepts/billing/usage-based-billing-for-individuals) / [Student plan updates](https://github.com/orgs/community/discussions/189268) / [Interaction data policy](https://github.blog/news-insights/company-news/updates-to-github-copilot-interaction-data-usage-policy/)
- Google: [Pricing](https://ai.google.dev/gemini-api/docs/pricing) / [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) / [Additional terms](https://ai.google.dev/gemini-api/terms)
- Mistral AI: [Usage limits](https://docs.mistral.ai/admin/billing-usage/usage-limits) / [Training on your data](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models)
- OpenRouter: [Limits](https://openrouter.ai/docs/api-reference/limits) / [Logging and training](https://openrouter.ai/docs/guides/privacy/logging)
- Sakura Internet: [Sakura AI Engine](https://ai.sakura.ad.jp/sakura-ai/ai-engine/) / [Getting started (Japanese)](https://manual.sakura.ad.jp/cloud/ai-engine/02-howto.html) / [Terms (Japanese)](https://www.sakura.ad.jp/corporate/wp-content/themes/sakura-corporate/assets/pdf/yakkan_ai-engine.pdf)
- Groq: [Rate limits](https://console.groq.com/docs/rate-limits) / Cerebras: [Rate limits](https://inference-docs.cerebras.ai/support/rate-limits) / Hugging Face: [Pricing](https://huggingface.co/docs/inference-providers/pricing) / GitHub Models: [Retirement](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)
