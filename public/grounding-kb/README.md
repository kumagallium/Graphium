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
  seedSource?: string,               // "manual-curated@v1" or "model-cache@<v>"（PR 2B 以降）
  entries: Array<{
    id: string,                      // 一意。CHANGELOG 用にも使う
    verdict: "established" | "supported" | "weak" | "contested",
    claim: string,                   // 主張本文（自然言語）
    rationale: string,               // verdict の根拠（教科書名 / 反証パターン）
    keywords: string[],              // retriever の部分一致語彙（多言語可）
    sources?: Array<{                // optional。contested は無くてもよい
      kind: "distilled",
      ref: string,                   // 教科書 / 論文 / 記事タイトル等
      note?: string,                 // 章番号など補足
      url?: string,                  // optional。Wikipedia や DOI 等の解決可能 URL
    }>,
    version?: number,                // エントリ単位のスキーマ版（PR 2A は省略 = 1）
    generatedByModel?: string,       // "manual-curated@v1" or "<model-id>"（PR 2B 以降の沈殿）
  }>,
}
```

## 2 層構造（PR 2B 以降）

PR 2B から KB は **seed + cache の 2 層** になっている:

| 層 | 場所 | 内容 | 編集 |
|---|---|---|---|
| seed | `public/grounding-kb/<domain>.v1.json` | 手キュレーション固定 | このファイルを直接編集（PR レビュー対象） |
| cache | `appdata` キー `grounding-kb-cache-<domain>` | モデル判定の沈殿 | アプリが自動 append。**手で編集しない** |

`loadKb(domain)` は両層を merge して返す（entry id 重複は cache 優先）。Settings →
**Grounding KB** タブで両層の合成結果を一覧できる。`generatedByModel` で seed
（`manual-curated@v1`）か model 判定かを見分けられる。

## 沈殿の鉄則（コードで強制）

`src/features/world-grounding/kb-cache.ts → isValidForCaching` が以下を assert:

1. `verdict` が 4 値（established / supported / weak / contested）でない entry は沈殿しない（`not_found` 非沈殿）
2. `generatedByModel` が空 / `manual-curated@v1` の entry は沈殿しない（seed 専用印）
3. `claim` / `keywords` が空の entry は沈殿しない（retriever で hit しない壊れた entry）
4. PR 2B は **ローカル個人 cache のみ**。共有 KB（形 2）への沈殿経路は別 PR で convergence
   check (kickoff §6) と一緒に検討する。

URL を入れる場合は実在を確認できるものに限る（誤誘導を避けるため）。Wikipedia
記事 / DOI / 出版社公式ページなどが第一候補。

## キュレーション原則

- **verdict が割れる主張は contested で入れる**（教えるのは「割れている」ことそのもの）
- **keywords は ≥3 言語横断**（日本語 + 英語の同義語を最低でも 2 つずつ）
- 主張は 1 文で書く。長文・複合主張は分割する
- 1 PR で追加するエントリは ≤ 5 件にして review しやすくする

## PR 2A 以降の予定

- PR 2B: LLM fallback（KB ヒットなし時に賢いモデルで照合）
- PR 2B: WikiBanner からの「KB に追加」ショートカット
- 将来: ドメイン拡張 / ユーザー個人 KB のオーバーレイ層
