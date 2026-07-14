// 版スナップショット（ユーザーが手動で残す全文スナップショット）の型定義。
//
// 既存の document-provenance（自動改訂）が「差分メタ＋contentHash のみ・本文を持たない」
// のに対し、版は「その瞬間の全文 doc をまるごと凍結」する点が異なる。
// Word でファイルを日付・通し番号で増やしていた作業を、散らからない形で置き換える。
//
// 保存経路は StorageProvider.writeAppData（内部データチャネル）。listFiles を通らないため
// ノート一覧・検索・グラフに一切出ず、INDEX_SCHEMA_VERSION も据え置き（破壊的変更なし）。

/** 手動で残した版のメタデータ（リスト表示用の軽量サマリ） */
export interface SnapshotMeta {
  /** 版の一意 ID。全文 doc の保存キー `snapshot:<id>` に使う */
  id: string;
  /** 元ノートのファイル ID */
  noteId: string;
  /** 自動採番（1..N、ノート内で単調増加）。UI では v1, v2, ... と表示する */
  version: number;
  /** 任意のラベル（ユーザーが後から付ける「予算増額版」など）。未命名なら undefined */
  label?: string;
  /** 版を残した日時（ISO 8601） */
  savedAt: string;
  /**
   * 全文の SHA-256（既存 computePageHash と同じ pages[0] ベース）。
   * 直近版との重複判定（無駄な版を作らない）と、将来の改ざん検知・先取権証明に使う。
   */
  contentHash: string;
}
