# データモデル

---

## 3層構造

```
BlockNote ブロックモデル (UI層)
  ↓ blocks をそのまま保存
ProvNoteDocument (永続化層・Google Drive)
  = blocks + labels + provLinks + knowledgeLinks + chats
  ↓ blocks + labels + provLinks から計算
PROV-JSON-LD (出力層・W3C標準) ← 保存しない。毎回再生成。
```

- **BlockNote**: ブロックの型・内容・ネスト構造。provnote は触らず、上にラベルを載せる。
- **ProvNoteDocument**: ラベル・リンク・チャット・ノート間関係。BlockNote の blocks をそのまま含む。
- **PROV-JSON-LD**: blocks + labels + provLinks から generator.ts が生成。knowledgeLinks は含まない（知識層は別グラフ）。

---

## 型定義

### ProvNoteDocument

```typescript
type ProvNoteDocument = {
  version: 2;
  title: string;
  pages: ProvNotePage[];
  noteLinks?: NoteLink[];
  derivedFromNoteId?: string;
  derivedFromBlockId?: string;
  generatedBy?: AgentMeta;
  chats?: ScopeChat[];
  createdAt: string;
  modifiedAt: string;
};
```

### ProvNotePage

```typescript
type ProvNotePage = {
  id: string;
  title: string;
  blocks: Block[];                // BlockNote のブロック木をそのまま
  labels: Record<string, string>; // blockId → ラベル名
  provLinks: BlockLink[];         // DAG 制約あり
  knowledgeLinks: BlockLink[];    // 循環 OK
};
```

### BlockLink

```typescript
type BlockLink = {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  type: ProvLinkType | "reference";
  layer: "prov" | "knowledge";
  createdBy: "human" | "ai" | "system";
  targetPageId?: string;
  targetNoteId?: string;         // Google Drive ファイル ID
};
```

### ScopeChat

```typescript
type ScopeChat = {
  id: string;
  scopeBlockId: string;
  scopeType: "heading" | "block";
  messages: { role: "user"|"assistant"; content: string; timestamp: string }[];
  generatedBy?: AgentMeta;
  createdAt: string;
  modifiedAt: string;
};
```

---

## リンクの二層分離

| 層 | 配列 | 制約 | 作成者 | 用途 |
|---|---|---|---|---|
| PROV 層 | `provLinks` | DAG（循環不可） | システム自動生成 | used, wasGeneratedBy, wasInformedBy |
| 知識層 | `knowledgeLinks` | 循環OK | ユーザー（@ で作成） | reference（1種類のみ） |

PROV-DM は因果関係を DAG で表現するため循環不可。Zettelkasten の参照は双方向で循環が自然。同じ配列に混ぜると DAG 検証が誤発動する。

知識リンクのタイプは `"reference"` の1種類のみ（Zettelkasten の「リンクはリンク」原則）。

---

## labels と blocks の同期

`labels` と `blocks[]` は並行するデータ構造であり、同期ズレが起きうる。

**方針:** BlockNote の `onChange` / `onBlockDelete` イベントで labels を清掃し、保存時に「labels に存在するが blocks に存在しない blockId」をバリデーションで除去。

---

## PROV 生成ロジック

generator.ts は `blocks` + `labels` + `provLinks` から PROV-JSON-LD を計算する。

### 名前空間

| 名前空間 | 用途 | 制約 |
|---|---|---|
| `prov:` | W3C 標準の型・関係 | 固定 |
| `provnote:` | ユーザー定義プロパティ（テーブルヘッダーから自動生成） | 制限なし |
| `rdfs:` | label, comment | 標準 |

### 単一試料の場合

1つの `[手順]` スコープ → 1つの Activity。

### 複数試料の場合（MOC パターン）

各試料ノートが独立した Provenance Graph を持つ。概要ノート（MOC）が Plan Graph に対応する。詳細は [06-samples.md](06-samples.md) を参照。

---

## ドキュメント来歴（Document Provenance）

ノート内容の来歴（Content Provenance）とは別に、**ドキュメント自体の編集操作を PROV-DM で記録**する。

### 二重来歴（Dual Provenance）

| 層 | 何を記録 | データ |
|---|---|---|
| **Content Provenance** | ノート内容の来歴（手順→結果など） | `provLinks`, `knowledgeLinks` |
| **Document Provenance** | ドキュメント自体の編集来歴 | `documentProvenance` |

Content Provenance はノートの「意味的な因果関係」、Document Provenance は「誰がいつ何を編集したか」。

### 型定義

```typescript
type DocumentProvenance = {
  /** prov:Entity — 各保存状態（リビジョン） */
  revisions: RevisionEntity[];
  /** prov:Activity — 編集操作 */
  activities: EditActivity[];
  /** prov:Agent — 編集者 */
  agents: EditAgent[];
};

type RevisionEntity = {
  id: string;                    // "rev_001"
  savedAt: string;               // ISO 8601
  driveRevisionId?: string;      // Google Drive Revision ID
  summary: RevisionSummary;      // 変更サマリ
  wasDerivedFrom?: string;       // 前リビジョン ID → prov:wasDerivedFrom
  wasGeneratedBy: string;        // EditActivity ID → prov:wasGeneratedBy
};

type EditActivity = {
  id: string;                    // "edit_001"
  type: "human_edit" | "ai_generation" | "ai_derivation" | "template_create";
  startedAt: string;
  endedAt: string;
  wasAssociatedWith: string;     // EditAgent ID
};

type EditAgent = {
  id: string;
  type: "human" | "ai";
  label: string;                 // "user" | "claude-3.5-sonnet" など
};

type RevisionSummary = {
  blocksAdded: number;
  blocksRemoved: number;
  blocksModified: number;
  labelsChanged: string[];       // 変更されたラベル名
  provLinksAdded: number;
  provLinksRemoved: number;
  knowledgeLinksAdded: number;
  knowledgeLinksRemoved: number;
};
```

### 保存場所

`ProvNoteDocument.documentProvenance` として JSON ファイル内に保存。

### PROV-JSON-LD 出力

PROV-JSON-LD 生成時、`documentProvenance` は `prov:Bundle` として Content Provenance と分離して出力する。

```jsonc
{
  "@context": { ... },
  "@graph": [ /* Content Provenance（ノート内容の来歴） */ ],
  "provnote:documentProvenance": {
    "@type": "prov:Bundle",
    "@graph": [
      {
        "@id": "rev_002",
        "@type": "prov:Entity",
        "prov:wasDerivedFrom": { "@id": "rev_001" },
        "prov:wasGeneratedBy": { "@id": "edit_002" },
        "prov:generatedAtTime": "2026-04-07T14:30:00Z"
      },
      {
        "@id": "edit_002",
        "@type": "prov:Activity",
        "prov:wasAssociatedWith": { "@id": "agent_human" },
        "prov:startedAtTime": "2026-04-07T14:25:00Z",
        "prov:endedAtTime": "2026-04-07T14:30:00Z"
      },
      {
        "@id": "agent_human",
        "@type": "prov:Agent",
        "rdfs:label": "user"
      }
    ]
  }
}
```

### リビジョン管理ルール

- リビジョンは最新 **100 件** まで保持。超過分は古い順に削除。
- 保存ごとに前回のスナップショットと diff を計算し、`RevisionSummary` を自動生成。
- AI 操作は既存の `generatedBy` を `EditAgent` として統合。

---

## Google Drive 統合

- **形式:** JSON 文字列として保存。MIME タイプ `application/json`、拡張子 `.provnote.json`
- **認証:** OAuth 2.0 (Google Identity Services)。スコープは `drive.file`
- **保存:** `files.update` で更新。自動保存（debounce 付き）
- **読み込み:** `files.get` + `alt=media` で JSON を取得
- **一覧:** `files.list` で `.provnote.json` ファイルを取得
- **ノート間リンクの解決:** `BlockLink.targetNoteId` は Google Drive のファイル ID
- **Revision API:** `revisions.list` でバージョン履歴を取得し、`RevisionEntity.driveRevisionId` と紐付け
