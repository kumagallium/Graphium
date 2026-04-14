# Graphium 設計仕様

> Graphium = Zettelkasten + オプショナル PROV

BlockNote.js ベースのブロックエディタの上に、`@` 参照（知識ネットワーク）と `#` ラベル（PROV 来歴追跡）を載せた汎用ノートアプリ。あらゆる分野の作業記録・思考整理に使えるが、ラベルを活用すると PROV-DM 準拠の来歴グラフが自動生成され、実験科学・ソフトウェア開発・プロジェクト管理等で特に威力を発揮する。

---

## 実装ステータス

> **2026-04 現在、Phase 1〜5 のすべてが実装済み。** デスクトップアプリ（Tauri v2）・国際化（en/ja）・3種のストレージプロバイダーも利用可能。

---

## ドキュメント構成

| ファイル | 内容 |
|---|---|
| [01-principles.md](01-principles.md) | 設計原則・ドメイン前提 — すべての判断の土台 |
| [02-concepts.md](02-concepts.md) | コアコンセプト — スコープ・Zettel・MOC・メディアレジストリ |
| [03-notation.md](03-notation.md) | 記法と操作 — # ラベル・@ 参照・3つの入口 |
| [04-data-model.md](04-data-model.md) | データモデル — 3層構造・型定義・リンク・同期・ストレージ |
| [05-ui.md](05-ui.md) | 画面構成と可視化 — レイアウト・右パネル・インジケーター |
| [06-samples.md](06-samples.md) | 応用例: 実験科学 — 試料管理と3層構造（Protocol / Instruction / Result） |
| [07-phases.md](07-phases.md) | 段階的開発計画 — 5フェーズのロードマップと実装状況 |
| [08-scalability.md](08-scalability.md) | スケーラビリティと共同編集 — インデックスファイル・Yjs・制約 |

---

## 読み方

- **設計の全体像を知りたい** → 01 → 02 → 03 の順に読む
- **実装を始めたい** → 04（データモデル）→ 07（フェーズ）
- **試料管理の方針を議論したい** → 06
- **チームに共有したい** → 07（段階的開発計画）が最もコンパクト

---

## 技術スタック

| 技術 | 役割 |
|---|---|
| React + TypeScript | UI フレームワーク |
| Vite | ビルドツール |
| BlockNote.js | ブロックエディタ。フォークせず、上にラベルとリンクを載せる |
| Cytoscape.js + ELK | グラフ描画（PROV グラフ + 知識ネットワーク） |
| Tauri v2 | デスクトップアプリ（macOS / Windows / Linux） |
| Hono + Vercel AI SDK | AI バックエンド（MCP ツール統合） |
| Google Drive API / IndexedDB / Filesystem | ストレージプロバイダー（3種） |
| i18n（カスタム実装） | 国際化（英語 / 日本語） |
