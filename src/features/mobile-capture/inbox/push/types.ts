// モバイル PWA から個人クラウドの Graphium/Inbox へ直接アップロードする
// 「push（送信側）」の抽象。既存の InboxTransport（types.ts）が受信側
//（デスクトップが同期フォルダから拾う）であるのに対し、こちらは送信側で、
// ブラウザからプロバイダ API へ直接書き込む。
//
// v1 の実体は GoogleDrivePusher（drive-pusher.ts）。P1.5 で OneDrive を
// 同じ interface で追加する予定なので、プロバイダ固有の概念（トークン、
// フォルダ ID 等）はこのファイルに漏らさない。
//
// 認可トークンは SPA では約 1 時間で失効する（refresh token なし）。その UX は
// queue.ts の store-and-forward（撮ったら即 IndexedDB へ永続化 → 認証が生きて
// いれば drain）で吸収する。push 層は「失効していたら PushAuthError を投げる」
// ことだけを約束し、リトライ・保全はキュー側の責務とする。

/** push プロバイダの種別。P1.5 で "onedrive" を追加予定。 */
export type PusherKind = "google-drive";

/** push 進捗。resumable はチャンクごと、multipart は開始/完了時に通知される。 */
export type PushProgress = {
  /** 送信済みバイト数。 */
  sentBytes: number;
  /** 総バイト数。 */
  totalBytes: number;
};

/** push 成功時の結果。 */
export type PushResult = {
  /** プロバイダ側のファイル ID（Google Drive では files.id）。 */
  fileId: string;
  /** Inbox に置かれた最終ファイル名。 */
  name: string;
};

/** push のオプション。 */
export type PushOptions = {
  /** 進捗通知（省略可）。 */
  onProgress?: (progress: PushProgress) => void;
};

/**
 * モバイルから受信箱（クラウドの Graphium/Inbox）へ送るプッシャー抽象。
 *
 * ライフサイクル:
 *   isConfigured() → prepare() → connect()（ユーザージェスチャ内）→ push()
 *
 * UI 層が守るべき呼び出し規約は prepare()/connect() の doc コメントを参照。
 */
export interface InboxPusher {
  /** プロバイダ種別。 */
  readonly kind: PusherKind;

  /**
   * 設定（client_id 等）が揃っているか。false のとき UI は接続導線を出さず、
   * 設定案内（自前 client_id の入力）を出す。同期・副作用なし。
   */
  isConfigured(): boolean;

  /**
   * 認可 SDK のロード・初期化などの非同期準備。**ポップアップは出さない**。
   * 冪等（何度呼んでもよい）。UI は接続ボタンを出す画面のマウント時などに
   * 事前に呼んでおくこと — これにより connect() がジェスチャ内で同期的に
   * トークン要求を開始できる。未設定（isConfigured()=false）なら
   * PushConfigError で reject する。
   */
  prepare(): Promise<void>;

  /**
   * 今すぐ push できる有効な認証があるか（有効期限内トークンの有無）。
   * 同期判定・副作用なし。drain の前提チェックにも使う。
   */
  isConnected(): boolean;

  /**
   * 認可を取得する（Google では GIS token model のポップアップ）。
   *
   * **必ずユーザージェスチャ（click 等）のハンドラから直接呼ぶこと。**
   * ハンドラ内で先に await を挟むと iOS Safari がポップアップをブロックする。
   * この実装はトークン要求を「最初の await より前に同期的に」開始する構造に
   * なっているが、それが効くのは呼び出し側が同期的に呼んだときだけである。
   * prepare() が完了していない状態で呼ぶと PushConfigError で reject する
   * （ジェスチャ内で SDK ロードを await する誘惑を API として断つ）。
   */
  connect(): Promise<void>;

  /** 認証を破棄する（トークン失効・キャッシュ破棄）。ベストエフォート。 */
  disconnect(): void;

  /**
   * 1 ファイルを受信箱（Graphium/Inbox）へ送る。
   * 認証が無い/失効している場合は PushAuthError で reject する
   * （キュー側はこれを合図に drain を中断し、アイテムを保全する）。
   */
  push(file: File, opts?: PushOptions): Promise<PushResult>;
}

/** 設定不備（client_id 未設定、prepare 未実行など）。接続導線でなく設定案内を出す合図。 */
export class PushConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushConfigError";
  }
}

/**
 * 認証切れ・未認証。drain はこれを受けたら**全体を中断**し、残りのアイテムを
 * キューに保全する（attempts も消費しない — トークン失効はアイテムの責任ではない）。
 */
export class PushAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushAuthError";
  }
}
