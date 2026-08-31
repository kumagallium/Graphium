// サイドバーの「フォルダ」ツリー。実体は noteContexts（文脈ラベル）で、
// エクスプローラーのフォルダのように見せる（design.md 決定事項 2026-08-31）。
//
// - 行クリック = フォルダを開く（ノート一覧をその文脈で絞り込む）。子があれば同時に展開
// - シェブロン = 開閉のみ（選択しない）
// - 「＋ 新しいフォルダ」= インライン入力。"親/子" 記法で 2 階層まで（validateFolderPath）
// - 右クリックメニュー（移動・削除・リネーム・サブフォルダ作成）と D&D は後続段で載せる。
//   このコンポーネントはツリーの見た目とナビゲーションだけを担い、
//   フォルダ削除＝タグ剥がし等のデータ操作は呼び出し側の責務にする

import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "@/hooks/use-ime-enter-guard";
import { buildFolderTree, splitFolderPath, validateFolderPath, type FolderNode } from "./folder-tree-model";

/** 「未分類」を selected で表すための特殊値（実フォルダ名と衝突しない予約値） */
export const UNFILED_PATH = "__unfiled__";

export type FolderTreeProps = {
  /** 使用中フォルダと件数（aggregateNoteContexts の出力をそのまま渡す） */
  folders: readonly { value: string; count: number }[];
  /** ノート 0 件の空フォルダ（appdata 由来の定義） */
  emptyFolders?: readonly string[];
  /** 未分類（文脈なし）ノートの件数。undefined なら未分類行を出さない */
  unfiledCount?: number;
  /** 選択中のフォルダ path（未分類は UNFILED_PATH、非選択は null） */
  selected?: string | null;
  onSelectFolder?: (path: string) => void;
  onSelectUnfiled?: () => void;
  /** 指定すると「＋ 新しいフォルダ」行を出す（作成の永続化は呼び出し側） */
  onCreateFolder?: (path: string) => void;
};

// 行の外殻。シェブロン（開閉）と本体（選択）は別ボタンにするため
// interactive 要素を入れ子にせず、div がホバー/選択の見た目を持つ
const rowShellClass = (active: boolean) =>
  `flex items-center rounded transition-colors ${
    active
      ? "bg-primary/10 text-primary"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
  }`;

export function FolderTree({
  folders,
  emptyFolders,
  unfiledCount,
  selected,
  onSelectFolder,
  onSelectUnfiled,
  onCreateFolder,
}: FolderTreeProps) {
  const t = useT();
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const tree = useMemo(() => buildFolderTree(folders, emptyFolders ?? []), [folders, emptyFolders]);

  // 展開状態（小文字 path キー）。既定は畳み、選択中フォルダの親だけ自動で開く
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!selected || selected === UNFILED_PATH) return;
    const { parent } = splitFolderPath(selected);
    if (!parent) return;
    const key = parent.toLowerCase();
    setExpanded((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [selected]);

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // インライン新規作成
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<"invalid" | "tooDeep" | null>(null);
  const closeDraft = () => {
    setCreating(false);
    setDraft("");
    setDraftError(null);
  };

  const selectedKey = selected && selected !== UNFILED_PATH ? selected.toLowerCase() : null;

  const renderFolderRow = (node: FolderNode, isChild: boolean) => {
    const key = node.path.toLowerCase();
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(key);
    const isActive = selectedKey === key;
    return (
      <div key={node.path} className={rowShellClass(isActive)}>
        {/* シェブロン列: root で子ありのときだけ開閉ボタン。それ以外は幅合わせ */}
        {!isChild && hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("nav.toggleFolder", { value: node.name })}
            aria-expanded={isOpen}
            onClick={() => toggleExpand(key)}
            className="w-4 h-4 ml-2 shrink-0 inline-flex items-center justify-center rounded hover:bg-sidebar-accent"
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className={`w-4 shrink-0 ${isChild ? "ml-7" : "ml-2"}`} aria-hidden />
        )}
        <button
          type="button"
          title={node.path}
          onClick={() => {
            onSelectFolder?.(node.path);
            // 開く操作と選択を一体にする（エクスプローラーの「フォルダを開く」感覚）
            if (hasChildren && !isOpen) toggleExpand(key);
          }}
          className={`flex-1 min-w-0 flex items-center gap-1.5 py-1 pr-2 pl-1.5 text-sm text-left ${
            isActive ? "font-semibold" : ""
          }`}
        >
          <span className="text-muted-foreground shrink-0" aria-hidden>
            {!isChild && hasChildren && isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
          </span>
          <span className="flex-1 truncate">{node.name}</span>
          {node.totalCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{node.totalCount}</span>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <div key={node.path}>
          {renderFolderRow(node, false)}
          {expanded.has(node.path.toLowerCase()) &&
            node.children.map((child) => renderFolderRow(child, true))}
        </div>
      ))}

      {typeof unfiledCount === "number" && (
        <>
          {tree.length > 0 && <div className="my-1 border-t border-sidebar-border/50" aria-hidden />}
          <div className={rowShellClass(selected === UNFILED_PATH)}>
            <span className="w-4 ml-2 shrink-0" aria-hidden />
            <button
              type="button"
              onClick={() => onSelectUnfiled?.()}
              className={`flex-1 min-w-0 flex items-center gap-1.5 py-1 pr-2 pl-1.5 text-sm text-left ${
                selected === UNFILED_PATH ? "font-semibold" : ""
              }`}
            >
              <span className="text-muted-foreground shrink-0" aria-hidden>
                <FileText size={14} />
              </span>
              <span className="flex-1 truncate">{t("nav.unfiled")}</span>
              {unfiledCount > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">{unfiledCount}</span>
              )}
            </button>
          </div>
        </>
      )}

      {onCreateFolder && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full flex items-center gap-1.5 py-1 pr-2 rounded text-xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          <span className="w-4 ml-2 shrink-0" aria-hidden />
          <Plus size={13} className="shrink-0" />
          <span className="flex-1 text-left">{t("nav.newFolder")}</span>
        </button>
      )}
      {onCreateFolder && creating && (
        <div className="px-2 py-1">
          <input
            autoFocus
            value={draft}
            placeholder={t("nav.folderNamePlaceholder")}
            className="w-full text-sm px-1.5 py-0.5 rounded border border-sidebar-border bg-background outline-none focus:border-primary/50"
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftError(null);
            }}
            onKeyDown={(e) => {
              // IME 変換確定の Enter では作成しない（WKWebView の確定順対策も含む）
              if (isImeKey(e)) return;
              if (e.key === "Enter") {
                const verdict = validateFolderPath(draft);
                if (verdict === "empty") {
                  closeDraft();
                  return;
                }
                if (verdict !== "ok") {
                  setDraftError(verdict);
                  return;
                }
                onCreateFolder(draft.trim());
                closeDraft();
              } else if (e.key === "Escape") {
                closeDraft();
              }
            }}
            onBlur={closeDraft}
            {...compositionHandlers}
          />
          {draftError && (
            <p className="text-[11px] text-destructive mt-0.5">
              {t(draftError === "tooDeep" ? "nav.folderDepthLimit" : "nav.folderNameInvalid")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
