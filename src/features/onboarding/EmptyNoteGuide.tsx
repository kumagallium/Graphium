// 空ノート用の 4 トリガー予示
// UX Audit #04 に基づく「段階的開示」のうち、もっとも軽量な inline 版。
// BlockNote 編集面の下にさりげなく並ぶ chip 列として表示する。
//
// 表示条件は呼び出し側が `visible` prop で決める（本コンポーネントは純粋な見た目）:
// - 新規作成直後の空ノート
// - 既存ノートを開いた直後でも、本文が空で一度も編集されていないとき
// Wiki / Skill / AI 派生ドキュメントなど「システム生成で空のはずがない」場合は
// 呼び出し側で `visible={false}` を渡す。

import type { ReactNode } from "react";
import { FolderInput } from "lucide-react";
import { useT } from "@/i18n";

type EmptyNoteGuideProps = {
  visible: boolean;
  /** ⌘K チップを押したときのハンドラ（Composer を開く） */
  onOpenComposer?: () => void;
  /** AI が使えるか（バックエンド到達 + モデル登録済み）。false なら ⌘K チップを予示しない */
  aiEnabled?: boolean;
  /** 投入口（既存資料の一括持ち込み）チップを押したときのハンドラ。未指定なら intake チップ自体を出さない */
  onOpenIntake?: () => void;
};

type Chip = {
  key: string;
  /** 表示キー。Cmd/Ctrl の分岐は呼び出し側で UA 検出しない（後続 PR で対応） */
  display: ReactNode;
  labelI18nKey: string;
  descI18nKey: string;
  /** クリック時に action がある場合だけ pointer カーソル + onClick を有効化 */
  action?: "composer" | "intake";
};

const chips: Chip[] = [
  {
    key: "intake",
    display: <FolderInput size={14} />,
    labelI18nKey: "onboarding.chip.intake.label",
    descI18nKey: "onboarding.chip.intake.desc",
    action: "intake",
  },
  {
    key: "cmdk",
    display: "⌘K",
    labelI18nKey: "onboarding.chip.cmdk.label",
    descI18nKey: "onboarding.chip.cmdk.desc",
    action: "composer",
  },
  // `#` のラベル入力は廃止した（工程は step ブロック、テーブル / メディアの
  // ラベルはドラッグハンドルのメニューに集約）。予示するものが無いのでチップも出さない。
  {
    key: "at",
    display: "@",
    labelI18nKey: "onboarding.chip.at.label",
    descI18nKey: "onboarding.chip.at.desc",
  },
  {
    key: "slash",
    display: "/",
    labelI18nKey: "onboarding.chip.slash.label",
    descI18nKey: "onboarding.chip.slash.desc",
  },
];

export function EmptyNoteGuide({ visible, onOpenComposer, aiEnabled = true, onOpenIntake }: EmptyNoteGuideProps) {
  const t = useT();

  if (!visible) return null;

  // AI が使えない（モデル未登録等）なら ⌘K チップは予示しない（押しても Composer を開けないため）。
  // onOpenIntake が無ければ intake チップも出さない（押せない chip を出さない）。
  const visibleChips = chips.filter((c) => (aiEnabled || c.key !== "cmdk") && (onOpenIntake || c.key !== "intake"));

  const handleClick = (action?: Chip["action"]) => {
    if (action === "composer") onOpenComposer?.();
    if (action === "intake") onOpenIntake?.();
  };

  return (
    <div
      role="note"
      aria-label={t("onboarding.guide.aria")}
      style={{
        marginTop: 32,
        padding: "14px 16px",
        borderRadius: "var(--r-3)",
        border: "1px dashed var(--rule)",
        background: "var(--paper-2)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: 680,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {t("onboarding.guide.lead")}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {visibleChips.map((chip) => {
          const clickable = chip.action != null;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={clickable ? () => handleClick(chip.action) : undefined}
              disabled={!clickable}
              title={t(chip.descI18nKey)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                background: "var(--paper)",
                border: "1px solid var(--rule)",
                borderRadius: "var(--r-2)",
                cursor: clickable ? "pointer" : "default",
                font: "inherit",
                color: "var(--ink-2)",
                fontSize: 12,
              }}
            >
              <kbd
                style={{
                  fontFamily: "ui-monospace, 'SF Mono', monospace",
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 22,
                  textAlign: "center",
                  padding: "1px 5px",
                  borderRadius: "var(--r-1)",
                  background: "var(--paper-3)",
                  color: "var(--ink)",
                  lineHeight: 1.4,
                }}
              >
                {chip.display}
              </kbd>
              <span style={{ whiteSpace: "nowrap" }}>{t(chip.labelI18nKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
