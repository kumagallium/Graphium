# AI の使用量と無料枠の目安

Graphium の AI 機能が 1 回にどれだけ AI を使うかと、無料で使える接続先それぞれで月にどこまで回せるかの目安をまとめます。接続先を選ぶときの材料にしてください。

::: info このページの数字について
- 各社の無料枠は **2026-10-22 時点** の公式ページの記載です。無料枠は予告なく変わります。使う前に、各社のページで最新の条件を確かめてください
- Graphium 側の数字は、開発者の手元の使用量ログ（2026-07〜10、約 1 万 2 千回分）の中央値です。資料の長さ・ナレッジの大きさ・モデルによって、実際の量は上下します
- **モデルの前提**: 換算はどの接続先でも **gpt-oss-120b** で計算しています（Copilot だけは、計測した日の既定のモデル）。トークンの数え方や、答える前に考える量はモデルごとに違うので、別のモデルでは 2〜3 割、考える量の多いモデルではそれ以上ずれることがあります
- どの接続先も勧めていません。並びは名前の順です
:::

## Graphium の AI 機能が使う量

AI の利用量は、**呼び出しの回数**と、1 回に送る**入力のトークン数**・返ってくる**出力のトークン数**で決まります。トークンはおおよそ、英語で 1 単語弱、日本語で 1〜2 文字です。

| 機能 | 1 回あたり | 入力（中央値） | 出力（中央値） |
|---|---|---|---|
| **ナレッジ化**（資料 4,000 字ごと） | 約 11 回の呼び出し | 合計 約 9 万トークン | 合計 約 1 万トークン |
| チャット 1 往復 | 1 回〜（ツールを使うと数回） | 6,000〜1 万（重い回は 9 万） | 500〜1,200 |
| 音声ノートの清書（区切りごと） | 1 回 | 1,000〜4,000 | 1,000〜3,000 |
| 音声ノートの要約 | 1 回 | 長い会議で 約 2 万 | 約 1,000 |
| 資料から手順を起こす | 1 回 | 約 1.7〜1.9 万 | 約 4,400 |
| 世界照合（知見 1 件） | 1 回 | 約 700 | 200〜700 |
| フル点検 | 1 回 | ナレッジ全体（手元では 25 万以上） | 約 5,000 |
| 埋め込み（検索用） | 資料 4,000 字ごとに 約 17 回 | 約 90 | — |

**ナレッジ化が一番重い処理です。** 長い資料は 4,000 字ごとの窓に分けて読み、窓ごとに次の処理を回します。

- 知見の抽出 1 回（既にある知見の一覧も一緒に送るので、入力が大きい）
- 話題への振り分け 約 0.6 回
- 話題ページの改訂 約 3 回
- 出典との照合 約 6 回

ナレッジが育つほど、照合と改訂の回数は増えていきます。

本文 4〜6 万字の論文 1 本は、窓およそ 12 個分です。以下の表では、これを「論文 1 本」として換算しています。

::: warning 一度に送れる量（文脈長）
ナレッジ化の 1 回目（知見の抽出）は、1 回の入力が 6〜11 万トークンになります。1 回に受け取れる量がこれより小さい接続先では、ナレッジ化が動きません。

フル点検はナレッジ全体を 1 回で送るので、ナレッジが大きいと、128K（約 12.8 万トークン）までのモデルでは入りきらないことがあります。
:::

## 無料で使える接続先と上限

| 接続先 | 無料枠の数え方 | 無料枠 | 無料枠で使えるチャットモデル |
|---|---|---|---|
| Cloudflare Workers AI | **トークン量**（Neurons）・1 日ごと | 1 日 10,000 Neurons ※1 | 複数から選べる（gpt-oss-120b、Llama 3.3 70B、Gemma、Qwen など）※2 |
| GitHub Copilot（Student） | **トークン量**（AI クレジット）・月ごと | 月 200 AI クレジット | 選べない（自動選択のみ） |
| Google Gemini API | 回数とトークン量・分ごと / 1 日ごと | AI Studio の画面で確認 | Flash・Flash-Lite 系と Gemma |
| Mistral AI | 回数とトークン量 | 管理画面で確認 | 公式の一覧なし |
| OpenRouter（無料モデル） | **回数**・1 日ごと | 1 日 50 回 ※3 | 名前が `:free` で終わるモデル（顔ぶれは時期で変わる） |
| さくらの AI Engine（基盤モデル無償プラン） | **回数**・月ごと | チャット月 3,000 回・埋め込み月 10,000 回 | gpt-oss-120b のみ（ほかは小型のプレビュー 2 つ） |

- ※1 gpt-oss-120b は、入力 100 万トークンで 31,818、出力 100 万トークンで 68,182 Neurons
- ※2 Kimi・GLM などは有料プランのみ
- ※3 1 分 20 回まで。クレジットを累計 10 以上購入すると 1 日 1,000 回

| 接続先 | 学習への利用 | 登録に要るもの |
|---|---|---|
| Cloudflare Workers AI | 使わない | Cloudflare のアカウント |
| GitHub Copilot（Student） | Free・Pro・Pro+ は既定で使う（設定で止められる）。Student が対象かは公式に記載なし | GitHub アカウントと学生の認証 |
| Google Gemini API | **使う**（人が読むこともある） | Google アカウント |
| Mistral AI | 既定で使う（設定で止められる） | アカウント（カード不要） |
| OpenRouter（無料モデル） | 提供元ごとに違う（学習する提供元を外す設定がある） | アカウント |
| さくらの AI Engine | 使わない | アカウント・本人確認の電話認証・クレジットカード。申込数に上限あり |

**数え方の違いが、Graphium では一番効きます。**

- **回数で数える接続先**では、1 回の大きさが関係ないので、入力の大きいナレッジ化に強い
- **トークン量で数える接続先**では、ナレッジ化 1 窓で枠を大きく使う。チャットのような短い往復には向く

### 月に回せる量の目安

上の表の Graphium の数字から計算した目安です。

| 接続先 | 計算に使ったモデル | ナレッジ化だけなら | チャットだけなら | 注意 |
|---|---|---|---|---|
| Cloudflare Workers AI | gpt-oss-120b | 1 日 2〜3 窓（月に論文 約 7 本） | 1 日 約 40 往復 | 1 日ごとの枠なので、長い資料は翌日にまたがる |
| GitHub Copilot（Student） | 計測日の既定モデル（gpt-5.6-sol） | 月 3〜4 窓（論文 1 本に届かない） | 月 約 40 往復 | 下の「クレジットの換算」を参照 |
| GitHub Copilot（Pro 相当・月 1,500） | 同上 | 月 約 27 窓（論文 約 2 本） | 月 約 300 往復 | 教員は無料で Pro を使える場合がある |
| Google Gemini API / Mistral AI | — | 計算できません | 計算できません | 上限が公式ページに数字で載っていないため |
| OpenRouter（無料モデル） | gpt-oss-120b:free | 1 日 約 4 窓（月に論文 約 10 本） | 1 日 約 50 往復 | 無料モデルの顔ぶれと一度に送れる量は、モデルごとに違う |
| さくらの AI Engine | gpt-oss-120b | 月 約 270 窓（論文 約 20 本） | 月 約 3,000 往復 | 混雑時は枠の中でも一時的に断られることがある |

モデルが違う行どうしは、量だけでなく答えの質も違います。とくに Copilot の行は、ほかの行より強いモデルでの数字です。

チャットとナレッジ化は同じ枠を分け合います。チャットを多く使う月は、その分ナレッジ化に回せる量が減ります。

**クレジットの換算（Copilot）:** GitHub は 1 AI クレジットを 0.01 ドルとしています。ただ、1 回の呼び出しが何クレジットになるかの表は公開されていません。上の目安は、開発者が 2026-10-22 に測った値です。既定のモデルで、入力 100 万トークンあたり 400、出力 100 万トークンあたり 2,000 の単位を消費しました。この単位を 1 クレジットとして数えています。Student と Free はモデルが自動で選ばれるので、選ばれたモデルで量が変わります。

### 無料枠では足りない接続先

| 接続先 | 理由 |
|---|---|
| Groq | 公開されている上限（Developer プラン）でも gpt-oss-120b は 1 分 8,000 トークンで、ナレッジ化の 1 回目が通らない。無料プランの値は管理画面でのみ確認できる |
| Cerebras | 恒常的な無料枠がない（30 日の試用のみ、カードが必要）。試用の上限も 1 分 3 万トークン |
| Hugging Face Inference Providers | 無料ユーザーの月の枠がない |
| GitHub Models | 2026-07-30 に提供終了 |

## 選び方の手がかり

- **研究データやまだ公開していない結果を入れる**なら、無料枠で学習に使われない接続先を選んでください。学習に使う接続先でも、設定で止められるものがあります
- **論文をまとめて入れたい**なら、回数で数える接続先か、有料のプランが向いています
- **チャットが中心**なら、トークン量で数える接続先でも十分なことが多いです
- **組み合わせられます。** [モデルの割り当て](/ja/ai-setup#モデルの割り当て)で、ナレッジ化（デフォルトモデル）とチャットに別の接続先を割り当てられます。ただしチャットにもノートの内容が送られるので、学習への利用はチャット側の接続先の条件にも従います

> 注：Graphium の開発者はさくらインターネットの社員です。このページは個人の開発プロジェクトとしての情報提供で、同社の依頼や対価によるものではありません。各社は同じ物差しで並べています。

## 出典

- Cloudflare: [料金](https://developers.cloudflare.com/workers-ai/platform/pricing/) / [gpt-oss-120b](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/) / [データの扱い](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- GitHub Copilot: [プラン](https://docs.github.com/en/copilot/get-started/plans) / [個人の使用量課金](https://docs.github.com/copilot/concepts/billing/usage-based-billing-for-individuals) / [Student の変更点](https://github.com/orgs/community/discussions/189268) / [学習データの方針](https://github.blog/news-insights/company-news/updates-to-github-copilot-interaction-data-usage-policy/)
- Google: [料金](https://ai.google.dev/gemini-api/docs/pricing) / [レート上限](https://ai.google.dev/gemini-api/docs/rate-limits) / [追加利用規約](https://ai.google.dev/gemini-api/terms)
- Mistral AI: [使用量の上限](https://docs.mistral.ai/admin/billing-usage/usage-limits) / [学習への利用](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models)
- OpenRouter: [上限](https://openrouter.ai/docs/api-reference/limits) / [ログと学習](https://openrouter.ai/docs/guides/privacy/logging)
- さくらインターネット: [さくらの AI Engine](https://ai.sakura.ad.jp/sakura-ai/ai-engine/) / [利用手順](https://manual.sakura.ad.jp/cloud/ai-engine/02-howto.html) / [約款](https://www.sakura.ad.jp/corporate/wp-content/themes/sakura-corporate/assets/pdf/yakkan_ai-engine.pdf)
- Groq: [レート上限](https://console.groq.com/docs/rate-limits) ／ Cerebras: [レート上限](https://inference-docs.cerebras.ai/support/rate-limits) ／ Hugging Face: [料金](https://huggingface.co/docs/inference-providers/pricing) ／ GitHub Models: [提供終了](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)
