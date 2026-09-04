// モバイルキャプチャ Inbox の型定義（Phase 0）。
// 設計: docs/internal/mobile-capture-transport-design-2026-07.md §5
//
// 非同期インボックス型のメディア連携。モバイルが同期フォルダ(iCloud/Dropbox/
// Syncthing 等)の <inbox-root>/Inbox/ に素のメディアを置き、デスクトップ(Tauri)が
// 列挙 → 読み込み → active MediaProvider へ取り込み → Inbox 側は既定で削除
// （keep-archive 設定時は _imported/ へ退避）する。
//
// 注意: 同ディレクトリ階層の capture-store.ts が持つ CaptureEntry/CaptureIndex は
// 「メモ(モバイルキャプチャビュー)」の別レイヤーで、本ファイルの CaptureMeta とは無関係。

/** 撮影メディアの種別。mime の先頭セグメントから導出（画像/音声/動画以外は付与しない）。 */
export type CaptureKind = "image" | "audio" | "video";

/**
 * 1 キャプチャの来歴メタ。「撮影という prov:Activity が生成した prov:Entity」として
 * MediaIndexEntry.capture に格納する（§7）。
 *
 * 設計 §5 は kind を必須にしていたが、実装では mime から常に image/audio/video に
 * 3 分類できるとは限らない（pdf 等も Inbox に入りうる）ため、機械的に必ず得られる
 * id/mime/bytes/checksum のみ必須とし、それ以外は optional に倒す。既存の素材データは
 * capture を持たないので、MediaIndexEntry 側でも optional（後方互換）。
 */
export type CaptureMeta = {
  /** 冪等キー。Phase 0 では content sha256（"sha256:<hex>"）をそのまま使う。 */
  id: string;
  /** content SHA-256（"sha256:<hex>" 形式、computeBlobHash 由来）。二重取込判定に使う。 */
  checksum: string;
  /** MIME タイプ（拡張子優先 → マジックバイト sniff フォールバック）。 */
  mime: string;
  /** バイトサイズ。 */
  bytes: number;
  /** 撮影メディアの種別。mime から導出できたときのみ付く。 */
  kind?: CaptureKind;
  /** 撮影日時（ISO8601）。素ファイルは mtime、それも無ければ未設定。 */
  capturedAt?: string;
  /** 撮影端末情報（Phase 1b の .meta json 由来）。 */
  device?: { platform: string; model?: string; app: string };
  /** 位置情報（Phase 1b）。 */
  geo?: { lat: number; lon: number; acc?: number };
  /** 音声/動画の長さ(ms)。 */
  durationMs?: number;
  /** 撮影時メモ（Phase 1b）。 */
  quickNote?: string;
  /** 撮影時タグ（Phase 1b）。 */
  tags?: string[];
  /**
   * 送信時に指定されたフォルダ。取り込み時に素材の noteContexts へ入れる。
   * 生の写真・動画・音声にはメタを運ぶ経路が無いので、送信名に埋め込んだものを
   * transport が取り出してここへ載せる（push/naming.ts の parseInboxFolder）。
   */
  folder?: string;
};

/**
 * Inbox 上の未取り込みアイテムへの参照。列挙(listPending)が返し、fetch/markImported の
 * 引数になる。FolderInbox では同期フォルダ Inbox/ 直下のファイル名。
 *
 * 受信箱ビューは「取り込む前」に一覧を出すため、name だけでは件数以上のことを
 * 表示できない。Rust の inbox_list が返す FS メタ（サイズ・更新日時）を optional で
 * 併せて運ぶ。transport 実装によっては取れないので、どちらも optional。
 */
export type CaptureRef = {
  /** Inbox/ 直下のファイル名（パス区切りを含まない）。 */
  name: string;
  /** バイトサイズ（FS メタ由来）。サムネ読み込みの上限判定・表示に使う。 */
  bytes?: number;
  /** 最終更新日時（RFC3339 / ISO8601 文字列、FS メタ由来）。 */
  modifiedAt?: string;
};

/** fetch が返す、メディア本体 + 来歴メタの束。 */
export type CaptureBundle = {
  meta: CaptureMeta;
  blob: Blob;
};

/**
 * Inbox からデスクトップへ配送するトランスポート抽象。
 * v1 の唯一の実体は FolderInbox（同期フォルダ）。BYO クラウド(OneDrive/S3)は Phase 3 で
 * 裏を差し替える。push() はモバイル側（Phase 1a の Shortcut では Graphium 外）なので、
 * 受信側の 3 メソッドのみを定義する。
 */
export interface InboxTransport {
  /** Inbox/ の未取り込みアイテムを列挙する。 */
  listPending(): Promise<CaptureRef[]>;
  /** アイテムの本体 + メタを読む。 */
  fetch(ref: CaptureRef): Promise<CaptureBundle>;
  /**
   * 取り込み済みアイテムを _imported/ へ退避する（アーカイブを残す設定のときの後処理）。
   * 既定の後処理は discard（削除）— importer の disposal オプション参照。
   */
  markImported(ref: CaptureRef): Promise<void>;
  /**
   * 取り込み済みアイテムを Inbox から削除する（既定の後処理）。
   * 中身は取り込み時点で vault に着地済みなので、消えるのは冗長コピーのみ。
   */
  discard(ref: CaptureRef): Promise<void>;
}
