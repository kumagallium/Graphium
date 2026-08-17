// 語彙インデックス（BM25）— ノート本文 / Wiki セクション / 素材テキストの全文検索コア
//
// - tokenizer: Intl.Segmenter（日本語）+ CJK bigram。埋め込みモデル非依存・完全ローカル
// - lexical-index: MiniSearch ラッパ（ソース単位で差し替え可能）
// - index-store: IndexedDB への再構築可能なキャッシュ
// - service: 復元・投入・reconcile・デバウンス保存のシングルトン
// - fuse: 埋め込み検索と束ねるための RRF

export { tokenize, queryTerms, normalizeText, findTermRanges } from "./tokenizer";
export { chunkNoteDocument, chunkPlainText, splitLongText, type TextChunk } from "./chunk";
export {
  LexicalIndex,
  LEXICAL_FORMAT_VERSION,
  docId,
  type LexicalDoc,
  type LexicalHit,
  type LexicalSearchOptions,
  type LexicalSourceInput,
  type LexicalSourceKind,
  type LexicalSourceSummary,
  type LexicalIndexSnapshot,
} from "./lexical-index";
export { lexicalIndexStore } from "./index-store";
export {
  lexicalSearch,
  type LexicalStatus,
  type DesiredSource,
  type SourceLoader,
  type ReconcileOptions,
} from "./service";
export { reciprocalRankFusion, type RankedItem, type FusedItem } from "./fuse";
export { buildSnippet, type Snippet } from "./snippet";
export { bestHitsBySource, type BestHit } from "./best-hits";
export { desiredNoteSources, desiredAssetSources, fnv1a } from "./sources";
export { useLexicalIndexSync, useLexicalStatus, currentScopeKey, type LexicalSyncParams } from "./use-lexical-sync";
