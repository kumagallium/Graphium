// 版の封印（電子実験ノートとしての証拠化）の型定義。
//
// 封印 = 人が残した版を「封印ファイル」に焼き付け、そのバイト列の SHA-256 を
// 外部の時刻証明（RFC 3161 / OpenTimestamps）に預けられる状態にすること。
// 約束するのは「改ざんの検出」と「日付をさかのぼれない」だけ。「消えない」は約束しない
// （ローカルファイルは持ち主が消せる）。設計: docs/internal/eln-seal-timestamp-design-2026-11.md
//
// 保存はすべて appData（listFiles を通らない内部チャネル）。キーに `:` は使わない
// （Windows の NTFS で代替データストリームとして解釈される疑いがあるため）。

/** 封印ファイルの形式名。中身の構造を変えたら数字を上げる */
export const SEAL_FORMAT = "graphium-seal/1";

/** 封印ファイルに入れる素材 1 件 */
export interface SealMediaEntry {
  /** プロバイダ固有の素材 ID */
  fileId: string;
  /** この素材を参照しているブロック ID（doc 直下の参照だけなら空） */
  blockIds: string[];
  name?: string;
  mimeType?: string;
  /** バイト数（ハッシュを取れたときだけ） */
  size?: number;
  /** 素材の中身の SHA-256。素材インデックスの contentHash と同じ "sha256:<hex>" 形式 */
  sha256?: string;
  /** ハッシュを取れなかった理由（sha256 が無いときだけ） */
  unhashedReason?: "too_large" | "unreadable";
}

/** 封印した人（自己申告。証明の対象ではない参考値） */
export interface SealAuthor {
  name: string;
  email?: string;
}

/**
 * 封印ファイルの中身。
 * このオブジェクトを JSON.stringify した文字列を 1 回だけ作り、その UTF-8 バイト列の
 * SHA-256 を sealHash とする。保存・書き出しとも同じ文字列を使い、パースし直して
 * 書き戻さない（キー順が変わるとハッシュが変わるため）。
 */
export interface SealManifest {
  format: typeof SEAL_FORMAT;
  noteId: string;
  snapshotId: string;
  title: string;
  version: number;
  label?: string;
  /** 版を残した時刻（端末時刻） */
  snapshotSavedAt: string;
  /** 封印した時刻（端末時刻。正は時刻証明の受領書の時刻） */
  sealedAt: string;
  /** ノート内の封印の通し番号（1..N） */
  sealIndex: number;
  /** 直前の封印の sealHash（最初の封印は null）。途中の封印が消されたら穴が分かる */
  prevSealHash: string | null;
  author: SealAuthor | null;
  /** 版の全文（GraphiumDocument） */
  document: unknown;
  media: SealMediaEntry[];
}

/** 時刻証明の受領書 1 件のメタ（受領書の本体は appData の receiptKey に置く） */
export interface SealReceipt {
  kind: "rfc3161" | "opentimestamps";
  /** 送り先（TSA / カレンダーの URL） */
  endpoint: string;
  status: "pending" | "confirmed" | "failed";
  /** appData のキー（seal-receipt-<snapshotId>-<n>） */
  receiptKey: string;
  /** 最後に状態を更新した時刻 */
  updatedAt: string;
  /**
   * 続けて失敗した回数（局に届かない・拒否された）。成功したら消える。
   * 5 回続いたら、ノートを開くたびの付け直しを 7 日に 1 回へ控える（止まった局を叩き続けない）
   */
  failures?: number;
  // 証明された時刻は持たない。表示のたびに受領書から読む（メタと受領書の食い違いを作らない）
}

/** SnapshotMeta.seal に入れる封印の要約 */
export interface SnapshotSeal {
  sealedAt: string;
  /** 封印ファイルの SHA-256（hex） */
  sealHash: string;
  sealIndex: number;
  receipts: SealReceipt[];
}
