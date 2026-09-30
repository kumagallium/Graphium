// デスクトップの拡大縮小（WebView 本来のページズーム）のフロント側の入口。
//
// 倍率の段・現在値・記憶・二重発火の防止は Rust（src-tauri/src/ui_zoom.rs）が持つ。
// ここは (1) キー・Ctrl + ホイールを拾って Rust のコマンドを呼ぶ (2) 変わったことを
// `ui-zoom-changed` で受け取る、だけをする。TS 側に段の表は持たない（getUiZoom で受け取る）。
//
// デスクトップ（Tauri）以外では全部何もしない。ブラウザ版はブラウザ自身の Ctrl + ± が効く。

import { isTauri } from "./platform";
import { isMacLike } from "./shortcut-label";

/** 変更の出どころ。トーストを出すか（設定・案内のボタンは、その場に倍率が見えているので出さない）の判定に使う */
export type UiZoomSource = "menu" | "key" | "wheel" | "settings" | "hint";

export type UiZoomInfo = {
  level: number;
  levels: number[];
};

export type UiZoomChange = {
  level: number;
  source: UiZoomSource;
  /**
   * false は「端（またはウィンドウ幅で決まる上限）で動かなかった」。倍率は変わらないが、
   * キーを押して無反応に見えないよう、現在の倍率をトーストで見せるために届く。
   */
  changed?: boolean;
};

// ── Rust コマンド ──

async function invokeZoom<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** 現在の倍率と段の表。デスクトップ以外は null */
export async function getUiZoom(): Promise<UiZoomInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invokeZoom<UiZoomInfo>("get_ui_zoom");
  } catch (e) {
    console.warn("[ui-zoom] get_ui_zoom failed", e);
    return null;
  }
}

/** 倍率を直接指定する（Rust が段に丸めて反映・記憶する） */
export async function setUiZoom(level: number, source: UiZoomSource): Promise<void> {
  if (!isTauri()) return;
  try {
    await invokeZoom<void>("set_ui_zoom", { level, source });
  } catch (e) {
    console.warn("[ui-zoom] set_ui_zoom failed", e);
  }
}

/** 1 段動かす。+1 拡大 / -1 縮小 / 0 で 100% に戻す。端では何も起きない */
export async function stepUiZoom(direction: -1 | 0 | 1, source: UiZoomSource): Promise<void> {
  if (!isTauri()) return;
  try {
    await invokeZoom<void>("step_ui_zoom", { direction, source });
  } catch (e) {
    console.warn("[ui-zoom] step_ui_zoom failed", e);
  }
}

/** 倍率が変わったときの購読。解除関数を返す（デスクトップ以外は何もしない） */
export function onUiZoomChanged(cb: (change: UiZoomChange) => void): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen<UiZoomChange>("ui-zoom-changed", (event) => cb(event.payload)),
    )
    .then((fn) => {
      // 購読の準備ができる前に解除された場合は、その場で外す
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch((e) => console.warn("[ui-zoom] listen failed", e));
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}

// ── キー ──

export type ZoomKey = "in" | "out" | "reset";

/** matchZoomKey が見るキーイベントの最小の形（テストで組み立てやすくするため） */
export type ZoomKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/**
 * 拡大縮小のキーかを判定する。
 *
 * - 修飾: mac は ⌘、それ以外は Ctrl。Alt が押されていたら対象外（BlockNote の
 *   見出しショートカット Mod-Alt-0〜6 と衝突させない）。mac の Ctrl のみも対象外。
 * - 拡大: `+` / `=` / `;`、テンキーの +。`;` を入れるのは、JIS 配列の「+」キーが
 *   Shift なしでは `;` のため（Chrome も Ctrl + ; で拡大する）。Shift の有無は問わない。
 * - 縮小: `-`、テンキーの −。ただし JIS の Shift + `-` は `=` になるので、
 *   拡大を先に判定する。
 * - 元に戻す: Shift なしの `0`。
 */
export function matchZoomKey(e: ZoomKeyEvent, isMac: boolean): ZoomKey | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;

  if (e.key === "+" || e.key === "=" || e.key === ";" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.code === "Minus" || e.code === "NumpadSubtract") return "out";
  if (!e.shiftKey && (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0")) return "reset";
  return null;
}

const KEY_DIRECTION: Record<ZoomKey, -1 | 0 | 1> = { in: 1, out: -1, reset: 0 };

// ── Ctrl + ホイール ──

/** 1 段動かすのに要る ホイールの積算量（px 換算） */
export const WHEEL_STEP_THRESHOLD = 100;
/** 段と段の間に最低限空ける時間 */
export const WHEEL_STEP_INTERVAL_MS = 150;
/** これだけ操作が無かったら積算を捨てる */
export const WHEEL_IDLE_RESET_MS = 300;

export type WheelZoomState = {
  /** ホイールの積算（px 換算・符号つき） */
  accum: number;
  /** 直前のホイールイベントの時刻 */
  lastEventAt: number;
  /** 直前に 1 段動かした時刻 */
  lastStepAt: number;
};

export const INITIAL_WHEEL_ZOOM_STATE: WheelZoomState = {
  accum: 0,
  lastEventAt: -Infinity,
  lastStepAt: -Infinity,
};

/** ホイールの delta を px 換算にする（行単位は ×40、ページ単位は ×800） */
export function wheelDeltaToPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 40;
  if (deltaMode === 2) return deltaY * 800;
  return deltaY;
}

/**
 * ホイールを積算して、1 段動かすかを返す純関数。
 * 上に回す（deltaY < 0）で拡大 = +1、下に回して縮小 = -1。
 * 積算が閾値に届いても、直前の段から 150ms 経っていなければ動かさない（積算は閾値で頭打ちにして、
 * 間が空いた次のイベントで 1 段動く）。300ms 操作が無ければ積算を捨てる。
 */
export function reduceWheelZoom(
  state: WheelZoomState,
  input: { deltaY: number; deltaMode: number },
  now: number,
): { state: WheelZoomState; direction: -1 | 1 | null } {
  const base = now - state.lastEventAt > WHEEL_IDLE_RESET_MS ? 0 : state.accum;
  let accum = base + wheelDeltaToPixels(input.deltaY, input.deltaMode);
  let lastStepAt = state.lastStepAt;
  let direction: -1 | 1 | null = null;

  if (Math.abs(accum) >= WHEEL_STEP_THRESHOLD) {
    if (now - state.lastStepAt >= WHEEL_STEP_INTERVAL_MS) {
      direction = accum < 0 ? 1 : -1;
      accum = 0;
      lastStepAt = now;
    } else {
      accum = Math.sign(accum) * WHEEL_STEP_THRESHOLD;
    }
  }
  return { state: { accum, lastEventAt: now, lastStepAt }, direction };
}

// ── 購読の開始 ──

/**
 * キー・Ctrl + ホイールの購読を始める（src/main.tsx の Tauri 分岐から 1 回だけ呼ぶ）。
 * デスクトップ以外では何もしない。解除関数を返す。
 */
export function initUiZoomInput(): () => void {
  if (!isTauri() || typeof window === "undefined") return () => {};

  const mac = isMacLike();

  // capture: エディタや各パネルより先に受ける。⌘S などの既存ハンドラは s しか見ないので衝突しない
  const onKeyDown = (e: KeyboardEvent) => {
    const zoomKey = matchZoomKey(e, mac);
    if (!zoomKey) return;
    e.preventDefault();
    e.stopPropagation();
    void stepUiZoom(KEY_DIRECTION[zoomKey], "key");
  };

  // bubble: PDF ビューア・React Flow・cytoscape は自分で preventDefault するので、
  // その上ではグラフや PDF の拡縮が優先される（defaultPrevented を見て素通しする）
  let wheelState = INITIAL_WHEEL_ZOOM_STATE;
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    e.preventDefault();
    const result = reduceWheelZoom(wheelState, e, performance.now());
    wheelState = result.state;
    if (result.direction !== null) void stepUiZoom(result.direction, "wheel");
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("wheel", onWheel);
  };
}
