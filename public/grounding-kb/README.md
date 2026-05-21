# Distilled grounding knowledge base

世界モデル照合（world-model-grounding, Phase 2）で参照する **蒸留 KB** の置き場。

ここに置かれた JSON は Graphium のビルド成果物にバンドルされ、ランタイムでは
`${import.meta.env.BASE_URL}grounding-kb/seed.v1.json` 経由で fetch される。

## 設計思想

蒸留 KB は **人間がキュレーションした「教科書的に確立した主張」「典型的な反例 / 過度の一般化」のリスト** で、
LLM を呼ばずに verdict を返せる軽量レイヤとして機能する。

- 個別判断・ノート内容（**形 1**）は決して KB に入れない（プライバシー / 文脈依存）
- 領域全体で安定した主張（**形 2**）だけを蒸留する
- ロングテールはあえて拾わない。`null` で degrade する方が嘘より良い

詳細は `docs/internal/collective-knowledge-design.md`（Knowledge Pack 構想）と
`docs/internal/world-model-grounding-implementation-kickoff-2026-05.md` §5-4 を参照。

## ファイル構成（PR 2C 以降）

```
seed.v1.json
```

- 単一ファイル固定（domain 分割なし）
- `seed` = 出荷時の手キュレーション分。沈殿キャッシュは `appdata/grounding-kb-cache`
- `N`: schema バージョン（互換破壊で bump）
- entry は分野ラベル（domain / tag）を持たない

PR 2C で domain 分割と tag 生成の両方を撤廃した理由は `docs/internal/world-model-grounding-implementation-kickoff-2026-05.md` の PR 2C 節を参照（「料理 / 経済 / software のように境界が本質的に曖昧な主張に分類を強いると、retriever / 沈殿 / フィルタのいずれにも実利がない」）。

## エントリ・スキーマ（v1）

```ts
{
  version: 1,
  checkedBy: string,                 // "distilled-kb@v1" 固定
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
    version?: number,                // エントリ単位のスキーマ版（省略 = 1）
    generatedByModel?: string,       // "manual-curated@v1" or "<model-id>"（沈殿）
  }>,
}
```

## 2 層構造

KB は **seed + cache の 2 層**:

| 層 | 場所 | 内容 | 編集 |
|---|---|---|---|
| seed | `public/grounding-kb/seed.v1.json` | 手キュレーション固定 | このファイルを直接編集（PR レビュー対象） |
| cache | `appdata` キー `grounding-kb-cache` | モデル判定の沈殿 | アプリが自動 append。**手で編集しない**（Settings → Grounding KB タブから個別削除可） |

`loadKb()` は両層を merge して返す（entry id 重複は cache 優先）。Settings →
**Grounding KB** タブで両層の合成結果を一覧できる。`generatedByModel` で seed
（`manual-curated@v1`）か model 判定かを見分けられる。

## 沈殿の鉄則（コードで強制）

`src/features/world-grounding/kb-cache.ts → isValidForCaching` が以下を assert:

1. `verdict` が 4 値（established / supported / weak / contested）でない entry は沈殿しない（`not_found` 非沈殿）
2. `generatedByModel` が空 / `manual-curated@v1` の entry は沈殿しない（seed 専用印）
3. `claim` / `keywords` が空の entry は沈殿しない（retriever で hit しない壊れた entry）
4. **ローカル個人 cache のみ**。共有 KB（形 2）への沈殿経路は別フェーズで convergence
   check (kickoff §6) と一緒に検討する。

URL を入れる場合は実在を確認できるものに限る（誤誘導を避けるため）。Wikipedia
記事 / DOI / 出版社公式ページなどが第一候補。

## キュレーション原則

- **verdict が割れる主張は contested で入れる**（教えるのは「割れている」ことそのもの）
- **keywords は ≥3 言語横断**（日本語 + 英語の同義語を最低でも 2 つずつ）
- 主張は 1 文で書く。長文・複合主張は分割する
- 1 PR で追加するエントリは ≤ 5 件にして review しやすくする

## 今後の予定

- 共有 KB（形 2）への沈殿経路と convergence check
- Knowledge Pack 連動（`collective-knowledge-design.md`）— pack 切り出しの集約条件は keywords / pack 作成時のレビュー前提（自動分類は持ち込まない）
