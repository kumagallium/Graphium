// アプリが起動中であることを MCP に知らせるハートビート（`<root>/appdata/app-heartbeat.json`）
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §2.1
// ・デスクトップ: WebView のタイマーは隠れると止まるので、書くのは Rust 側。ここは root を知らせるだけ
// ・ブラウザ / server-fs: 30 秒ごとに writeAppData（ベストエフォート。隠れると止まる）。
//   pagehide で at: 0 を書いて「終了」を知らせる（届かないこともある）

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getGraphiumRoot } from "../../lib/graphium-root";
import { isTauri } from "../../lib/platform";
import { getAppVersion } from "../../lib/updater";

/** web 版の書き込み間隔（ms）。MCP 側の鮮度判定（90 秒）より十分短くする */
export const WEB_HEARTBEAT_INTERVAL_MS = 30_000;

/** ハートビートの書き込みに必要な最小のストレージ */
export type HeartbeatStorage = {
  writeAppData?(key: string, data: unknown): Promise<void>;
};

export function useAppHeartbeat(provider: HeartbeatStorage | null | undefined, enabled: boolean): void {
  // StrictMode で effect が 2 回走っても startedAt と「知らせ済みの root」は保つ
  const startedAtRef = useRef<string>("");
  if (!startedAtRef.current) startedAtRef.current = new Date().toISOString();
  const notifiedRootRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !provider) return;
    let cancelled = false;

    if (isTauri()) {
      void (async () => {
        try {
          const { current: root } = await getGraphiumRoot();
          // root が変わっていなければ呼び直さない（StrictMode の二重実行も吸収）
          if (cancelled || notifiedRootRef.current === root) return;
          await invoke("start_app_heartbeat", { root });
          notifiedRootRef.current = root;
        } catch (err) {
          // 起動検知が効かないだけでアプリの動作には影響しない
          console.warn("[app-heartbeat] start failed", err);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (typeof provider.writeAppData !== "function") return;
    const write = provider.writeAppData.bind(provider);
    let version = "";
    void getAppVersion().then((v) => { version = v; }, () => {});

    const beat = (at: string | 0) => {
      write("app-heartbeat", {
        via: "web",
        at,
        startedAt: startedAtRef.current,
        version,
      }).catch(() => {
        // ベストエフォート。書けなくてもアプリの動作には影響しない
      });
    };
    beat(new Date().toISOString());
    const timer = setInterval(() => beat(new Date().toISOString()), WEB_HEARTBEAT_INTERVAL_MS);
    const onPageHide = () => beat(0);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [provider, enabled]);
}
