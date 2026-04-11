// Tauri メニューバーからのイベントをフロントエンドで処理する
// Rust 側の menu-action イベントを listen し、対応する UI 操作を実行

import { isTauri } from "./platform";

type MenuAction = "new-note" | "export-pdf" | "export-prov" | "toggle-graph" | "toggle-chat" | "about" | "release-notes";

// コールバック登録用レジストリ
const handlers = new Map<MenuAction, () => void>();

/** メニューアクションのハンドラを登録 */
export function onMenuAction(action: MenuAction, handler: () => void): () => void {
  handlers.set(action, handler);
  return () => handlers.delete(action);
}

/** Tauri メニューイベントのリスナーを開始 */
export async function initMenuListener(): Promise<void> {
  if (!isTauri()) return;

  const { listen } = await import("@tauri-apps/api/event");
  await listen<string>("menu-action", (event) => {
    const action = event.payload as MenuAction;
    const handler = handlers.get(action);
    if (handler) {
      handler();
    } else {
      console.log(`[menu] Unhandled action: ${action}`);
    }
  });
}
