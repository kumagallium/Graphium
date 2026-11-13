---
layout: home

hero:
  name: Graphium
  text: ユーザーマニュアル
  tagline: Graphium の使い方を、最初のノートから、素材・AI・来歴まで説明します。
  image:
    light: /logo.png
    dark: /logo-light.png
    alt: Graphium
  actions:
    - theme: brand
      text: はじめる
      link: /ja/getting-started
    - theme: alt
      text: アプリを開く
      link: https://kumagallium.github.io/Graphium/app/

features:
  - icon: ✍️
    title: まず、書く
    details: ノートもメモも、軽快なブロックエディタで書けます。表・画像・数式も使えます。アカウント登録も設定も要らず、書きながら履歴が残ります。
    link: /ja/notes-and-editor
  - icon: 📥
    title: どんどん放り込める
    details: PDF・Web ページ・Word・画像・音声、そしてスマホからの記録も入れられます。整理は後回しで構いません。
    link: /ja/materials-and-citations
  - icon: 🔎
    title: それでも再利用できる
    details: 放り込んだものは、検索で見つかります。検索はノートと素材を横断し、画像の中の文字も対象です。@ を使うと、ノート・メモ・出典をつなげられます。
    link: /ja/notes-and-editor
  - icon: 🕸️
    title: 来歴は必要なときだけ
    details: 手順・入力・ツール・パラメータ・出力に印を付けると、どう進めたかが図になります。標準の PROV 形式で書き出せます。AI は要りません。
    link: /ja/labels-and-provenance
  - icon: 🤖
    title: AI がすぐ隣に
    details: 書いているノートについて AI と話せます。⌘K（Windows は Ctrl+K）で問いかけることもできます。答えは自分のノートを根拠にして、出どころも示します。手持ちのサブスクや API キーで動きます。
    link: /ja/ai-setup
  - icon: 💡
    title: 育っていくナレッジ
    details: ノートから要約・知見・洞察を取り出してまとめます。どれも出典を示します。外の知識と照合することもできます。
    link: /ja/knowledge-layer
---

## このマニュアルの構成

- **[はじめる](/ja/getting-started)**: 日常の基本を説明し、そのあとに、もう一段深い機能への入口を示します。
- **日常の使い方**: エディタ、外部素材、スマホでの記録。
- **さらに先へ**: 手順と来歴グラフ、AI との対話、ナレッジ層。
- **環境とデータ**: デスクトップアプリと、データの置き場所。
- **リファレンス**: 設定一覧、ショートカット、機能ロードマップ、リリース履歴。

各ページの機能には、その機能が初めて登場したバージョンのバッジが付いています（例: <Badge type="tip" text="v0.15.0 (2026-06-05) で追加" />）。これまでの歩みは[機能ロードマップ](/ja/roadmap)に、変更のすべては[リリース履歴](/ja/release-history)にあります。

::: tip 考え方の背景を知りたい場合
このマニュアルは**使い方**を説明します。**なぜこう作られているのか**、つまり来歴を前提にしたノートという発想については、[CONCEPT.ja.md](https://github.com/kumagallium/Graphium/blob/main/docs/CONCEPT.ja.md) をお読みください。内部構造は [ARCHITECTURE.md](https://github.com/kumagallium/Graphium/blob/main/docs/ARCHITECTURE.md)（英語）にあります。
:::

::: info スクリーンショットについて
図は現時点では英語 UI のものを使っています。本文の UI 文言は日本語版アプリの実際の表示に合わせてあります。
:::
