// 「+ ノート」の分割ボタン。本体は従来どおり新規ノート、右端の ▾ で種類を選ぶ
// （ノート / 音声ノート）。音声ノートはデスクトップ版だけなので、onNewVoiceNote が
// 渡されていないときは従来の単一ボタンのまま出す。

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, Mic } from "lucide-react";
import { useT } from "../i18n";

const base =
  "text-sm font-medium border border-sidebar-border text-sidebar-foreground/85 bg-transparent hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors";

export function NewNoteSplitButton({
  onNewNote,
  onNewVoiceNote,
  recording = false,
  className = "",
}: {
  onNewNote: () => void;
  onNewVoiceNote?: () => void;
  /** 録音中は「音声ノート」を押せない */
  recording?: boolean;
  /** 外側の幅の指定（shrink-0 / w-full など） */
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!onNewVoiceNote) {
    return (
      <button onClick={onNewNote} className={`${base} whitespace-nowrap text-left rounded-lg px-3 py-1.5 ${className}`}>
        {t("sidebar.newNote")}
      </button>
    );
  }

  return (
    <div ref={rootRef} className={`relative flex ${className}`}>
      <button onClick={onNewNote} className={`${base} flex-1 whitespace-nowrap text-left rounded-l-lg px-3 py-1.5`}>
        {t("sidebar.newNote")}
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("sidebar.newMenu")}
        aria-expanded={open}
        className={`${base} -ml-px shrink-0 rounded-r-lg px-1.5 py-1.5`}
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-max min-w-[12rem] rounded-xl border border-border bg-popover p-1 text-sm shadow-lg" role="menu">
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-foreground hover:bg-accent transition-colors"
            onClick={() => {
              setOpen(false);
              onNewNote();
            }}
          >
            <FileText size={13} className="shrink-0 text-muted-foreground" />
            <span>{t("sidebar.newNoteBlank")}</span>
            <span className="ml-auto whitespace-nowrap pl-3 text-xs text-muted-foreground">{t("sidebar.newNoteBlankHint")}</span>
          </button>
          <button
            role="menuitem"
            disabled={recording}
            data-tooltip={t("meeting.startTooltip")}
            className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-foreground hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent transition-colors"
            onClick={() => {
              setOpen(false);
              onNewVoiceNote();
            }}
          >
            {recording ? (
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
            ) : (
              <Mic size={13} className="shrink-0 text-muted-foreground" />
            )}
            <span>{recording ? t("meeting.recording") : t("sidebar.newVoiceNote")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
