// push（モバイル → Google Drive の Graphium/Inbox 直接アップロード）の設定。
//
// - Google OAuth client_id: 同梱デフォルト + localStorage の自前上書き（一級機能）。
//   上書きは「自分の client_id で使いたい」ユーザー向けで、セルフホストや
//   同梱 ID の割当枯渇時の逃げ道でもある。
// - Drive フォルダ ID キャッシュ: Graphium/Inbox の find-or-create 結果を保存し、
//   毎回のフォルダ解決クエリを省く。404/権限エラー時は drive-pusher 側が破棄する。
// - 選択プロバイダ: ストレージ選択画面（StoragePickerSheet）でユーザーが選んだ
//   push プロバイダ。現状は google-drive 一択だが、P1.5 の OneDrive 追加時に
//   「どの pusher を組み立てるか」の分岐点になる（未保存は google-drive 扱い）。
//
// 既存 inbox/config.ts（getInboxRoot/setInboxRoot）と同じ try/catch ガード形。

import { emitPushStatusChanged } from "../push-events";
import type { PusherKind } from "./types";

const CLIENT_ID_OVERRIDE_KEY = "graphium-push-google-client-id";
const FOLDER_CACHE_KEY = "graphium-push-drive-folders";
const FOLDER_CACHE_STAY_KEY = "graphium-push-drive-folders-stay";
const AUTH_MODE_KEY = "graphium-push-auth-mode";
const LEGACY_USER_KEY = "graphium-push-legacy-user";
/** hourly 方式のアクセストークン保存キー（google-auth.ts と同じ値。既存利用者の判定にだけ使う）。 */
const HOURLY_TOKEN_KEY = "graphium-push-google-token";
const PROVIDER_KEY = "graphium-push-provider";

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

/**
 * 「つないだまま」方式（stay）用の Google OAuth client_id（GIS code model / popup 型）。
 * **hourly 方式（DEFAULT_GOOGLE_PUSH_CLIENT_ID）とは別の Google Cloud プロジェクトの client** を使う。
 * 理由: 旧 Drive 連携（2026-04 撤去）が hourly の client で drive.file を使ってノートを
 * Drive に保存していた。長く使える refresh token を同じ client で出すと、万一 token broker が
 * 侵害されたときに旧ノートまで届いてしまう。client を分けることで、被害を stay で送った
 * ファイルに閉じ込める。
 * 空文字なら「未同梱」で stay は無効（型は string のまま — 理由は上と同じ）。
 */
export const DEFAULT_GOOGLE_STAY_CLIENT_ID: string =
  "646458374293-s1ag4e5hglrckjvlvgev5mj7a7r8sd2s.apps.googleusercontent.com";

/**
 * token broker（Cloudflare Worker）の URL。authorization code → refresh token の交換と
 * アクセストークンの取り直しを担う。空文字なら stay は無効。
 * 宛先の差し替え口（localStorage 上書き等）は意図的に作らない — XSS で宛先を
 * 奪われると code / refresh token が外へ出るため、ビルド定数に固定する。
 */
export const DEFAULT_TOKEN_BROKER_URL: string = "";

/** 認可の方式。stay = つないだまま（broker 経由の refresh token）、hourly = 約 1 時間ごとにつなぎ直し。 */
export type PushAuthMode = "stay" | "hourly";

/** テスト専用の注入口（メモリ上のみ。localStorage 等の外部入力からは差し替えられない）。 */
let stayDefaultsForTest: { clientId: string; brokerUrl: string } | null = null;

/** テスト専用: 同梱定数の代わりに使う stay 設定を差し込む。null で元に戻す。本番コードから呼ばない。 */
export function __setStayDefaultsForTest(value: { clientId: string; brokerUrl: string } | null): void {
  stayDefaultsForTest = value;
}

/**
 * stay 方式の設定。定数のどちらかが空、または自前 client_id の上書きがあるときは null
 * （自前 client の人は hourly のまま）。brokerUrl は末尾スラッシュを落とす。
 */
export function getStayConnectedConfig(): { clientId: string; brokerUrl: string } | null {
  const clientIdConst = stayDefaultsForTest?.clientId ?? DEFAULT_GOOGLE_STAY_CLIENT_ID;
  const brokerUrlConst = stayDefaultsForTest?.brokerUrl ?? DEFAULT_TOKEN_BROKER_URL;
  if (clientIdConst === "" || brokerUrlConst === "") return null;
  const override = getGoogleClientIdOverride();
  if (override && override.trim() !== "") return null;
  return {
    clientId: clientIdConst,
    brokerUrl: brokerUrlConst.replace(/\/+$/, ""),
  };
}

/** 保存済みの方式の好み（未保存・不正値は null）。 */
export function getAuthModePreference(): PushAuthMode | null {
  try {
    const raw = localStorage.getItem(AUTH_MODE_KEY);
    return raw === "stay" || raw === "hourly" ? raw : null;
  } catch {
    return null;
  }
}

/** 方式の好みを保存する。null で解除。購読面へ変更を伝える。 */
export function setAuthModePreference(mode: PushAuthMode | null): void {
  try {
    if (mode === null) localStorage.removeItem(AUTH_MODE_KEY);
    else localStorage.setItem(AUTH_MODE_KEY, mode);
  } catch {
    // localStorage 不可の環境では黙って無視（他の設定と同じ非致命的挙動）
  }
  emitPushStatusChanged();
}

/** 既存利用者の印を書いて固定する。 */
function markLegacyPushUser(): void {
  try {
    localStorage.setItem(LEGACY_USER_KEY, "1");
  } catch {
    // 非致命的
  }
}

/**
 * 「hourly の client で Drive にフォルダを作ったことがある」既存利用者か。
 * 印がある、または hourly のフォルダキャッシュ / トークンが残っていれば true で、
 * その場合は印を書いて固定する（後でキャッシュを消されても判定が変わらないように）。
 *
 * 限界: 判定できるのは「この端末に以前の接続の跡が残っている人」だけ。以前に切断して
 * 跡が消えた人は新規として扱われる（drive.file では、旧 client が作ったフォルダの有無を
 * 新 client から調べられないため）。
 */
export function isLegacyPushUser(): boolean {
  try {
    if (localStorage.getItem(LEGACY_USER_KEY)) return true;
    if (
      localStorage.getItem(FOLDER_CACHE_KEY) !== null ||
      localStorage.getItem(HOURLY_TOKEN_KEY) !== null
    ) {
      markLegacyPushUser();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 今使う方式を決める。
 * - stay が使えない（定数が空・自前 client 上書き）→ hourly
 * - 好みが保存済み → それ
 * - 未保存 → 既存利用者なら hourly、そうでなければ stay
 *
 * 既存利用者を黙って切り替えない理由: client が違うと drive.file では相手が作った
 * フォルダが見えず、stay は Drive に新しい `Graphium/Inbox` を作る。黙って切り替えると
 * パソコン側が見張っている古いフォルダに届かなくなる（機能欠落）。そのため既存利用者は
 * 自分で切り替えたときだけ stay にする。
 */
export function resolveAuthMode(): PushAuthMode {
  if (getStayConnectedConfig() === null) return "hourly";
  const preference = getAuthModePreference();
  if (preference) return preference;
  return isLegacyPushUser() ? "hourly" : "stay";
}

const INBOX_FOLDER_KEY = "graphium-mobile-inbox-folder";

/**
 * 送ったものを入れるフォルダ（未設定なら null）。
 *
 * 送信のたびに選ばせず、一度決めたら覚えておく — モバイルは「素早く放り込む」道具で、
 * 毎回の選択はその速さを損なう。切り替えたいときだけ設定から変える。
 */
export function getInboxFolder(): string | null {
  try {
    const v = localStorage.getItem(INBOX_FOLDER_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function setInboxFolder(folder: string | null): void {
  try {
    if (!folder || !folder.trim()) localStorage.removeItem(INBOX_FOLDER_KEY);
    else localStorage.setItem(INBOX_FOLDER_KEY, folder.trim());
  } catch {
    // localStorage 不可の環境では黙って無視（他の設定と同じ非致命的挙動）
  }
}

const INBOX_FOLDER_HISTORY_KEY = "graphium-mobile-inbox-folder-history";
const FOLDER_HISTORY_MAX = 12;

/**
 * この端末で送り先にしたことのあるフォルダ（新しい順）。
 *
 * 受信箱だけ使う構成だと、この端末の vault は空でフォルダの候補が手元に無い。
 * PC から一覧を貰う道は Drive のスコープ（drive.file = アプリが作ったものだけ）で
 * 塞がっているので、一度打ったものを覚えて次から選べるようにする。
 */
export function getInboxFolderHistory(): string[] {
  try {
    const raw = localStorage.getItem(INBOX_FOLDER_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** 使ったフォルダを履歴の先頭へ。同じものは畳み、古いものから落とす。 */
export function rememberInboxFolder(folder: string): void {
  const value = folder.trim();
  if (!value) return;
  try {
    const next = [value, ...getInboxFolderHistory().filter((v) => v !== value)];
    localStorage.setItem(INBOX_FOLDER_HISTORY_KEY, JSON.stringify(next.slice(0, FOLDER_HISTORY_MAX)));
  } catch {
    // localStorage 不可の環境では黙って無視（他の設定と同じ非致命的挙動）
  }
}

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
  // 設定モーダルで変えた configured をモバイルホームの送信キューが読み直せるように
  emitPushStatusChanged();
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

/**
 * 選択済みの push プロバイダを読む。未保存・不正値は google-drive（v1 の唯一の実体）。
 * 保存値の検証はホワイトリスト方式 — 将来 "onedrive" を足すときにここへ追記する。
 */
export function getPushProvider(): PusherKind {
  try {
    const raw = localStorage.getItem(PROVIDER_KEY);
    if (raw === "google-drive") return raw;
    return "google-drive";
  } catch {
    return "google-drive";
  }
}

/**
 * ストレージ選択画面で選ばれたプロバイダを保存する。接続成功時に UI 側が呼ぶ
 * （選んだだけで未接続のものは保存しない — 実際に使えた経路だけを覚える）。
 */
export function setPushProvider(kind: PusherKind): void {
  try {
    localStorage.setItem(PROVIDER_KEY, kind);
  } catch {
    // localStorage 不可の環境では黙って無視（getInboxRoot と同じ非致命的挙動）
  }
  emitPushStatusChanged();
}

/** Graphium/Inbox の Drive フォルダ ID キャッシュ。 */
export type DriveInboxFolderCache = {
  /** `Graphium` フォルダの ID。 */
  rootId: string;
  /** `Graphium/Inbox` フォルダの ID。 */
  inboxId: string;
};

function folderCacheKey(mode: PushAuthMode): string {
  return mode === "stay" ? FOLDER_CACHE_STAY_KEY : FOLDER_CACHE_KEY;
}

/** フォルダ ID キャッシュを読む（無い/壊れているなら null）。キャッシュは方式ごとに別。 */
export function getDriveFolderCache(mode: PushAuthMode): DriveInboxFolderCache | null {
  try {
    const raw = localStorage.getItem(folderCacheKey(mode));
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

/**
 * フォルダ ID キャッシュを保存する。null で破棄（404/権限エラー時・切断時）。
 * hourly のキャッシュを書くときは既存利用者の印も付ける。
 */
export function setDriveFolderCache(mode: PushAuthMode, cache: DriveInboxFolderCache | null): void {
  try {
    if (cache === null) {
      localStorage.removeItem(folderCacheKey(mode));
    } else {
      localStorage.setItem(folderCacheKey(mode), JSON.stringify(cache));
      if (mode === "hourly") markLegacyPushUser();
    }
  } catch {
    // 非致命的
  }
}
