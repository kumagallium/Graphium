import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { migrateFromProvnote } from "./lib/migration";
import { NoteApp } from "./note-app";
import { LocaleProvider } from "./i18n";
import { restartSidecar, startSidecar, stopSidecar } from "./lib/sidecar";
import { initMenuListener, onMenuAction } from "./lib/menu-events";
import { initUpdater } from "./lib/updater";
import { isTauri } from "./lib/platform";
import "./app.css";

// ── Tauri 環境: sidecar サーバー起動 + メニュー + 自動更新 ──
if (isTauri()) {
  // sidecar 起動を await し、失敗時もアプリは続行（AI 機能のみ無効化）
  startSidecar().then((ok) => {
    if (!ok) console.warn("[main] sidecar 起動失敗 — AI 機能は利用不可");
  });
  initMenuListener();
  // メニュー > Backend > Restart Backend のハンドラ
  onMenuAction("restart-backend", () => {
    restartSidecar().then((ok) => {
      console.log(`[main] sidecar restart ${ok ? "succeeded" : "failed"}`);
    });
  });
  initUpdater();
  // Rust 側の CloseRequested → prevent_close → 'app-close-requested' emit を受けて
  // sidecar を停止し、shutdown_ack で Rust に終了許可を返す。
  // sidecar の kill が返らない場合でも 2 秒で諦めて ACK を送る。
  (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const { invoke } = await import("@tauri-apps/api/core");
    await listen("app-close-requested", async () => {
      try {
        await Promise.race([
          stopSidecar(),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch (e) {
        console.error("[main] stopSidecar failed during shutdown", e);
      }
      try {
        await invoke("shutdown_ack");
      } catch (e) {
        console.error("[main] shutdown_ack invoke failed", e);
      }
    });
  })();
}

// ── マイグレーション（provnote → graphium） ──
migrateFromProvnote();

// ── エントリーポイント ──
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <NoteApp />
    </LocaleProvider>
  </StrictMode>
);
