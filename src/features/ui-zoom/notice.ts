// 倍率を変えたときの短い表示（トースト）と、画面が狭い環境の案内の出し分け（純関数）

import type { UiZoomSource } from "../../lib/ui-zoom";

/** 案内を閉じた記録のキー */
export const ZOOM_HINT_DISMISSED_KEY = "graphium-zoom-hint-dismissed";
/** ようこそダイアログを閉じた記録のキー（components/WelcomeDialog.tsx と同じ） */
export const WELCOME_SHOWN_KEY = "graphium_welcome_shown";
/** ようこそダイアログを閉じた直後に送るイベント（案内が「閉じた後」に出せるように） */
export const WELCOME_DISMISSED_EVENT = "graphium:welcome-dismissed";

/** アプリが落ち着いてから判定するまでの待ち */
export const ZOOM_HINT_DELAY_MS = 1500;
/** 倍率のトーストを出しておく時間 */
export const ZOOM_TOAST_MS = 2000;

/** 案内の「90% にしてみる」が当てる倍率 */
export const ZOOM_HINT_APPLY_LEVEL = 0.9;

/**
 * トーストを出す変更元か。設定画面・案内のボタンから変えたときは、その場に倍率が
 * 見えているので出さない。起動時の復元は ui-zoom-changed が来ないので出ない。
 */
export function shouldShowZoomToast(source: UiZoomSource): boolean {
  return source === "key" || source === "wheel" || source === "menu";
}

/** モバイルのレイアウトに落ちる幅（use-media-query の useIsDesktop と同じ 768） */
const MOBILE_BREAKPOINT = 768;
/**
 * 「狭い」とみなす画面の CSS px。Windows 150% の 1920×1080 ノート PC は約 1280×720 になる。
 * 見るのはウィンドウ（innerWidth / innerHeight）でなく画面（screen）: 既定のウィンドウは
 * 1200×700 なので、ウィンドウで見ると広い画面でもほぼ常に「狭い」になってしまう。
 */
const NARROW_SCREEN_WIDTH = 1366;
const NARROW_SCREEN_HEIGHT = 720;

export type ZoomHintInput = {
  /** ウィンドウの幅（モバイルのレイアウトかの判定だけに使う） */
  innerWidth: number;
  /** 画面の幅・高さ（window.screen。狭い環境かの判定に使う） */
  screenWidth: number;
  screenHeight: number;
  /** 案内を閉じた記録がある */
  dismissed: boolean;
  /** ようこそダイアログを閉じた記録がある（初回は閉じた後に出す） */
  welcomeShown: boolean;
  /** デスクトップアプリか */
  isDesktop: boolean;
  /** デスクトップの現在の倍率。まだ取れていなければ null */
  level: number | null;
};

/** 画面が狭い環境の案内を出すか */
export function shouldShowZoomHint(input: ZoomHintInput): boolean {
  // モバイルのレイアウトでは出さない
  if (input.innerWidth < MOBILE_BREAKPOINT) return false;
  // 広い画面では要らない
  if (!(input.screenWidth <= NARROW_SCREEN_WIDTH || input.screenHeight <= NARROW_SCREEN_HEIGHT)) {
    return false;
  }
  if (input.dismissed) return false;
  if (!input.welcomeShown) return false;
  // すでに倍率を変えた人には出さない（取れていないうちも出さない）
  if (input.isDesktop && input.level !== 1) return false;
  return true;
}

/**
 * モーダル（ようこそ・旧レイアウトの移行・各種ダイアログ）が開いているか。
 * 案内は自動で出るので、開いている間は判定を延期して、重ねて出さない。
 */
export function hasOpenModal(root: ParentNode): boolean {
  return root.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') !== null;
}

/** localStorage に記録があるか（使えない環境では無いものとして扱う） */
export function readStorageFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** 案内を閉じた記録を残す */
export function markZoomHintDismissed(): void {
  try {
    localStorage.setItem(ZOOM_HINT_DISMISSED_KEY, "1");
  } catch {
    // 記録できなくても、今回のセッションでは閉じたままにする
  }
}
