// 取り込みの区画の切り替え（ファイル / AI との会話）。
//
// 見た目は OfficePreview のシートのタブと同じ下線のタブ。
// 左右の矢印・Home・End で移動する（選ばれたタブだけ tabIndex=0 の roving tabindex）。

import { useRef, type KeyboardEvent } from "react";
import { useT } from "@/i18n";

export type IntakeSection = "files" | "conversations";

const SECTIONS: readonly IntakeSection[] = ["files", "conversations"];

type IntakeSectionTabsProps = {
  value: IntakeSection;
  onChange: (value: IntakeSection) => void;
  /** タブの id の接頭辞（同じ画面に複数置くときに分ける） */
  idBase?: string;
};

export function IntakeSectionTabs({ value, onChange, idBase = "intake-section" }: IntakeSectionTabsProps) {
  const t = useT();
  const refs = useRef<Record<IntakeSection, HTMLButtonElement | null>>({ files: null, conversations: null });

  const move = (next: IntakeSection) => {
    onChange(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, current: IntakeSection) => {
    const i = SECTIONS.indexOf(current);
    if (e.key === "ArrowRight") move(SECTIONS[(i + 1) % SECTIONS.length]);
    else if (e.key === "ArrowLeft") move(SECTIONS[(i - 1 + SECTIONS.length) % SECTIONS.length]);
    else if (e.key === "Home") move(SECTIONS[0]);
    else if (e.key === "End") move(SECTIONS[SECTIONS.length - 1]);
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex gap-1 border-b border-border text-sm" role="tablist" aria-label={t("intake.section.label")}>
      {SECTIONS.map((s) => {
        const active = s === value;
        return (
          <button
            key={s}
            ref={(el) => {
              refs.current[s] = el;
            }}
            id={`${idBase}-${s}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`-mb-px border-b-2 px-3 py-1.5 whitespace-nowrap transition-colors ${
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onChange(s)}
            onKeyDown={(e) => onKeyDown(e, s)}
          >
            {t(`intake.section.${s}`)}
          </button>
        );
      })}
    </div>
  );
}
