// アプリの再起動（デスクトップ版のみ）

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

/**
 * アプリを起動し直す。
 *
 * macOS では Tauri の `relaunch()` を直接は使わない。`relaunch()` は今のプロセスから
 * 新しいバイナリを spawn するので、アップデータが `.app` を置き換えた直後だけ、
 * TCC の責任プロセス（responsible process）が置き換え前のバンドルに紐付いたまま
 * 起動してしまう。解決できない identity として扱われ、書類フォルダが
 * `Operation not permitted` で弾かれる ── 「更新した直後だけノートが開けない、
 * 一度閉じて開き直すと直る」の正体がこれ。
 *
 * Rust 側の `relaunch_via_launchd` は `open` に起動を任せるので、launchd が
 * 責任プロセスになり、置き換え後のバンドルの署名で評価し直される。
 * macOS 以外やバンドル外実行では Err が返るので、そこは従来どおり `relaunch()`。
 */
export async function relaunchApp(): Promise<void> {
  if (!isTauri()) {
    window.location.reload();
    return;
  }
  try {
    await invoke("relaunch_via_launchd");
    return;
  } catch (e) {
    console.warn("[relaunch] launchd 経由に失敗、relaunch() に切り替えます:", e);
  }
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
