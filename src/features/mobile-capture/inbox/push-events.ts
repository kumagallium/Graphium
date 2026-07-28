// モバイル送信（push）の設定・認可状態が変わったことを知らせる window イベント。
//
// 設定モーダルとモバイルホームの送信キューは別コンポーネントツリーで、どちらも
// localStorage（client_id 上書き・保存トークン）を直接読むだけの疎結合。片方での
// 変更（client_id 保存・接続・切断・失効破棄）をもう片方が知る術がないため、
// experimental.ts のフラグと同じ window イベント間接化で「変わった」事実だけを流し、
// 受け手（use-push-queue）が localStorage を読み直す。
//
// **このモジュールは push/ の外に置く**: use-push-queue（起動時バンドル）が
// 値 import してよいのは push/ の外だけ、という動的 import 境界のため。
// push/ 側（config.ts / google-auth.ts）がここを import するのは問題ない
// （文字列定数と dispatch だけで、gsi も IndexedDB も引かない）。

/** client_id 上書き・保存トークンが変わったときに window へ飛ぶイベント名。 */
export const PUSH_STATUS_EVENT = "graphium-mobile-push-status-changed";

/** 状態変更を通知する（window 不在の環境では黙って何もしない）。 */
export function emitPushStatusChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(PUSH_STATUS_EVENT));
  } catch {
    // window 不在（node テスト等）は無視
  }
}
