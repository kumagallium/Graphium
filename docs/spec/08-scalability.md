# スケーラビリティと共同編集の設計

Phase 1-3 の実装時点では不要だが、設計判断がこれらを妨げないようにするための方針。

---

## 1. インデックスファイル（実装済み）

> `.graphium-index.json` と `.graphium-media-index.json` として実装済み。ノート保存時に差分更新され、@ 候補・被参照数・ネットワークグラフの描画に使用されている。

### 問題

現在の設計では、`@` 候補の表示、被参照数の計算、backlink の構築、ノート一覧のフィルタ — すべてが「全ノートファイルを Drive API で取得して中身を読む」ことを前提にしている。

| ノート数 | 体験 |
|---|---|
| 〜50 | 問題なし |
| 〜200 | 一覧取得が遅くなる (files.list のページング + 各ファイルの読み込み) |
| 〜1000 | @ 検索・被参照数計算が実用的でなくなる |

### 解決策: `.graphium-index.json`

全ノートの軽量なメタデータを1つの JSON ファイルに集約し、Google Drive に保存する。起動時にこのファイルだけ読めば、個別ノートを開かなくても以下が動作する:

- `@` オートコンプリートの候補表示
- 被参照数の計算（ノート一覧のソートに使用）
- backlink の構築
- ノート一覧のフィルタ・検索
- **ネットワークグラフ全体の描画**（全ノートのリンク構造がインデックスに入っている）

### インデックスの構造

```typescript
type GraphiumIndex = {
  version: 1;
  updatedAt: string;
  notes: NoteIndexEntry[];
};

type NoteIndexEntry = {
  noteId: string;           // Google Drive ファイル ID
  title: string;
  modifiedAt: string;

  // スコープ情報（@ 候補に使う）
  headings: {
    blockId: string;
    text: string;
    level: 2 | 3;
  }[];

  // ラベル情報（アセットブラウザ・フィルタに使う）
  labels: {
    blockId: string;
    label: string;          // "[手順]", "[結果]" etc.
    preview: string;        // ブロックのテキスト先頭50文字
  }[];

  // リンク情報（ネットワークグラフ・backlink・被参照数に使う）
  outgoingLinks: {
    targetNoteId: string;
    targetBlockId?: string;
    layer: "prov" | "knowledge";
  }[];

  // メディア情報（アセットブラウザに使う）
  media: {
    mediaId: string;
    fileName: string;
    type: "image" | "pdf" | "data";
  }[];
};
```

### リンク構造からの逆引き

被参照数と backlink はインデックスから計算できる:

```typescript
// 被参照数: noteId が他ノートの outgoingLinks に何回出現するか
function getIncomingLinkCount(index: GraphiumIndex, noteId: string): number {
  return index.notes.filter(n =>
    n.outgoingLinks.some(link => link.targetNoteId === noteId)
  ).length;
}

// backlink: noteId を参照しているノート一覧
function getBacklinks(index: GraphiumIndex, noteId: string): NoteIndexEntry[] {
  return index.notes.filter(n =>
    n.outgoingLinks.some(link => link.targetNoteId === noteId)
  );
}
```

### ネットワークグラフの全体描画

インデックスに全ノートの `outgoingLinks` が入っているため、個別ノートを開かなくてもネットワーク全体のグラフが描画できる:

```typescript
// Cytoscape.js のノードとエッジをインデックスから生成
function buildFullGraph(index: GraphiumIndex) {
  const nodes = index.notes.map(n => ({
    data: {
      id: n.noteId,
      label: n.title,
      incomingCount: getIncomingLinkCount(index, n.noteId),
    }
  }));

  const edges = index.notes.flatMap(n =>
    n.outgoingLinks
      .filter(link => link.layer === "knowledge")
      .map(link => ({
        data: {
          source: n.noteId,
          target: link.targetNoteId,
        }
      }))
  );

  return { nodes, edges };
}
```

これにより、右パネルの Graph タブは現在のノートの2ホップ近傍だけでなく、「全ノートのネットワーク俯瞰」も表示可能になる。被参照数の多いノードは大きく表示すれば、MOC 的なハブが視覚的に浮かび上がる。

### 更新タイミング

- **ノート保存時:** 保存したノートの `NoteIndexEntry` をインデックス内で差分更新し、インデックスファイルを Drive に書き戻す。
- **ノート作成・削除時:** エントリを追加・削除。
- **起動時:** インデックスファイルを1回読み込み、メモリに展開。以降はメモリ上で操作。

### Phase 1-3 での対応

Phase 1-3 ではインデックスファイルを実装しなくてよい。ただし、以下のように設計しておく:

```typescript
// データソースの抽象化
interface NoteMetadataSource {
  getAllNotes(): Promise<NoteIndexEntry[]>;
  getBacklinks(noteId: string): Promise<NoteIndexEntry[]>;
  getIncomingLinkCount(noteId: string): Promise<number>;
  searchNotes(query: string): Promise<NoteIndexEntry[]>;
}

// Phase 1-3: 全ファイル走査で実装
class DriveDirectSource implements NoteMetadataSource { ... }

// 将来: インデックスファイルから読み込み
class IndexFileSource implements NoteMetadataSource { ... }
```

この抽象化があれば、後からデータソースを差し替えるだけでインデックスに移行できる。

---

## 2. 共同編集

### BlockNote の Yjs サポート

BlockNote は Yjs（CRDT ベースのリアルタイム同期ライブラリ）をファーストクラスでサポートしている。設定は以下のように簡潔:

```typescript
import * as Y from "yjs";

const doc = new Y.Doc();
const provider = new SomeYjsProvider("document-id", doc);

const editor = useCreateBlockNote({
  collaboration: {
    provider: provider,
    fragment: doc.getXmlFragment("document-store"),
    user: {
      name: "ユーザー名",
      color: "#ff0000",
    },
  },
});
```

対応プロバイダー: PartyKit, Y-Sweet (Jamsocket), Liveblocks, Hocuspocus。

### Graphium で Yjs を導入する場合の構成

```
ユーザーA (ブラウザ)          ユーザーB (ブラウザ)
   ↕ WebSocket                   ↕ WebSocket
   ╔══════════════════════════╗
   ║  Yjs プロバイダーサーバー  ║
   ║  (PartyKit / Y-Sweet /   ║
   ║   Hocuspocus)            ║
   ╚══════════════════════════╝
            ↕ 永続化
   ╔══════════════════════════╗
   ║  Google Drive            ║
   ║  (.graphium.json)        ║
   ╚══════════════════════════╝
```

### ノートレベル vs ブロックレベルの同期

**Yjs が解決するもの:** 1つのノート内のブロック編集の競合。A が見出しを編集中に B が段落を追加しても、CRDT で自動マージされる。カーソル位置の共有、プレゼンスの表示もサポート。

**Yjs が解決しないもの（Graphium 固有の課題）:**

| 課題 | 説明 | 方針 |
|---|---|---|
| `labels` の同期 | A が `#手順` を付けた瞬間、B にもバッジが見える必要がある | `labels` マップを Y.Map として Yjs ドキュメントに持たせる |
| `provLinks` の同期 | PROV リンクの追加・削除を同期 | 同上。Y.Array として同期 |
| `knowledgeLinks` の同期 | @ 参照の追加・削除を同期 | 同上 |
| ノート間の backlink | A がノートXからノートYへの @ を削除 → ノートYの backlink 更新 | インデックスファイルの更新で解決（Yjs のスコープ外） |
| インデックスの競合 | A と B が同時にインデックスを更新 | インデックスファイル自体も Yjs で同期するか、last-write-wins で妥協 |
| `chats` の同期 | AI チャットの対話履歴 | 同一スコープに対して同時にチャットするケースは稀。last-write-wins で十分 |

### labels / links を Yjs で同期する設計

現在の `GraphiumPage` は:

```typescript
type GraphiumPage = {
  blocks: Block[];                // ← Yjs が標準で同期
  labels: Record<string, string>; // ← Graphium 固有。Yjs に載せる必要あり
  provLinks: BlockLink[];         // ← 同上
  knowledgeLinks: BlockLink[];    // ← 同上
};
```

Yjs 導入時は、`labels` / `provLinks` / `knowledgeLinks` を Y.Doc 内の Y.Map / Y.Array として持たせる:

```typescript
const doc = new Y.Doc();

// BlockNote のブロックデータ（BlockNote が管理）
const fragment = doc.getXmlFragment("document-store");

// Graphium 固有のデータ（Graphium が管理）
const labels = doc.getMap("labels");           // Y.Map<string>
const provLinks = doc.getArray("provLinks");   // Y.Array<BlockLink>
const knowledgeLinks = doc.getArray("knowledgeLinks"); // Y.Array<BlockLink>
```

### ノート分離が共同編集に与える恩恵

sampleScope を廃止して試料ごとにノートを分離した設計は、共同編集の衝突リスクを大幅に下げる:

- A が S-A ノートを編集中に B が S-B ノートを編集 → **衝突なし**（別ファイル）
- A が概要ノートの考察を編集中に B が概要ノートの条件テーブルを編集 → **Yjs で自動マージ**（同ファイル内の別ブロック）
- sampleScope で全試料が1ノートにあったら、上記のすべてが同一ファイル内の競合になっていた

### Drive 保存との整合

Yjs を導入しても、最終的な永続化先は Google Drive の JSON ファイル。Yjs プロバイダーがリアルタイム同期を担い、セッション終了時（または定期的に）Yjs ドキュメントから JSON にシリアライズして Drive に保存する。

```
リアルタイム同期中:
  Yjs Y.Doc ←→ Yjs プロバイダー ←→ 他のユーザー

保存時:
  Yjs Y.Doc → blocks + labels + links に変換 → JSON → Drive
```

既存の `GraphiumDocument` のスキーマは変わらない。Yjs はトランスポート層であり、永続化層（Drive JSON）には影響しない。

### Phase 1-3 での対応

Phase 1-3 では Yjs を導入しない。ただし、以下のように設計しておく:

- `labels` / `provLinks` / `knowledgeLinks` の読み書きを直接 JSON オブジェクトに行うのではなく、ストア（React Context や Zustand）経由にする
- 将来 Yjs を導入するとき、ストアの実装を「JSON オブジェクト」から「Y.Map / Y.Array」に差し替えるだけで移行できる

---

## 3. その他の制約と方針

### drive.file スコープの制約

Graphium は `drive.file` スコープで OAuth を取得している。このスコープでは、アプリ経由で作成/開いたファイルにのみアクセスできる。

- Graphium が作成したノートファイル → アクセス可能
- Graphium が作成したメディアファイル → アクセス可能
- ユーザーが Drive に直接アップロードしたファイル → アクセス不可

メディアレジストリ（Phase 5）では、画像やPDFはすべて Graphium 経由でアップロードされるため、`drive.file` スコープ内で動作する。ユーザーが Drive に直接置いたファイルを Graphium から参照したい場合は、Graphium 内で「インポート」操作を行い、アプリのスコープに取り込む必要がある。

### オフライン動作

Local Storage プロバイダー（IndexedDB）と Filesystem プロバイダー（Tauri デスクトップ）はオフラインで動作する。Google Drive プロバイダーはネットワーク接続が必要。将来的に対応する場合は:

- Yjs のオフラインサポート（ローカルの IndexedDB に変更を保持し、復帰時に同期）が基盤になる
- Service Worker でのキャッシュも候補
- ただし、Graphium のオープンβの段階では優先度は低い

### テスト戦略

Phase ごとの実装仕様書（claude-code-phase3.md 等）に具体的なテスト手順を記載する。仕様書全体としての方針:

- Phase 1-3 は手動テスト中心。エッジケースは実装仕様書に列挙
- インデックスファイル導入時にメタデータの整合性テストを追加
- Yjs 導入時に競合解決のテストシナリオを追加
