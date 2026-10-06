// Graphium のローカルルートディレクトリ設定（デスクトップ版のみ）
// 実体は Tauri 側が `<OS app config dir>/com.graphium.app/config.json` に保持する。
// OAuth 連携や Web 版の Storage Provider 切替とは独立で、
// `LocalFilesystemProvider` 配下（notes / media / wiki / skills / appdata）の
// 物理配置だけをまとめて差し替えるためのレイヤー。

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./platform";

export type GraphiumRootInfo = {
  /** 現在実際に使われているルートの絶対パス */
  current: string;
  /** 未設定時の既定パス（`~/Documents/Graphium/`） */
  defaultRoot: string;
  /** ユーザーがカスタムルートを設定しているか */
  isCustom: boolean;
};

/** 現在の Graphium ルートと既定値を取得する（Tauri 専用） */
export async function getGraphiumRoot(): Promise<GraphiumRootInfo> {
  if (!isTauri()) {
    throw new Error("getGraphiumRoot is desktop-only");
  }
  return await invoke<GraphiumRootInfo>("get_graphium_root");
}

/** Graphium ルートを設定する。`null` を渡すと既定に戻る */
export async function setGraphiumRoot(path: string | null): Promise<GraphiumRootInfo> {
  if (!isTauri()) {
    throw new Error("setGraphiumRoot is desktop-only");
  }
  const info = await invoke<GraphiumRootInfo>("set_graphium_root", { path });
  // 起動検知のハートビートも新しい保存先へ向け直す（ベストエフォート。失敗しても設定は成功）
  try {
    await invoke("start_app_heartbeat", { root: info.current });
  } catch (err) {
    console.warn("[graphium-root] heartbeat restart failed", err);
  }
  return info;
}

/**
 * フォルダ選択ダイアログを開き、ユーザーが選択したパスを返す。
 * キャンセルされた場合は `null`。
 */
export async function pickGraphiumRoot(
  defaultPath?: string,
): Promise<string | null> {
  if (!isTauri()) {
    throw new Error("pickGraphiumRoot is desktop-only");
  }
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Select Graphium local save location",
  });
  if (!selected) return null;
  // v2 の plugin-dialog は string を直接返す（multiple=false 時）
  return typeof selected === "string" ? selected : null;
}
