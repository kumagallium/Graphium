// 別ウィンドウ（参照用の表示ウィンドウ）の入口と、メインとの連絡口。
//
// なぜ「表示だけ」のウィンドウか:
//   2 つのウィンドウが同じノートを編集できると、後から保存した側が先の編集を上書きする
//   （保存に競合検知が無い）。書く場所をメインの 1 つに保ち、別ウィンドウは読むだけにする。
//
// ウィンドウは 1 枚だけ。2 回目に開くと中身を差し替える（デスクトップは Rust が既存の
// ウィンドウへ行き先を送る。Web は同じ名前の window.open が同じウィンドウを開き直す）。
//
// 連絡の経路:
//   デスクトップ … Tauri のイベント（WebView どうしで BroadcastChannel が届く保証が無い）
//   Web         … BroadcastChannel（同じオリジンのタブ・ウィンドウに届く）

import { isTauri } from "./platform";

/** 別ウィンドウに出すもの。id はピークの行き先 ID（`wiki:` / `skill:` / `snapshot:` 付きのまま） */
export type ViewerTarget = { kind: "note"; id: string };

const PARAM_KIND = "viewer";
const PARAM_ID = "id";
/** Web 版のウィンドウ名。同じ名前で開くと既存のウィンドウを使い回す */
const WEB_WINDOW_NAME = "graphium-viewer";
const WEB_WINDOW_FEATURES = "popup=yes,width=760,height=900";
const CHANNEL_NAME = "graphium-viewer";
/** 行き先 ID の長さの上限（Rust 側の open_viewer_window と同じ値） */
const MAX_ID_LENGTH = 512;

// Tauri のイベント名（Rust 側の lib.rs と揃える）
const EVT_SET_TARGET = "viewer-set-target";
const EVT_NOTE_SAVED = "viewer-note-saved";
const EVT_OPEN_IN_MAIN = "viewer-open-in-main";

function isValidTarget(v: unknown): v is ViewerTarget {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.kind !== "note" || typeof o.id !== "string") return false;
  if (o.id.length === 0 || o.id.length > MAX_ID_LENGTH) return false;
  // パスの区切りと `..` は受け取らない（Rust 側の is_valid_viewer_id と同じ。ID はノートのファイル名になる）
  return !/[/\\\u0000-\u001f]/.test(o.id) && !o.id.includes("..");
}

/** URL のクエリから行き先を読む（`?viewer=note&id=<id>`）。別ウィンドウでなければ null */
export function parseViewerTarget(search: string): ViewerTarget | null {
  const params = new URLSearchParams(search);
  const target = { kind: params.get(PARAM_KIND), id: params.get(PARAM_ID) };
  return isValidTarget(target) ? target : null;
}

/**
 * このページが別ウィンドウとして開かれていれば、その行き先を返す。メインなら null。
 * デスクトップは Rust がページの読み込み前に置く `window.__GRAPHIUM_VIEWER__`、
 * Web は URL のクエリから読む。
 */
export function getViewerTarget(): ViewerTarget | null {
  if (typeof window === "undefined") return null;
  const injected = (window as unknown as { __GRAPHIUM_VIEWER__?: unknown }).__GRAPHIUM_VIEWER__;
  if (isValidTarget(injected)) return { kind: injected.kind, id: injected.id };
  return parseViewerTarget(window.location.search);
}

/**
 * Web 版の別ウィンドウの URL。見本モード（?demo=）は引き継ぐ
 * （引き継がないと、別ウィンドウが見本でなく本人のデータを読みに行く）。
 */
export function buildViewerUrl(target: ViewerTarget, loc: { pathname: string; search: string }): string {
  const params = new URLSearchParams();
  const demo = new URLSearchParams(loc.search).get("demo");
  if (demo) params.set("demo", demo);
  params.set(PARAM_KIND, target.kind);
  params.set(PARAM_ID, target.id);
  return `${loc.pathname}?${params.toString()}`;
}

/**
 * 別ウィンドウで開く。開けたら true（Web 版でポップアップが止められたら false）。
 * クリックの中から呼ぶこと — Web 版は最初の await より前に window.open するので、
 * 利用者の操作として扱われる。
 */
export async function openViewerWindow(target: ViewerTarget): Promise<boolean> {
  if (!isValidTarget(target)) return false;
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_viewer_window", { id: target.id });
      return true;
    } catch (e) {
      console.error("[viewer-window] open failed", e);
      return false;
    }
  }
  const win = window.open(buildViewerUrl(target, window.location), WEB_WINDOW_NAME, WEB_WINDOW_FEATURES);
  if (!win) return false;
  win.focus();
  return true;
}

// ── 連絡口 ──

type Message =
  | { type: "note-saved"; id: string }
  | { type: "open-in-main"; id: string };

/** Web: 1 通だけ送る。受け口を持ち続けない（送るたびに開いて閉じる） */
function postToChannel(message: Message): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.postMessage(message);
    ch.close();
  } catch {
    // 連絡は補助。届かなくても別ウィンドウは手前に来たときに読み直す
  }
}

/** Web: 指定した種類の連絡を受ける */
function subscribeChannel<T extends Message["type"]>(type: T, fn: (id: string) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (e: MessageEvent) => {
    const data = e.data as Partial<Message> | null;
    if (data && data.type === type && typeof data.id === "string") fn(data.id);
  };
  return () => ch.close();
}

/** デスクトップ: Tauri のイベントを受ける。解除は登録の完了を待ってから行う */
function subscribeTauri<P>(event: string, fn: (payload: P) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<P>(event, (e) => fn(e.payload)))
    .then((un) => {
      if (disposed) un();
      else unlisten = un;
    })
    .catch((e) => console.error(`[viewer-window] listen ${event} failed`, e));
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/**
 * メイン側: ノートを保存したことを別ウィンドウへ知らせる（別ウィンドウは同じノートなら読み直す）。
 * 別ウィンドウが開いていなければ何も起きない。id はプレフィックス付きのフルキー。
 */
export function notifyViewerNoteSaved(id: string): void {
  // 別ウィンドウ自身は保存しない（読むだけ）
  if (getViewerTarget()) return;
  if (isTauri()) {
    void import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo("viewer", EVT_NOTE_SAVED, { id }))
      .catch(() => {});
    return;
  }
  postToChannel({ type: "note-saved", id });
}

/** 別ウィンドウ側: メインがノートを保存したとき */
export function onViewerNoteSaved(fn: (id: string) => void): () => void {
  if (isTauri()) return subscribeTauri<{ id?: unknown }>(EVT_NOTE_SAVED, (p) => {
    if (p && typeof p.id === "string") fn(p.id);
  });
  return subscribeChannel("note-saved", fn);
}

/** 別ウィンドウ側（デスクトップ）: 開いたまま、別のものを出すよう頼まれたとき */
export function onViewerTargetChange(fn: (target: ViewerTarget) => void): () => void {
  if (!isTauri()) return () => {};
  return subscribeTauri<unknown>(EVT_SET_TARGET, (p) => {
    if (isValidTarget(p)) fn({ kind: p.kind, id: p.id });
  });
}

/** 別ウィンドウ側: いま見ているノートをメインのウィンドウで開いてもらう（編集したいとき） */
export function requestOpenInMain(id: string): void {
  if (isTauri()) {
    // メインを手前に出すところまで Rust がやる
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("viewer_open_in_main", { id }))
      .catch((e) => console.error("[viewer-window] open in main failed", e));
    return;
  }
  postToChannel({ type: "open-in-main", id });
  // Web: 開いた元のウィンドウを手前へ（ブラウザが許す範囲で）
  try {
    (window.opener as Window | null)?.focus();
  } catch {
    // 別オリジンへ移っていた等。無視する
  }
}

/** メイン側: 別ウィンドウから「メインで開く」を頼まれたとき */
export function onOpenInMainRequest(fn: (id: string) => void): () => void {
  if (getViewerTarget()) return () => {};
  if (isTauri()) return subscribeTauri<unknown>(EVT_OPEN_IN_MAIN, (p) => {
    if (typeof p === "string" && p.length > 0) fn(p);
  });
  return subscribeChannel("open-in-main", fn);
}
