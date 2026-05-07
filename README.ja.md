<p align="center">
  <img src="public/logo.png" alt="Graphium" width="80" />
</p>
<h1 align="center">Graphium</h1>
<p align="center">
  <b>情報を、いつでも再利用可能な「知識」へと変えるノートエディタ。</b>
</p>
<p align="center">
  <b>PROV-DM</b> 来歴追跡を備えたブロックベースのノートエディタ（<a href="https://www.blocknotejs.org/">BlockNote.js</a> ベース）
</p>
<p align="center">
  <a href="README.md">English</a> | <b>日本語</b>
</p>

<p align="center">
  <a href="https://github.com/kumagallium/Graphium/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/kumagallium/Graphium?display_name=tag&sort=semver"></a>
  <a href="https://github.com/kumagallium/Graphium/releases"><img alt="dmg downloads" src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/kumagallium/Graphium/badges/badges/dmg-downloads.json"></a>
  <a href="https://github.com/kumagallium/Graphium/actions/workflows/test.yml"><img alt="CI" src="https://github.com/kumagallium/Graphium/actions/workflows/test.yml/badge.svg?branch=main"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/kumagallium/Graphium"></a>
  <a href="https://github.com/kumagallium/Graphium/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/kumagallium/Graphium?style=flat"></a>
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/kumagallium/Graphium">
</p>

Graphium は、[Zettelkasten](https://ja.wikipedia.org/wiki/%E3%83%84%E3%82%A7%E3%83%86%E3%83%AB%E3%82%AB%E3%82%B9%E3%83%86%E3%83%B3) スタイルの小さなノート術と、W3C の来歴標準 [PROV-DM](https://www.w3.org/TR/prov-dm/) を組み合わせた、個人開発のオープンソースプロジェクトです。AI が手渡してくれた一文も含めて、すべての主張をその根拠となるノートまで辿れる状態を目指しています。

### インストール前に読むもの

- 📘 [**CONCEPT**](docs/CONCEPT.ja.md)（[English](docs/CONCEPT.md)）: 設計思想（なぜ来歴か、二つの脳、砂時計）
- 🏗️ [**ARCHITECTURE**](docs/ARCHITECTURE.md): レイヤー、配布形態、Wiki パイプライン、既知の継ぎ目（英語）
- 🗂️ [**DATA_MODEL**](docs/DATA_MODEL.md): JSON 形式、スキーマ、互換性ルール（英語）

## 必要な分だけ使う

Graphium は **段階的開示（progressive disclosure）** を設計の中心に据えています。ラベル付けは任意で、しかも独立した 2 つの層から成ります。

| レベル | やること | 得られるもの |
|--------|---------|-------------|
| **ノートだけ** | `@` 参照でノートを書いてリンクする | ファイルシステム上のリンクされたノート群（Web 版はブラウザ IndexedDB） |
| **ブロックレベルの構造** | 見出しブロックに `[ステップ]`（または Phase の `[計画]` / `[結果]`）を付ける | 来歴グラフの骨格。何が、どの順で起きたか |
| **インラインの詳細** | ブロック内のテキスト範囲を `[インプット]` / `[ツール]` / `[パラメータ]` / `[アウトプット]` でハイライト | 完全な来歴グラフ。何を使い、どんな条件で、何ができたか |

`#` のブロックレベル層とインラインハイライト層は、同じ内容を **2 回なぞる別々の層** であり、全か無かのラベルではありません。ラベルなしで書き始め、後から `#` だけ付け、必要な箇所にだけインラインの詳細を載せる、という使い方ができます。**来歴層は、あなたがラベルを付けた範囲だけで立ち上がります**。このグラデーションこそが設計の中核です。

設計の根拠は [docs/CONCEPT.ja.md §6](docs/CONCEPT.ja.md#6-段階的な開示必要な分だけ使う) を参照してください。

## すぐに試す

**[→ ブラウザでプレビュー（GitHub Pages）](https://kumagallium.github.io/Graphium/)**

ブラウザ版は **プレビュー** です。エディタの感触と PROV-DM ラベリングをお試しいただけます。ノートはこのブラウザの IndexedDB に保存されるため、お試しには十分ですが、AI 機能（Knowledge Layer・AI チャット）や永続的な保存、複数端末同期がほしい場合はデスクトップアプリか Docker セルフホストをご利用ください。

### デスクトップアプリ

デスクトップアプリをダウンロードすると、ノートはあなたのファイルシステム上に JSON ファイルとして保存されます。保存先を Google Drive / iCloud / Dropbox の同期フォルダに指定すれば、追加の OAuth 連携なしでクラウド同期できます。

| プラットフォーム | ファイル | 確認方法 |
|----------------|---------|---------|
| **macOS** (Apple Silicon — M1/M2/M3/M4) | `Graphium_x.x.x_aarch64.dmg` | Apple メニュー → このMacについて → 「Apple M...」|

**[→ Releases からダウンロード](https://github.com/kumagallium/Graphium/releases/latest)**

> **その他のプラットフォーム**
> デスクトップ版は現在 macOS Apple Silicon 向けのみ提供しています。Windows / Linux / Intel macOS をお使いの場合は、[GitHub Pages のブラウザ版](https://kumagallium.github.io/Graphium/)（インストール不要）をご利用いただくか、下記の [Docker セットアップ](#option-2-run-with-docker--editor-only) でセルフホストしてください。他プラットフォームへの再対応はロードマップに含まれています。テスト協力者を歓迎します ([Issues](https://github.com/kumagallium/Graphium/issues))。

### モバイル（停止中）

モバイル向けのクイックキャプチャ（PWA、＋ボタン、カメラからのメディア取り込みなど）は試作しましたが、デスクトップ版と Knowledge Layer の作り込みを優先するため、現在は **停止中** です。ブラウザ版そのものは iOS / Android のホーム画面に追加できますが、モバイル専用の機能（タイムラインビュー、クイックキャプチャ）は積極的にメンテナンスしていません。

再開や手伝いに興味があれば [Issues](https://github.com/kumagallium/Graphium/issues) をご覧ください。

## AI ナレッジレイヤー

LLM を接続すると、Graphium はノートの上に **もう一層** を作ります。あなたが書いた内容から自動生成される、編集可能な AI Wiki です。*LLM で拡張された Zettelkasten* と捉えてください。AI がノートを読み取り、安定したアイデアを抽出し、相互にリンクし、元のブロックへ引用を張ります。エディタの他の要素と同じ PROV-DM 来歴を保ったまま。

Wiki には 4 つのドキュメント種別があり、それぞれ役割が異なります。

| 種別 | 役割 |
|------|------|
| **Summary** | 1 つのノートに対する内部向け要約 |
| **Concept** | 複数ノート横断の整理。要素を抽出しつつ文脈は残す。`level`（principle / finding / bridge）と `status`（candidate / verified）で品質を表現 |
| **Atom** | 実験的レイヤ。文脈を消した「ひとつの主張」+ 引用。プロジェクトを跨いで持ち運べる単位 |
| **Synthesis** | 実験的レイヤ。複数 Atom を編んで生まれる新しい洞察 |

| 機能 | 内容 |
|------|------|
| **5 段のパイプライン** | Ingest → Atomize → Synthesize → Cross-update → Lint。すべてコンパニオンサーバ上で動作し、ノート保存をトリガーに動きます |
| **ノートから Ingest** | AI が知識価値のあるセクションを抽出し、Wiki ページに書き込みます。元ブロックへの引用付き |
| **URL・チャットから Ingest** | URL を貼ったり、AI チャットの応答を保存すると、同じ来歴で Wiki ページに変換されます |
| **Cross-update** | ある Wiki ページが変わると、依存するページがフラグ付けまたは書き直されます |
| **Lint** | 孤立 Atom、壊れた引用、冗長な Concept を検出します |
| **編集の保護** | 手動で編集したセクションは再 Ingest 時にスキップされます。修正が AI に上書きされません |
| **AI チャット用 Retriever** | AI 応答に Wiki コンテキストが注入されます。アシスタントは先週書いた内容を、毎回ノートを読み直さずに覚えています |
| **回答の自動ラベル付け** | AI 回答は PROV-DM 構造が付いた状態で挿入されます。Activity の見出しに `[ステップ]` ラベル、Entity には `[インプット]` / `[ツール]` / `[パラメータ]` / `[アウトプット]` のインラインハイライト、連続する手順には `informed_by` リンクが自動で付きます。チャットそのものから来歴グラフが立ち上がります |

Wiki ページはノートと同じストレージ（Web は IndexedDB、Tauri / Docker はファイルシステム）に保存され、手動で自由に編集できます。Wiki の編集はすべて PROV-DM のリビジョンとして記録されるため、**いつ** 生成され、**どのエージェント**（人 or AI）が書き、**どこから** 派生したかを常に追跡できます。

AI ナレッジレイヤーは **オプトイン** です。**⚙ 設定 → AI Setup** で LLM を設定すると有効になります。LLM を設定しない場合、Graphium は通常のリンクノートエディタとして動作します。

## Composer（⌘K）

書いたものを探す動作と、次に書くことを尋ねる動作を、ひとつのパレットにまとめました。Graphium のどこからでも `⌘K`（または `Ctrl+K`）で開きます。

| 入力 | 動作 |
|------|------|
| タイトル・見出しの一部 | 該当ノートにジャンプ（Wiki エントリも表示） |
| `#ラベル` | コンテキストラベルでフィルタ — `#procedure` / `#step` / `#手順` はすべて同じものを指す |
| `@作者` | 誰が書いたかでフィルタ — 人間はユーザー名、AI はモデル名 |
| 空 | 直近のノート + *発見カード* — 開いているノートと直近 1 週間の Wiki アクティビティ（ingest / cross-update / regenerate / merge）から導出された即時プロンプト |
| `Cmd+Enter` | 入力をジャンプではなく AI アシスタントに送信 |

エディタ・AI ナレッジレイヤー・あなたの過去の作業を、ひとつの動作で結びつける入り口です。

## テンプレート

`/template` スラッシュコマンドで再利用可能な雛形を呼び出せます。

- **Plan テンプレート** — H1 タイトル、背景 / 目的、リファレンステーブル（項目 × 条件）、期待する成果。テーブルの各行はそのまま派生ノートになります。
- **Run テンプレート** — 個別記録用の雛形。ブロックは最初からラベル付けされており（Activity は `[ステップ]`、Entity はインラインの `[インプット]` / `[ツール]` / `[パラメータ]` / `[アウトプット]`）、連続する手順は `informed_by` で繋がっています。「ちゃんとラベルが付いたノート」の見本として活用できます。

語彙は汎用的で、実験ノート、料理、製造、プロジェクト管理など幅広く使えます。ユーザー定義のテンプレートはプログラム的に登録可能（`registerUserTemplate()`）。

## 読みやすさ

ディスレクシア（識字障害）に配慮した字形のほうが読みやすい人がいます。Graphium には **[Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/)** と **[Lexend](https://www.lexend.com/)** が Inter と並ぶ標準選択肢として組み込まれており、**⚙ 設定 → 一般** から切り替えられます。エディタの他の挙動は変わらないので、自分の目に合うものを選んでください。

## 相互運用性

Graphium はプロヴェナンスを **[PROV-JSON-LD](https://www.w3.org/submissions/2024/SUBM-prov-jsonld-20240825/)** としてエクスポートします。これは Linked Data 上に構築された W3C 標準であり、独自形式ではありません。PROV-DM や JSON-LD を理解するあらゆるツールが Graphium の出力を利用できます。プロヴェナンスデータは設計上ポータブルです。

## 使い方

### 方法 1: オンラインで使う（セットアップ不要）

**https://kumagallium.github.io/Graphium/** にアクセスして書き始めるだけ。ノートはこのブラウザの IndexedDB に保存されます。

> **複数の端末で同じノートを使いたい場合**: [デスクトップアプリ](#デスクトップアプリ)を使い、保存先を Google Drive / iCloud / Dropbox の同期フォルダに指定してください。

### 方法 2: Docker で起動 — エディタのみ

Graphium をスタンドアロンのエディタとして起動します。AI や外部サービスは不要で、ノートエディタだけが動作します。

```bash
git clone https://github.com/kumagallium/Graphium.git
cd Graphium
docker compose -f docker-compose.standalone.yml up -d
```

**http://localhost:5174/Graphium/** を開いて書き始められます。

### 方法 3: Docker で起動 — フルスタック（AI + MCP ツール）

ビルトイン AI バックエンド付きで Graphium を起動し、[Crucible Registry](https://github.com/kumagallium/Crucible) で MCP ツール管理も利用できます。

```bash
git clone https://github.com/kumagallium/Graphium.git
cd Graphium
docker compose up -d
```

| URL | 内容 |
|-----|------|
| http://localhost:5174/Graphium/ | Graphium エディタ（AI セットアップ含む） |

> **上級者向け:** [Crucible Registry UI](http://localhost:8081) で MCP サーバーを管理できます。

#### AI モデルの設定

1. **http://localhost:5174/Graphium/** を開く
2. **⚙ 設定 → AI セットアップ** から LLM モデルと API キーを追加
3. AI アシスタント機能を利用開始

#### MCP ツールの追加（オプション）

1. **http://localhost:8081**（Crucible Registry UI）を開く
2. GitHub リポジトリから MCP サーバーを登録
3. **⚙ 設定 → AI セットアップ** にツールが表示され、有効/無効を切り替え可能

`.env` の編集は不要 — すべてブラウザから設定できます。

> **セルフホスト時のストレージ**
> Docker（または任意の Node.js バックエンド）で動かすと、ノートはサーバーのファイルシステム `/app/data` に保存され、同じ URL に接続するすべてのブラウザ・端末で共有されます。フロントエンドが起動時に自動検知します。
> - **クラウドバックアップ**: `volumes: - "~/Google Drive/Graphium:/app/data"` のように同期フォルダを `/app/data` にマウントすれば、OS が複製を担当します。
> - **リモート VPS**: [rclone](https://rclone.org/) などで `/app/data` を S3 / B2 等にバックアップ。
> - **認証**: `GRAPHIUM_AUTH_TOKEN=<secret>` を設定すると、すべてのストレージリクエストに `X-Graphium-Token` ヘッダーが必要になります。同じ値を **⚙ 設定 → サーバーストレージ** で入力してください。未設定だと URL に到達できる人が誰でも読み書きできます — `localhost` 限定なら問題ありませんが、公開デプロイでは必須です。

> **注意:** Docker モードでは、すべてのサービスが API キー認証なしで動作し、ローカルマシン（`localhost`）からのみアクセス可能です。

#### 最新バージョンへの更新

```bash
./update.sh
```

または手動で：

```bash
git pull                      # 最新の Graphium コードを取得
docker compose pull           # 最新の Crucible イメージを取得
docker compose up -d --build  # Graphium をリビルドして全サービスを再起動
```

### 方法 4: 開発用に起動

```bash
git clone https://github.com/kumagallium/Graphium.git
cd Graphium
pnpm install
pnpm dev --port 5174   # → http://localhost:5174/Graphium/
```

ノートはブラウザの IndexedDB に保存されます。AI 機能を使うにはバックエンドサーバーが必要です。`pnpm dev` でフロントエンドとバックエンドが同時に起動します。**⚙ 設定 → AI セットアップ** から LLM モデルを追加してください。

## 機能一覧

- **ブロックレベルのコンテキストラベル** — `[ステップ]`（PROV *Activity*）、Phase 用の `[計画]` / `[結果]`
- **インラインのエンティティハイライト** — ブロック内のテキスト範囲を `[インプット]` / `[ツール]` / `[パラメータ]` / `[アウトプット]` としてハイライト。前 3 つは PROV-DM の *Entity* ノード（内部的に `material` / `tool` サブタイプ）になり、`[パラメータ]` は親 Activity または親 Entity に *Property* として紐づく。同一の指示対象を指す複数のハイライトは同じ `entityId` を共有し、グラフ上で 1 ノードに集約される
- **メディアのインラインラベル** — 画像 / 動画 / 音声 / PDF ブロックも、サイドストア経由で同じ `[インプット]` / `[ツール]` / `[パラメータ]` / `[アウトプット]` ラベルを持てる（BlockNote のインラインスタイルが効かないメディアブロック向け）
- **ブロック間リンク** — 来歴セマンティクス付き（`informed_by` / `derived_from` / `used`）
- **マルチページタブエディタ** — スコープ派生対応
- **リファレンステーブル** — 関連ノートを表形式で管理、サイドピークプレビュー付き
- **PROV-JSON-LD エクスポート** — W3C 準拠のページ単位来歴エクスポート
- **来歴グラフ可視化** — Cytoscape.js + ELK レイアウト
- **ノート間ネットワークグラフ** — Cytoscape.js + fcose レイアウト
- **AI アシスタント** — AI 応答から来歴メタデータ付きのノートを派生
- **AI 自動ラベル付け** — AI 回答に PROV-DM コンテキストラベルと `informed_by` チェーンが自動で付与される
- **AI ナレッジレイヤー** — 編集可能な AI Wiki（*Summary* / *Concept* / *Atom* / *Synthesis* の 4 種別）、5 段のパイプライン（ingest → atomize → synthesize → cross-update → lint）、再 Ingest 時の編集保護
- **Composer（⌘K）** — ノート検索（`#ラベル` / `@作者` フィルタ）、発見カード、AI への質問を 1 つのパレットに統合
- **Skill** — 再利用可能なプロンプトテンプレートを Graphium ドキュメント（`source: "skill"`）として保存。Ingest や対話で適用できる
- **共有とライブラリ** — ノートをコンテンツアドレス型の共有ストアに送り、他者が Library から閲覧・Fork できる。共有時は埋め込みメディアが `shared-blob:` 参照として書き出される
- **テンプレート** — `/template` スラッシュコマンドで Plan / Run の雛形を呼び出せる（拡張可能）
- **読みやすさ設定** — デフォルトは Inter。Atkinson Hyperlegible Next / Lexend を opt-in で切り替え可能（dyslexia 配慮）
- **ローカルファースト保存** — デスクトップ版・Docker 版はファイルシステム上の JSON、Web 版はブラウザ IndexedDB
- **デスクトップアプリ** — Tauri v2 のネイティブアプリ。保存先を Drive / iCloud / Dropbox 同期フォルダに指定すれば、追加の OAuth なしでクラウド同期できる

### スクリーンショット

<table>
  <tr>
    <td><b>コンテキストラベル付きエディタ & サイドバー</b></td>
    <td><b>プロヴェナンスグラフ（PROV-DM）</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/sandbox.png" alt="エディタ" width="400" /></td>
    <td><img src="docs/screenshots/prov-generator.png" alt="プロヴェナンスグラフ" width="400" /></td>
  </tr>
  <tr>
    <td><b>ノート間ネットワークグラフ</b></td>
    <td><b>ラベルギャラリー（インデックステーブル）</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/graph.png" alt="ネットワークグラフ" width="400" /></td>
    <td><img src="docs/screenshots/label-gallery.png" alt="ラベルギャラリー" width="400" /></td>
  </tr>
</table>

## PROV-DM 準拠

Graphium は [W3C PROV Data Model (PROV-DM)](https://www.w3.org/TR/prov-dm/) に準拠した **2 層の来歴モデル** を実装しています。

### 第 1 層: 世界の来歴（ノートが描いている対象についての来歴）

ラベル付けは独立した 2 つの層から成り、両者を組み合わせて 1 つの PROV-DM グラフを生成します。

#### ブロックレベル — 骨格

見出しブロックは `#` メニューからタグ付けできます。

| UI 表示 | 内部キー | PROV-DM 型 | 説明 |
|--------|---------|-----------|------|
| `[ステップ]` | `procedure` | `prov:Activity` | プロセス内のステップ。H2 の見出し境界が `scopeStack` で暗黙的に Activity を作る |
| `[計画]` | `plan` | グルーピング | プロセスの「計画」フェーズ |
| `[結果]` | `result` | グルーピング | プロセスの「結果」フェーズ |

#### インラインハイライト — 詳細

ブロック内のテキスト範囲は次のいずれかとしてハイライトできます。

| UI 表示 | 内部キー | PROV-DM マッピング |
|--------|---------|-------------------|
| `[インプット]` | `material` | `prov:Entity`（`material` サブタイプ。プロセスで変換される物質・データ） |
| `[ツール]` | `tool` | `prov:Entity`（`tool` サブタイプ。装置・器具） |
| `[パラメータ]` | `attribute` | 親 Activity または親 Entity に紐づく *Property*（条件・設定値） |
| `[アウトプット]` | `output` | `prov:Entity`（Activity が生成した成果物） |

同一ブロック内の複数ハイライトが同じ `entityId` を持つ場合、グラフ上では 1 つの Entity ノードに集約されます。これが「同じ指示対象を指す参照」の重複排除キーです。画像 / 動画 / 音声 / PDF ブロックは、`mediaInlineLabels` のサイドストア経由で同じラベルを持てます（BlockNote のインラインスタイルがメディアには効かないため）。

生成される関係: `prov:used`（Usage）、`prov:wasGeneratedBy`（Generation）、`prov:wasInformedBy`（前手順リンク経由）

ブロックレベル層とインライン層は独立しています。ノートはブロックレベルだけ・インラインだけ・両方・どちらもなし、いずれも可能です。**ラベルを付けた範囲だけがグラフに現れます**。

### 第2層: ドキュメントプロヴェナンス — 編集履歴

保存ごとにリビジョンチェーンが PROV-DM として記録されます：

| 概念 | PROV-DM マッピング |
|------|-------------------|
| エディタ（人間または AI） | `prov:Agent` |
| 編集操作 | `prov:Activity`（`startTime` / `endTime` 付き） |
| ドキュメントリビジョン | `prov:Entity`（`prov:generatedAtTime` 付き） |
| エディタ → 編集 | `prov:Association` |
| 編集 → リビジョン | `prov:Generation` |
| リビジョン → 前リビジョン | `prov:Derivation` |

ドキュメントプロヴェナンスはコンテンツプロヴェナンスとは別に `prov:Bundle` としてエクスポートされます。

### PROV-JSON-LD エクスポート

ページ単位のエクスポートは [W3C PROV-JSON-LD 仕様](https://www.w3.org/submissions/2024/SUBM-prov-jsonld-20240825/)に準拠しています：

- [openprovenance コンテキスト](https://openprovenance.org/prov-jsonld/context.jsonld)を使用
- プレフィックスなしの `@type` 値（`Entity`、`Activity`、`Agent`）
- 関係を独立オブジェクトとして表現（`Usage`、`Generation`、`Derivation`、`Association`）
- 標準プロパティ名（`startTime`、`endTime`、`entity`、`activity`、`agent`）

Graphium 固有の拡張は `graphium:` 名前空間（`https://graphium.app/ns#`）を使用します。`graphium:entityType`、`graphium:attributes`、`graphium:editType`、`graphium:summary`、`graphium:contentHash` が含まれます。

## アーキテクチャ（概要）

Graphium は [BlockNote.js](https://www.blocknotejs.org/) ベースの TypeScript / React アプリで、3 つの形態で配布しています。Web PWA（ノートは IndexedDB）、[Tauri v2](https://tauri.app/) のデスクトップアプリ（ノートは JSON ファイルとしてファイルシステムに保存）、そして [Docker](https://www.docker.com/) によるセルフホスト（Node.js のコンパニオンサーバ付き）。コンパニオンサーバは [Hono](https://hono.dev/) の上で動き、AI Knowledge Layer のパイプライン（ingest → atomize → synthesize → cross-update → lint）を担います。

| コンポーネント | 技術 |
|--------------|------|
| エディタ | TypeScript / React / BlockNote.js |
| AI ランタイム | Vercel AI SDK |
| コンパニオンサーバ | Node.js / Hono |
| ストレージ | IndexedDB（Web）/ ファイルシステム（Tauri / Docker） |
| デスクトップ | Tauri v2（現状は macOS Apple Silicon のみ。今後の対応はロードマップ） |
| グラフ可視化 | Cytoscape.js |
| ビルド・パッケージ管理 | Vite / pnpm |

レイヤー詳細・Wiki パイプラインのトリガーフロー・配布形態・認証モデル・既知の継ぎ目は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を、JSON 形式と互換性ルールは [docs/DATA_MODEL.md](docs/DATA_MODEL.md) を参照してください（いずれも英語）。

### Crucible Registry（オプション）

[Crucible Registry](https://github.com/kumagallium/Crucible) は MCP サーバーの管理と自動検出を提供します。接続すると、登録済み MCP ツールが **⚙ 設定 → AI セットアップ** に表示され、AI アシスタントが利用できるようになります。

## エディタの外から書く

Graphium のノートは Graphium 内で書く必要はありません。同梱の [`save-to-graphium`](scripts/claude-code-skill/save-to-graphium/SKILL.md) スキルを使うと、[Claude Code](https://claude.com/claude-code)（CLI または VS Code 拡張）の会話を要約して Graphium のノートとして保存できます。ノートには `agent: "claude-code"`、モデル名、OS ユーザー名が PROV-DM のエージェントメタデータとして記録されるので、AI との議論も手書きノートと同じ来歴の流れに乗ります。

```bash
ln -s "$(pwd)/scripts/claude-code-skill/save-to-graphium" ~/.claude/skills/save-to-graphium
```

シンボリックリンクを張れば、あとは Claude Code に「これを Graphium に保存して」と頼むだけ。次回 Graphium 起動時にサイドバーに現れ、リンクを張ったり、ラベルを付けたり、Knowledge Layer に流し込んだりできます。

## 言語と国際化

Graphium は**英語**（デフォルト）と**日本語**をサポートしています。言語はサイドバーの **⚙ 設定** から切り替えられます。

コンテキストラベル、メニュー、ツールチップ、パネル UI など、すべてのユーザー向けテキストが完全に国際化されています。コンテキストラベルはアクティブなロケールに応じて表示されます（例: 英語では `[Step]`、日本語では `[ステップ]`）。内部データ形式は後方互換性のため安定しています。

| 要素 | 状態 |
|------|------|
| コンテキストラベル | 完全ローカライズ済み（英語 / 日本語） |
| UI テキスト | 完全ローカライズ済み |
| ラベル入力 | 両言語のエイリアスを受け付け（例: `[step]`、`[材料]`） |
| README / ドキュメント | 英語 / 日本語 |

追加言語のコントリビューションを歓迎します。

## 開発

```bash
pnpm install        # 依存関係のインストール
pnpm dev            # フロントエンド + バックエンド開発サーバー
pnpm dev:client     # フロントエンドのみ
pnpm dev:server     # バックエンドのみ
pnpm test           # テスト実行（vitest）
pnpm storybook      # コンポーネントカタログ（http://localhost:6006）
pnpm build          # プロダクションビルド（フロントエンド）
```

## プロジェクト構成

以下のツリーは、よく触るディレクトリだけをピックアップした **抜粋ビュー** です。すべての feature と「X を変えたい時にどこを見るか」のフルマップは [ARCHITECTURE.md §8](docs/ARCHITECTURE.md#8-source-map) を参照してください（英語）。

```
src/
├── base/              # エディタコア（BlockNote ラッパー、マルチページ）
├── features/
│   ├── context-label/ # ブロック用 PROV-DM コンテキストラベル
│   ├── block-link/    # ブロック間プロヴェナンスリンク
│   ├── prov-generator/# PROV-JSON-LD 生成 & グラフ可視化
│   ├── prov-export/   # W3C PROV-JSON-LD ファイルエクスポート
│   ├── index-table/   # 関連ノートのインデックステーブル
│   ├── network-graph/ # ノート間派生ネットワーク（Cytoscape + fcose）
│   ├── ai-assistant/  # AI チャット & ノート派生、マーカーによる自動ラベル付け
│   ├── composer/      # ⌘K パレット: ノート検索 + 発見カード + AI 質問
│   ├── template/      # /template スラッシュコマンド（Plan / Run）
│   ├── wiki/          # AI ナレッジレイヤー（Concept / Summary / Synthesis）
│   ├── settings/      # 設定モーダル（一般設定 + AI セットアップ + 読みやすさフォント）
│   └── release-notes/ # リリースノート表示
├── lib/               # ユーティリティ（Google Auth、Drive API、Cytoscape セットアップ）
└── blocks/            # カスタム BlockNote ブロック
```

## ライセンス

[Apache License 2.0](LICENSE)
