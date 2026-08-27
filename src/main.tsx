import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { migrateFromProvnote } from "./lib/migration";
import { applyFontMode, getSelectedLatinFont, getSelectedJpFont, applyColorMode, getSelectedColorMode } from "./features/settings";
import { NoteApp } from "./note-app";
import { LocaleProvider } from "./i18n";
import { restartSidecar, startSidecar, stopSidecar } from "./lib/sidecar";
import { initMenuListener, onMenuAction } from "./lib/menu-events";
import { initUpdater } from "./lib/updater";
import { isTauri } from "./lib/platform";
import { installExternalLinkHandler } from "./lib/external-link";
import "./app.css";

// ── Tauri 環境: sidecar サーバー起動 + メニュー + 自動更新 ──
if (isTauri()) {
  // 外部リンク（<a target="_blank"> / 出典 URL）を OS ブラウザで開けるようにする。
  // Tauri WebView は target="_blank" を素通しすると何も起きないため横取りする。
  installExternalLinkHandler();
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

// ── フォント・色モード適用（読みやすさ設定） ──
applyFontMode(getSelectedLatinFont(), getSelectedJpFont());
applyColorMode(getSelectedColorMode());

// ── エントリーポイント ──
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <NoteApp />
    </LocaleProvider>
  </StrictMode>
);

// ── 起動スプラッシュを閉じる（デスクトップ版） ──
// main ウィンドウは tauri.conf で visible=false にしてあり、その間 public/
// splash.html が表示されている。
//
// **ここで requestAnimationFrame を待ってはいけない。** 非表示の WebView は
// 描画フレームを回さないので rAF のコールバックは発火せず、app_ready が永久に
// 呼ばれない。v0.45.1 では「ピクセルが出てから切り替える」つもりで rAF を
// 2 回挟み、その結果 Rust 側の 20 秒フォールバックが毎回スプラッシュを閉じて
// いた（= 全ユーザーが毎起動 20 秒待たされた）。
//
// render() は初回マウントを同期でコミットするので、この時点で DOM は組み上
// がっている。reveal_main は show() → close() の順なので、main が表示された
// フレームでそのまま中身が描かれる。
//
// sidecar の起動は待たない ── 待たせても AI を使わない利用者の起動が遅く
// なるだけで、起動中であることはサイドバーのナレッジ節が示す。
if (isTauri()) {
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("app_ready"))
    .catch((e) => console.error("[main] app_ready invoke failed", e));
}
