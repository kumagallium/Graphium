// AI のつなぎ方の簡易表示。まだ何もつないでいないときの最初の 1 枚（AiConnectFlow の simpleFirst）。
//
// 今の「どこにつなぎますか？」（ConnectChooserView）は、つなぎ方の行 3〜5 と、API キーの 7 社 × 3 項目の
// 比較から始まる。AI を少し使っている人は、たいてい何かをすでに持っている（ChatGPT の有料プラン・
// GitHub Copilot・研究室の接続先）。そこで最初は「いま使っている AI」を 1 問だけ聞き、答えごとに
// 押すボタンを 1 つに絞る。
//
// 守ること:
// - 機能は消さない。どの答えからも「すべてのつなぎ方を見る」で今の画面全体へ行ける
// - 「どれも無い」に特定の接続先をおすすめしない（おすすめを外した判断と揃える）。今の比較へ渡す
// - Web 版では ChatGPT のプランと GitHub Copilot はつなげないので、デスクトップ版への案内にする
//
// 見た目だけの部品。選んだ答えの状態だけをここで持つ。

import { Check } from "lucide-react";
import { useState } from "react";
import { useLocale } from "../../../i18n";
import { SETTINGS_CARD_CLASS } from "../SettingsGroup";

export type SimpleAiAnswer = "chatgpt" | "copilot" | "lab" | "none";

const ANSWERS: SimpleAiAnswer[] = ["chatgpt", "copilot", "lab", "none"];

export type SimpleAiEntryViewProps = {
  /** ChatGPT のプランでつなぐ（デスクトップのみ。無ければデスクトップ版への案内を出す） */
  onConnectChatGpt?: () => void;
  /** GitHub Copilot のワンクリック接続（デスクトップのみ。無ければデスクトップ版への案内を出す） */
  onConnectCopilot?: () => void;
  /** URL を自分で入れる今のフォーム（研究室・機関の接続先） */
  onPickCustom: () => void;
  /** 配られた接続のファイルを読み込む。あれば研究室・機関の答えで先に出す */
  onImportFile?: () => void;
  /** 今の「どこにつなぎますか？」の画面全体へ */
  onShowAll: () => void;
  /** デスクトップ版の入手先を開く（Web 版で ChatGPT・Copilot を選んだとき） */
  onOpenDesktopDownload: () => void;
  /** GitHub の Copilot 設定（学習への利用を止める）を開く */
  onOpenCopilotSettings?: () => void;
  /** 最初に選んでおく答え（Storybook 用） */
  initialAnswer?: SimpleAiAnswer | null;
};

const primaryButton =
  "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors";
const linkButton = "text-xs text-primary underline-offset-2 hover:underline";

export function SimpleAiEntryView({
  onConnectChatGpt,
  onConnectCopilot,
  onPickCustom,
  onImportFile,
  onShowAll,
  onOpenDesktopDownload,
  onOpenCopilotSettings,
  initialAnswer = null,
}: SimpleAiEntryViewProps) {
  const { t } = useLocale();
  const [answer, setAnswer] = useState<SimpleAiAnswer | null>(initialAnswer);

  // 選んだ答えの次に出す 1 行の説明とボタン 1 つ
  type Next = { body: string; label: string; onClick: () => void; secondary?: { label: string; onClick: () => void } };
  const next = ((): Next | null => {
    switch (answer) {
      case "chatgpt":
        return onConnectChatGpt
          ? { body: t("settings.simpleAiEntry.chatgpt.body"), label: t("settings.chatgptPlan.button"), onClick: onConnectChatGpt }
          : { body: t("settings.simpleAiEntry.chatgpt.webOnly"), label: t("settings.simpleAiEntry.download"), onClick: onOpenDesktopDownload };
      case "copilot":
        return onConnectCopilot
          ? { body: t("settings.simpleAiEntry.copilot.body"), label: t("settings.freeProviders.connect"), onClick: onConnectCopilot }
          : { body: t("settings.simpleAiEntry.copilot.webOnly"), label: t("settings.simpleAiEntry.download"), onClick: onOpenDesktopDownload };
      case "lab":
        // ファイルを受け取っていれば、URL もキーも打たずに済む。URL だけ渡された人のために入力も残す
        return onImportFile
          ? {
              body: t("settings.simpleAiEntry.lab.bodyWithFile"),
              label: t("settings.aiConnect.fromFile.title"),
              onClick: onImportFile,
              secondary: { label: t("settings.simpleAiEntry.lab.button"), onClick: onPickCustom },
            }
          : { body: t("settings.simpleAiEntry.lab.body"), label: t("settings.simpleAiEntry.lab.button"), onClick: onPickCustom };
      case "none":
        return { body: t("settings.simpleAiEntry.none.body"), label: t("settings.simpleAiEntry.none.button"), onClick: onShowAll };
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-3 text-left">
      <div>
        <h4 className="text-xs font-semibold text-foreground">{t("settings.simpleAiEntry.question")}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.simpleAiEntry.hint")}</p>
      </div>

      <div role="radiogroup" aria-label={t("settings.simpleAiEntry.question")} className="grid gap-2 sm:grid-cols-2">
        {ANSWERS.map((a) => {
          const selected = answer === a;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setAnswer(a)}
              className={`${SETTINGS_CARD_CLASS} flex items-center gap-2 border p-3 text-left text-xs transition-colors ${
                selected ? "border-primary bg-primary/5 text-foreground" : "border-transparent text-foreground hover:bg-accent/40"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {selected && <Check size={10} />}
              </span>
              <span className="min-w-0">{t(`settings.simpleAiEntry.answer.${a}`)}</span>
            </button>
          );
        })}
      </div>

      {next && (
        <div className={`${SETTINGS_CARD_CLASS} flex items-start justify-between gap-3 p-3`} aria-live="polite">
          <div className="min-w-0">
            <p className="text-xs text-foreground">{next.body}</p>
            {/* Copilot はボタンを押すとすぐ接続が始まるので、送り先と学習への利用は押す前に伝える（今の行と同じ） */}
            {answer === "copilot" && onConnectCopilot && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.copilotOneClick.dataNotice")}{" "}
                {onOpenCopilotSettings && (
                  <button type="button" onClick={onOpenCopilotSettings} className={linkButton}>
                    {t("settings.copilotOneClick.dataNoticeLink")}
                  </button>
                )}
              </p>
            )}
            {next.secondary && (
              <button type="button" onClick={next.secondary.onClick} className={`mt-1 ${linkButton}`}>
                {next.secondary.label}
              </button>
            )}
          </div>
          <button type="button" onClick={next.onClick} className={`shrink-0 ${primaryButton}`}>
            {next.label}
          </button>
        </div>
      )}

      {/* どの答えからでも今の画面全体へ行ける（機能は消さない） */}
      <button type="button" onClick={onShowAll} className={linkButton}>
        {t("settings.simpleAiEntry.showAll")} →
      </button>
    </div>
  );
}
