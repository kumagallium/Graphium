# Distilled grounding knowledge base

世界モデル照合（world-model-grounding, Phase 2）で参照する **蒸留 KB** の置き場。

ここに置かれた JSON は Graphium のビルド成果物にバンドルされ、ランタイムでは
`${import.meta.env.BASE_URL}grounding-kb/<name>.v<N>.json` 経由で fetch される。

## 設計思想

蒸留 KB は **人間がキュレーションした「教科書的に確立した主張」「典型的な反例 / 過度の一般化」のリスト** で、
LLM を呼ばずに verdict を返せる軽量レイヤとして機能する。

- 個別判断・ノート内容（**形 1**）は決して KB に入れない（プライバシー / 文脈依存）
- 領域全体で安定した主張（**形 2**）だけを蒸留する
- ロングテールはあえて拾わない。`null` で degrade する方が嘘より良い

詳細は `docs/internal/collective-knowledge-design.md`（Knowledge Pack 構想）と
`docs/internal/world-model-grounding-implementation-kickoff-2026-05.md` §5-4 を参照。

## ファイル命名

```
<domain>.v<N>.json
```

- `domain`: `materials` / `software` / `biology` / ...（PR 2A は `materials` のみ）
- `N`: schema バージョン（互換破壊で bump）

## エントリ・スキーマ（v1）

```ts
{
  version: 1,
  domain: string,                    // ファイル名と一致
  checkedBy: string,                 // PR 2A は "distilled-kb@v1" 固定
  entries: Array<{
    id: string,                      // 一意。CHANGELOG 用にも使う
    verdict: "established" | "supported" | "weak" | "contested",
    claim: string,                   // 主張本文（自然言語）
    rationale: string,               // verdict の根拠（教科書名 / 反証パターン）
    keywords: string[],              // retriever の部分一致語彙（多言語可）
    sources?: Array<{                // optional。contested は無くてもよい
      kind: "distilled",
      ref: string,
      note?: string,
    }>,
  }>,
}
```

## キュレーション原則

- **verdict が割れる主張は contested で入れる**（教えるのは「割れている」ことそのもの）
- **keywords は ≥3 言語横断**（日本語 + 英語の同義語を最低でも 2 つずつ）
- 主張は 1 文で書く。長文・複合主張は分割する
- 1 PR で追加するエントリは ≤ 5 件にして review しやすくする

## PR 2A 以降の予定

- PR 2B: LLM fallback（KB ヒットなし時に賢いモデルで照合）
- PR 2B: WikiBanner からの「KB に追加」ショートカット
- 将来: ドメイン拡張 / ユーザー個人 KB のオーバーレイ層
