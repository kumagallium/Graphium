// サイドピーク（ノート・ナレッジ）のヘッダー右端の ⋯ メニュー。
//
// 全画面のノートの ⋯（note-app の NoteHeaderMenu）と同じ見た目・同じ文言・同じ作り
// （メニュー本体は body へ出して画面に収める）。ピークで全画面と同じ結果になる項目だけを置く:
//   リンクをコピー / Markdown で書き出し / アーカイブ / ゴミ箱へ
// 置かないもの: PDF・PROV の書き出し（ピークは PROV を作らないので欠けた出力になる）、
// 幅いっぱい・A4（ピークは用紙にしない）、共有・提案・テンプレート・派生・版・AI の題
// （全画面側の状態とつながっている）、ナレッジに追加（ヘッダーのチップにある）。
// どの項目も渡されなければ出さず、1 つも無ければ ⋯ ごと出さない。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Check, FileText, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { useFloatingPlacement } from "@/ui/floating-position";
import { useT } from "../../i18n";
import { buildKnowledgeLink, buildNoteLink } from "../block-link/graphium-link";

export type PeekNoteMenuProps = {
  /** コピーするリンク（graphium-link.ts で作ったもの）。null なら「リンクをコピー」を出さない */
  link: string | null;
  onExportMarkdown?: () => void;
  /** アーカイブ（通常のノートで、まだアーカイブ・ゴミ箱に入っていないときだけ渡す） */
  onArchive?: () => void;
  /** ゴミ箱へ（同上） */
  onTrash?: () => void;
};

export function PeekNoteMenu({ link, onExportMarkdown, onArchive, onTrash }: PeekNoteMenuProps) {
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

  if (!link && !onExportMarkdown && !onArchive && !onTrash) return null;

  const itemClass =
    "w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground rounded hover:bg-muted transition-colors";
  const divider = <div className="my-1 border-t border-border" />;
  // 押したらメニューを閉じてから実行する
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

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
            {onExportMarkdown && (
              <button className={itemClass} onClick={run(onExportMarkdown)}>
                <FileText size={14} />
                {t("markdown.export")}
              </button>
            )}
            {link && (
              <>
                {onExportMarkdown && divider}
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
              </>
            )}
            {(onArchive || onTrash) && (onExportMarkdown || link) && divider}
            {onArchive && (
              <button className={itemClass} onClick={run(onArchive)} data-tooltip={t("editor.archiveNoteHint")}>
                <Archive size={14} />
                {t("editor.archiveNote")}
              </button>
            )}
            {onTrash && (
              <button className={`${itemClass} text-destructive hover:bg-destructive/10`} onClick={run(onTrash)}>
                <Trash2 size={14} />
                {t("editor.deleteNote")}
              </button>
            )}
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

/**
 * ピークの ⋯ に「アーカイブ」「ゴミ箱へ」を出してよい行き先か。全画面の ⋯ と同じく
 * 通常のノートだけ（ナレッジ・スキル・版のスナップショットは出さない）で、
 * すでにアーカイブ・ゴミ箱に入っているものにも出さない（バナーの「復元」を使う）。
 */
export function canArchiveFromPeek(peekId: string, state: { archived: boolean; trashed: boolean }): boolean {
  if (/^(wiki|skill|snapshot):/.test(peekId)) return false;
  return !state.archived && !state.trashed;
}

/** ピークへ渡す「アーカイブ」「ゴミ箱へ」の口（SidePeek の同名 props） */
export type PeekNoteActions = {
  onArchiveNote?: () => void;
  onTrashNote?: () => void;
  confirmTrashNote?: () => boolean;
};
