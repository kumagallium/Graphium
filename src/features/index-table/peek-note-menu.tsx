// サイドピーク（ノート・ナレッジ）のヘッダー右端の ⋯ メニュー。
//
// 全画面のノートの ⋯（note-app の NoteHeaderMenu）と同じ見た目・同じ作り（メニュー本体は
// body へ出して画面に収める）。項目は今は「リンクをコピー」だけ — 幅いっぱい・A4 は
// ピークでは用紙にしないので意味が無く、共有・提案は全画面側の状態とつながっているため
// ピークには持ち込まない。リンクを作れない行き先（版のスナップショット・スキル）では
// 呼び出し側が link を null にし、メニューごと出さない。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, MoreHorizontal } from "lucide-react";
import { useFloatingPlacement } from "@/ui/floating-position";
import { useT } from "../../i18n";
import { buildKnowledgeLink, buildNoteLink } from "../block-link/graphium-link";

export type PeekNoteMenuProps = {
  /** コピーするリンク（graphium-link.ts で作ったもの）。null ならメニューを出さない */
  link: string | null;
};

export function PeekNoteMenu({ link }: PeekNoteMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const placed = useFloatingPlacement(menuRef.current, panelEl, open, { placement: "bottom-end" });

  // メニュー外クリックで閉じる（メニュー本体は portal 先なので両方を内側と見なす）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || panelEl?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, panelEl]);

  if (!link) return null;

  const itemClass =
    "w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground rounded hover:bg-muted transition-colors";

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        aria-label={t("common.menu")}
        data-tooltip={t("common.menu")}
      >
        <MoreHorizontal size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={setPanelEl}
            className="fixed w-48 overflow-y-auto bg-popover border border-border rounded-lg shadow-md py-1 z-[9999]"
            style={
              placed
                ? { top: placed.top, left: placed.left, maxHeight: placed.maxHeight }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            <button
              className={itemClass}
              onClick={() => {
                // 外に貼ればそのページを開け、Graphium のノートに貼ると @リンクになる
                void navigator.clipboard?.writeText(link);
                setCopied(true);
                // コピーしたことが分かるよう少し見せてから閉じる（全画面の「リンクをコピー」と同じ）
                setTimeout(() => {
                  setCopied(false);
                  setOpen(false);
                }, 1000);
              }}
            >
              {copied ? <Check size={14} /> : <Link2 size={14} />}
              {copied ? t("share.linkCopied") : t("share.copyLink")}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * ピークの行き先 ID からコピーするリンクを作る。
 * - `wiki:<id>` → Knowledge（種別は開いている文書の wikiMeta.kind）
 * - `snapshot:` / `skill:` → リンクで開けないので null
 * - それ以外 → ノート
 */
export function peekNoteLink(peekId: string, wikiKind: string | undefined): string | null {
  if (peekId.startsWith("snapshot:") || peekId.startsWith("skill:")) return null;
  if (peekId.startsWith("wiki:")) return buildKnowledgeLink(wikiKind ?? "concept", peekId.slice("wiki:".length));
  return buildNoteLink(peekId);
}
