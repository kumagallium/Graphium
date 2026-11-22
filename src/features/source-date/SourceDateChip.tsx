// ノートの題の下に出す「資料の日付」のチップ。
//
// 資料の日付（doc.sourceDate）は「その資料がいつのものか」。作成日時（Graphium で作った日時）とは
// 別に持つ。フォルダのチップの隣に置き、付いていなければ点線の「＋ 資料の日付」、付いていれば
// 「資料の日付 2012-03」を出す。押すと小さな入力欄が開き、年だけ・年月だけでも書ける。
//
// 値の読み取りは lib/source-date.ts（parseSourceDate）。このチップは保存形だけを onChange に渡す。

import { useLayoutEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Dropdown } from "@/ui/dropdown";
import type { Rect } from "@/ui/floating-position";
import { useImeEnterGuard } from "@/hooks/use-ime-enter-guard";
import { parseSourceDate, sourceDatePrecision } from "@/lib/source-date";
import { useT } from "../../i18n";

type Props = {
  /** 今の資料の日付（保存形）。無ければ undefined */
  value?: string;
  /** 付けた・直した（保存形）か、外した（undefined） */
  onChange: (next: string | undefined) => void;
  /** Storybook 用: 最初から入力欄を開いておく */
  defaultOpen?: boolean;
};

export function SourceDateChip({ value, onChange, defaultOpen = false }: Props) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState(value ?? "");
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const openEditor = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
    setDraft(value ?? "");
    setOpen(true);
  };
  const close = () => setOpen(false);

  // 最初から開いているとき（Storybook）は、描いたあとにボタンの位置を測って入力欄を真下に置く
  useLayoutEffect(() => {
    if (!open || anchor) return;
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
  }, [open, anchor]);

  const trimmed = draft.trim();
  const parsed = trimmed ? parseSourceDate(trimmed) : null;
  const invalid = trimmed.length > 0 && parsed === null;

  const commit = () => {
    if (!trimmed) {
      // 空にして確定 = 外す
      if (value) onChange(undefined);
      close();
      return;
    }
    if (!parsed) return;
    if (parsed !== value) onChange(parsed);
    close();
  };

  const precisionLabel = (v: string) => t(`sourceDate.precision.${sourceDatePrecision(v)}`);

  const rect = anchor;
  const position = rect ? { top: rect.bottom + 4, left: rect.left } : null;

  return (
    <>
      {value ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => (open ? close() : openEditor())}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          data-tooltip={t("sourceDate.tooltip")}
          aria-label={t("sourceDate.editAria", { value })}
        >
          <CalendarDays size={12} aria-hidden="true" />
          <span>{t("sourceDate.label")}</span>
          <span className="font-medium text-foreground tabular-nums">{value}</span>
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => (open ? close() : openEditor())}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          data-tooltip={t("sourceDate.tooltip")}
        >
          ＋ {t("sourceDate.label")}
        </button>
      )}
      {open && position && rect && (
        <Dropdown
          position={position}
          anchorRect={rect}
          onClose={close}
          minWidth={260}
        >
          <div className="p-3 flex flex-col gap-2" data-testid="source-date-editor">
            <div className="text-xs font-medium text-foreground">{t("sourceDate.label")}</div>
            <p className="text-xs text-muted-foreground leading-relaxed">{t("sourceDate.help")}</p>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              {...compositionHandlers}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isImeKey(e)) {
                  e.preventDefault();
                  commit();
                }
              }}
              placeholder={t("sourceDate.placeholder")}
              aria-label={t("sourceDate.label")}
              aria-invalid={invalid || undefined}
              className="w-full text-sm px-2 py-1 rounded border border-border bg-background text-foreground outline-none focus:border-primary/60 tabular-nums"
            />
            <div className="min-h-[1.25rem] text-xs" aria-live="polite">
              {invalid ? (
                <span className="text-destructive">{t("sourceDate.invalid")}</span>
              ) : parsed ? (
                <span className="text-muted-foreground">
                  {t("sourceDate.willSave", { value: parsed, precision: precisionLabel(parsed) })}
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2">
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(undefined);
                    close();
                  }}
                  className="text-xs px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  {t("sourceDate.remove")}
                </button>
              )}
              <button
                type="button"
                onClick={commit}
                disabled={invalid}
                className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {t("sourceDate.save")}
              </button>
            </div>
          </div>
        </Dropdown>
      )}
    </>
  );
}
