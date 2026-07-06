// IME（日本語入力など）の「変換確定 Enter」を通常の Enter と区別するためのユーティリティ。
//
// ブラウザによって確定 Enter のイベント順・シグナルが異なる:
// - Chrome/Blink:  keydown(keyCode=229, isComposing=true) → compositionend
// - WebKit(Safari / Tauri の WKWebView):
//     compositionend → keydown(keyCode=13, isComposing=false)
//     ※確定 Enter が「普通の Enter」に見えるため、isComposing / keyCode 229 の
//       チェックだけでは素通りする。compositionend からの経過時間で吸収する。
//
// `!isComposing && keyCode !== 229` の自前ガードはこの WebKit 順序を取りこぼし、
// デスクトップ（Tauri）で確定 Enter が submit / フォーカス移動として誤処理される。
// 必ず isImeKeyEvent()（または useImeEnterGuard フック）を使うこと。

export type ImeKeySignals = {
  /** onCompositionStart/End で ref 追跡している composition 状態（最も確実） */
  composingNow: boolean;
  /** KeyboardEvent.isComposing（モダンブラウザのネイティブ判定） */
  isComposing: boolean;
  /** keydown の keyCode（IME 処理中は 229 を返すブラウザ向け） */
  keyCode: number;
  /** 直近の compositionend からの経過ミリ秒 */
  msSinceCompositionEnd: number;
};

/** WebKit で compositionend 直後に飛ぶ確定 keydown を吸収する時間窓（ms）。
 *  人間が確定後に意図して次の Enter を押すまでの間隔よりは十分短くする。 */
export const IME_CONFIRM_KEY_WINDOW_MS = 50;

/**
 * この keydown が IME composition に属する（= 変換確定などの一部であり、
 * アプリのショートカット・submit として扱ってはいけない）かを判定する。
 */
export function isImeKeyEvent(s: ImeKeySignals): boolean {
  if (s.composingNow || s.isComposing || s.keyCode === 229) return true;
  if (s.msSinceCompositionEnd < IME_CONFIRM_KEY_WINDOW_MS) return true;
  return false;
}

export type EnterSubmitGuard = ImeKeySignals & {
  /** Enter キーか */
  isEnter: boolean;
  /** Shift+Enter（改行扱い） */
  shiftKey: boolean;
};

/**
 * Enter で submit していいかを判定する。IME 確定 Enter を弾くために
 * 複数のシグナルを冗長にチェックする（詳細はファイル先頭コメント）。
 */
export function shouldSubmitOnEnter(g: EnterSubmitGuard): boolean {
  if (!g.isEnter || g.shiftKey) return false;
  return !isImeKeyEvent(g);
}
