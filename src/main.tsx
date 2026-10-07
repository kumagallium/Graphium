import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { migrateFromProvnote } from "./lib/migration";
import { applyFontMode, getSelectedLatinFont, getSelectedJpFont, applyColorMode, getSelectedColorMode } from "./features/settings";
import { NoteApp } from "./note-app";
import { LocaleProvider } from "./i18n";
import { restartSidecar, startSidecar, stopSidecar } from "./lib/sidecar";
import { initMenuListener, onMenuAction } from "./lib/menu-events";
import { initUiZoomInput } from "./lib/ui-zoom";
import { UiZoomOverlays } from "./features/ui-zoom";
import { initUpdater } from "./lib/updater";
import { isTauri } from "./lib/platform";
import { installExternalLinkHandler } from "./lib/external-link";
import { createCloseRequestHandler, installPageExitFlush } from "./lib/flush-on-exit";
import { installBackspaceNavigationGuard } from "./lib/backspace-navigation-guard";
import "./app.css";
import { installTooltips } from "./ui/tooltip";

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
  // 拡大縮小のキー（Ctrl/⌘ + ± / 0）と Ctrl + ホイール。倍率の実体は Rust が持つ（lib/ui-zoom.ts）
  initUiZoomInput();
  // メニュー > Backend > Restart Backend のハンドラ
  onMenuAction("restart-backend", () => {
    restartSidecar().then((ok) => {
      console.log(`[main] sidecar restart ${ok ? "succeeded" : "failed"}`);
    });
  });
  // 自動更新チェック。設定 > About の「更新を自動で確認する」が OFF なら何も予約しない
  // （設定を切り替えた時点で updater 側が予約を張り直すので再起動は不要）。
  initUpdater();
  // Rust 側の CloseRequested → prevent_close → 'app-close-requested' emit を受けて
  // エディタの未保存の編集を書き出し、sidecar を停止し、shutdown_ack で Rust に終了許可を返す。
  // 書き出しは sidecar を止める前（保存先が sidecar 経由だと書けなくなる）。どちらも上限つきで、
  // 返らなくても ACK を送る（lib/flush-on-exit.ts）。
  (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const { invoke } = await import("@tauri-apps/api/core");
    const onCloseRequested = createCloseRequestHandler({
      stopSidecar,
      ack: () => invoke("shutdown_ack"),
    });
    await listen("app-close-requested", () => void onCloseRequested());
  })();
}

// ── タブを閉じる・リロードする・隠れるとき: 未保存の編集の書き出しを始める ──
// デスクトップのリロードもここを通る。確認ダイアログは Web 版だけ（デスクトップの終了は
// 上の経路で書き終わりを待てる）
installPageExitFlush({ confirmWhenUnsaved: !isTauri() });

// ── 文字を書けない場所の Backspace で前の画面へ戻らないようにする（WebKit の既定動作） ──
installBackspaceNavigationGuard();

// ── 共通ツールチップ（data-tooltip 属性の要素に出す） ──
installTooltips();

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
      {/* 拡大縮小の短い表示と、画面が狭い環境の案内。どの画面でも出るようルートに置く */}
      <UiZoomOverlays />
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
