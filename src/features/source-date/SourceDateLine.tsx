// ノートの題の下（フォルダのチップの隣）に出す、日付の静かな 1 行。
//
// 「資料 2016 · 作成 2026-11-22」のように、資料の日付と作成日を同じ重さの控えめな文字で並べる。
// 資料の日付（doc.sourceDate）は「その資料がいつのものか」、作成日は Graphium で作った日。
// 資料の日付だけを色付きのバッジにすると、ほかの日付より強く見えてしまうので、どちらも文字にした
// （2026-11-24 の利用者の判断。Notion 風の欄は、全部のノートで本文が下がるので採らない）。
//
// 資料の日付が無いノートは作成日だけを出し、その後ろに薄い「＋ 資料の日付」を置く。
// 資料の日付を押すと小さな入力欄が開き、年だけ・年月だけでも書ける。
// 値の読み取りは lib/source-date.ts（parseSourceDate）。ここは保存形だけを onChange に渡す。

import { useLayoutEffect, useRef, useState } from "react";
import { Dropdown } from "@/ui/dropdown";
import type { Rect } from "@/ui/floating-position";
import { useImeEnterGuard } from "@/hooks/use-ime-enter-guard";
import { formatDate } from "@/lib/format-datetime";
import { parseSourceDate, sourceDatePrecision } from "@/lib/source-date";
import { useT } from "../../i18n";

type Props = {
  /** 今の資料の日付（保存形）。無ければ undefined */
  value?: string;
  /** ノートの作成日時（ISO）。無ければ作成日は出さない */
  createdAt?: string;
  /** 直せるか（アーカイブ・ゴミ箱のノートは false） */
  editable?: boolean;
  /** 付けた・直した（保存形）か、外した（undefined） */
  onChange: (next: string | undefined) => void;
  /** Storybook 用: 最初から入力欄を開いておく */
  defaultOpen?: boolean;
  /**
   * "line"（既定）: ノートの題の下。「資料 2016 · 作成 2026-11-22」。
   * "field": 見出しが別にある欄（素材の詳細）。値だけを出し、作成日は出さない
   */
  variant?: "line" | "field";
  /** 値の後ろに添える小さな注記（例: 「ファイルの中の作成日から」） */
  note?: string;
};

export function SourceDateLine({
  value,
  createdAt,
  editable = true,
  onChange,
  defaultOpen = false,
  variant = "line",
  note,
}: Props) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [open, setOpen] = useState(defaultOpen && editable);
  const [draft, setDraft] = useState(value ?? "");
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const openEditor = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
    setDraft(value ?? "");
    setOpen(true);
  };
  const close = () => setOpen(false);
  const toggle = () => (open ? close() : openEditor());

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
  const created = variant === "line" && createdAt ? formatDate(createdAt) : "";
  // 欄の中では見出しが「資料の日付」なので、値の前の「資料」は付けない
  const valueText = value ? (variant === "line" ? `${t("sourceDate.short")} ${value}` : value) : "";

  const rect = anchor;
  const position = rect ? { top: rect.bottom + 4, left: rect.left } : null;

  // 資料の日付の部分。直せるときはボタン（見た目は文字のまま、触れたときだけ下線）
  const sourcePart = value ? (
    editable ? (
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="rounded px-0.5 -mx-0.5 hover:text-foreground hover:underline underline-offset-2 transition-colors"
        data-tooltip={t("sourceDate.tooltip")}
        aria-label={t("sourceDate.editAria", { value })}
      >
        {valueText}
      </button>
    ) : (
      <span data-tooltip={t("sourceDate.tooltip")}>{valueText}</span>
    )
  ) : null;

  return (
    <>
      <span
        className={`inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums ${variant === "line" ? "ml-1" : ""}`}
        data-testid="source-date-line"
      >
        {sourcePart}
        {sourcePart && note && <span className="text-muted-foreground/70">{note}</span>}
        {sourcePart && created && <span aria-hidden="true">·</span>}
        {created && <span>{t("sourceDate.created")} {created}</span>}
        {!value && editable && (
          <button
            ref={buttonRef}
            type="button"
            onClick={toggle}
            className={`${created ? "ml-1 " : ""}rounded px-0.5 text-muted-foreground/60 hover:text-foreground hover:underline underline-offset-2 transition-colors`}
            data-tooltip={t("sourceDate.tooltip")}
          >
            ＋ {variant === "field" ? t("sourceDate.save") : t("sourceDate.label")}
          </button>
        )}
      </span>
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
