// 共有フォルダの到達性（NAS のマウント外れ・別名マウント・再接続）。
//
// 共有は NAS や同期フォルダをそのまま使うので、Graphium 側に「接続」の概念は無い。
// その代わり、OS がマウントを外したときに利用者が自分で直せるよう、
//   - 繋がっている間に接続先（smb://… / \\host\share）を控える
//   - 外れたら OS に再接続を頼み、別名マウントの候補を示す
// を Tauri コマンド越しに行う。Rust 側の実装は src-tauri/src/lib.rs の
// shared_root_remote / shared_root_diagnose / shared_root_reconnect。

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../platform";
import { getSharedRootRemote, setSharedRootRemote } from "./config";

export type SharedRootDiagnosis = {
  /** 共有ルートがフォルダとして見えているか */
  reachable: boolean;
  /** 到達できないときの、同じ中身がありそうな別パス（存在確認済み） */
  alternatives: string[];
  /** 控えてある接続先。無ければ再接続ボタンは出せない */
  remote: string | null;
};

/**
 * 共有ルートの到達性を調べる。到達できないときは別名マウントの候補も返す。
 * Tauri 以外（ブラウザ版）やコマンドが失敗したときは判別できないので、
 * 「到達できない」とは言わず reachable: true を返す（元のエラーをそのまま見せる）。
 */
export async function diagnoseSharedRoot(root: string): Promise<SharedRootDiagnosis> {
  const remote = getSharedRootRemote();
  const unknown: SharedRootDiagnosis = { reachable: true, alternatives: [], remote };
  if (!isTauri()) return unknown;
  try {
    const d = await invoke<{ reachable: boolean; alternatives: string[] }>(
      "shared_root_diagnose",
      { root, remote },
    );
    return { ...d, remote };
  } catch {
    return unknown;
  }
}

/**
 * 繋がっている今のうちに、共有ルートの接続先を控える。
 * ローカルディスク上のフォルダなど判別できないときは何もしない（控えは消さない）。
 * 読み込み成功のたびに呼んでよい（1 回 `mount` を叩くだけ）。
 */
export async function rememberSharedRootRemote(root: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const remote = await invoke<string | null>("shared_root_remote", { root });
    if (remote) setSharedRootRemote(remote);
  } catch {
    /* 控えられなくても共有の読み書きには影響しない */
  }
}

/** 控えてある接続先を OS に渡して再接続を頼む（Finder / エクスプローラーが開く）。 */
export async function reconnectSharedRoot(remote: string): Promise<void> {
  await invoke<void>("shared_root_reconnect", { remote });
}

/**
 * 共有ルートが見えるようになるまで待つ（再接続後の自動再読み込み用）。
 * 見えたら true、timeoutMs を過ぎたら false。
 */
export async function waitForSharedRoot(
  root: string,
  timeoutMs = 20_000,
  intervalMs = 1_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await invoke<boolean>("shared_root_exists", { root })) return true;
    } catch {
      /* 一時的な失敗は次の周回で見る */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
