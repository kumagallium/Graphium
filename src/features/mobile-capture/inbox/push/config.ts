// push（モバイル → Google Drive の Graphium/Inbox 直接アップロード）の設定。
//
// - Google OAuth client_id: 同梱デフォルト + localStorage の自前上書き（一級機能）。
//   上書きは「自分の client_id で使いたい」ユーザー向けで、セルフホストや
//   同梱 ID の割当枯渇時の逃げ道でもある。
// - Drive フォルダ ID キャッシュ: Graphium/Inbox の find-or-create 結果を保存し、
//   毎回のフォルダ解決クエリを省く。404/権限エラー時は drive-pusher 側が破棄する。
//
// 既存 inbox/config.ts（getInboxRoot/setInboxRoot）と同じ try/catch ガード形。

const CLIENT_ID_OVERRIDE_KEY = "graphium-push-google-client-id";
const FOLDER_CACHE_KEY = "graphium-push-drive-folders";

/**
 * 同梱の Google OAuth client_id（GIS token model / popup 型、secret なし）。
 * 旧 Google Drive 連携（google-auth.ts, 2025 撤去）で使っていた Web クライアントを
 * 再利用する — public リポジトリの履歴に既に載っている ID で、Cloud Console の
 * 設定（承認済みオリジン）もそのまま生きている前提。空文字にすると「未同梱」となり、
 * ユーザーの自前 client_id（上書き）だけが使われる。
 *
 * 型注釈は string のまま（リテラル型に狭めない）: 「未同梱ビルド」を表す
 * `!== ""` 比較が、同梱時に TS2367（重なりの無い比較）にならないようにするため。
 */
export const DEFAULT_GOOGLE_PUSH_CLIENT_ID: string =
  "743366655410-p5k3us8jof0ni4tintbkliq6dqhan13d.apps.googleusercontent.com";

/** localStorage に保存された自前 client_id（未設定なら null）。 */
export function getGoogleClientIdOverride(): string | null {
  try {
    return localStorage.getItem(CLIENT_ID_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

/** 自前 client_id を保存する。空文字/null は設定解除（同梱デフォルトに戻る）。 */
export function setGoogleClientIdOverride(clientId: string | null): void {
  try {
    if (clientId === null || clientId.trim() === "") {
      localStorage.removeItem(CLIENT_ID_OVERRIDE_KEY);
    } else {
      localStorage.setItem(CLIENT_ID_OVERRIDE_KEY, clientId.trim());
    }
  } catch {
    // localStorage 不可の環境では黙って無視（getInboxRoot と同じ非致命的挙動）
  }
}

/**
 * 実際に使う client_id を解決する: 自前上書き → 同梱デフォルト の順。
 * どちらも空なら null（= 未設定。isConfigured()=false になり、UI は設定案内を出す）。
 */
export function getGoogleClientId(): string | null {
  const override = getGoogleClientIdOverride();
  if (override && override.trim() !== "") return override.trim();
  if (DEFAULT_GOOGLE_PUSH_CLIENT_ID !== "") return DEFAULT_GOOGLE_PUSH_CLIENT_ID;
  return null;
}

/** Graphium/Inbox の Drive フォルダ ID キャッシュ。 */
export type DriveInboxFolderCache = {
  /** `Graphium` フォルダの ID。 */
  rootId: string;
  /** `Graphium/Inbox` フォルダの ID。 */
  inboxId: string;
};

/** フォルダ ID キャッシュを読む（無い/壊れているなら null）。 */
export function getDriveFolderCache(): DriveInboxFolderCache | null {
  try {
    const raw = localStorage.getItem(FOLDER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DriveInboxFolderCache>;
    if (typeof parsed.rootId === "string" && typeof parsed.inboxId === "string") {
      return { rootId: parsed.rootId, inboxId: parsed.inboxId };
    }
    return null;
  } catch {
    return null;
  }
}

/** フォルダ ID キャッシュを保存する。null で破棄（404/権限エラー時・切断時）。 */
export function setDriveFolderCache(cache: DriveInboxFolderCache | null): void {
  try {
    if (cache === null) {
      localStorage.removeItem(FOLDER_CACHE_KEY);
    } else {
      localStorage.setItem(FOLDER_CACHE_KEY, JSON.stringify(cache));
    }
  } catch {
    // 非致命的
  }
}
