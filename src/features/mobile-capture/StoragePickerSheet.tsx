// ストレージ選択ボトムシート（スマホの「ストレージに接続」の行き先）。
//
// 接続 CTA は「どこへ送るか」を選ぶ画面に一本化する: Google Drive（利用可）/
// OneDrive（準備中・P1.5 で活性化する枠）。ピッカーに並ぶのは**接続するストレージ**
// だけ — 送り方のバリエーション（かつての共有シート行）は概念が混ざるので置かない。
// OAuth を使いたくない場合は OS の共有シートから同期フォルダへ手動保存すればよく、
// それは Graphium のコード無しで成立する（docs/ARCHITECTURE.md §4.2）。
// 開く入口は 3 つ — 従来ホームのオプトインカード [試す]・キュー前提ホームの
// 未接続時主ボタン・最小設定シートの [接続/変更]。
//
// **props 駆動のプレゼンテーション層**: 接続の実体（pusher / usePushQueue /
// usePushSettings）は親が握り、ここは選択肢と進行状態を出すだけ（Storybook で
// 全状態を再現できる）。
//
// ジェスチャ契約: onSelectGoogle は **click から同期的に呼ぶ**
// （GIS の requestAccessToken の user activation 契約。
// ハンドラ内で await を挟んではいけない — 親側の実装規約も同じ）。
// Google 行は準備完了（googleReady）まで無効化する — connect() は prepare 済みで
// ないと PushConfigError になるため、押せる時点で必ず同期接続できる状態にしておく。
//
// z-index は最小設定シート（z-50）の上に重ねる z-[60] — 設定シートの [変更] から
// 開いたとき、ピッカーが手前に出て、閉じるとシートに戻る。

import { useEffect } from "react";
import { Cloud, Loader2, ChevronRight, AlertCircle } from "lucide-react";
import { useT } from "../../i18n";

export type StoragePickerSheetProps = {
  /** Google 行を押せるか（push モジュールのロード + prepare 完了まで false）。 */
  googleReady: boolean;
  /** connect() のポップアップ進行中（Google 行をスピナーにして再タップを防ぐ）。 */
  connecting: boolean;
  /** 直近の接続エラー（ポップアップを閉じた・権限拒否など）。 */
  connectError?: string | null;
  /** Google Drive を選択。**click から同期的に呼ばれる**。 */
  onSelectGoogle: () => void;
  onClose: () => void;
};

export function StoragePickerSheet({
  googleReady,
  connecting,
  connectError,
  onSelectGoogle,
  onClose,
}: StoragePickerSheetProps) {
  const t = useT();

  // ESC で閉じる（モバイル主対象だが、狭いデスクトップウィンドウでも使われる）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end bg-black/40"
      data-testid="storage-picker-sheet"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border-t border-border rounded-t-2xl shadow-2xl w-full max-h-[85dvh] flex flex-col overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {t("mobile.storagePicker.title")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("mobile.storagePicker.help")}
          </p>

          {/* プロバイダ一覧 */}
          <div className="flex flex-col gap-2">
            {/* Google Drive（利用可） */}
            <button
              onClick={onSelectGoogle}
              disabled={!googleReady || connecting}
              className="flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-card text-left active:bg-muted transition-colors disabled:opacity-50"
            >
              <Cloud size={20} className="text-primary shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">Google Drive</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t("mobile.storagePicker.googleHelp")}
                </span>
              </span>
              {connecting ? (
                <Loader2 size={16} className="animate-spin text-primary shrink-0" />
              ) : (
                <ChevronRight size={16} className="text-muted-foreground shrink-0" />
              )}
            </button>

            {/* OneDrive（準備中・P1.5 で活性化する枠） */}
            <button
              disabled
              className="flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-card text-left opacity-60"
            >
              <Cloud size={20} className="text-muted-foreground shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">OneDrive</span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                {t("mobile.storagePicker.comingSoon")}
              </span>
            </button>
          </div>

          {/* 接続エラー（ポップアップを閉じた・権限拒否など） */}
          {connectError && (
            <p className="text-xs text-destructive leading-relaxed flex items-start gap-1">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span className="break-all">
                {t("mobile.send.connectFailed", { error: connectError })}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
