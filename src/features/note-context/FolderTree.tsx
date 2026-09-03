// サイドバーの「フォルダ」ツリー。実体は noteContexts（文脈ラベル）で、
// エクスプローラーのフォルダのように見せる（design.md 決定事項 2026-08-31）。
//
// - 行クリック = フォルダを開く（ノート一覧をその文脈で絞り込む）。子があれば同時に展開
// - シェブロン = 開閉のみ（選択しない）
// - 「＋ 新しいフォルダ」= インライン入力。"親/子" 記法で 2 階層まで（validateFolderPath）
// - 親フォルダのホバー時の「＋」= そのフォルダの中に子を作る（スラッシュを手で打たせない）。
//   2 階層制約により子フォルダには出さない
// - 右クリック = 名前の変更・削除（メニュー本体は FolderMenu、ここは入口だけ）
// - ノートのドロップを受け付ける（一覧のタイトルからドラッグ）。Ctrl / Cmd で「出ずに入る」
//   このコンポーネントはツリーの見た目とナビゲーションだけを担い、
//   フォルダ削除＝タグ剥がし等のデータ操作は呼び出し側の責務にする

import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "@/hooks/use-ime-enter-guard";
import { buildFolderTree, splitFolderPath, validateFolderPath, UNFILED_PATH, type FolderNode } from "./folder-tree-model";
import { FOLDER_DRAG_MIME, readDraggedNoteIds } from "./folder-drop";

export { UNFILED_PATH };

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
  /**
   * フォルダを右クリックしたとき（名前の変更・削除メニュー用）。
   * メニュー自体は呼び出し側が出す — ツリーは入口だけを持つ。
   */
  onFolderContextMenu?: (
    folder: { path: string; name: string; noteCount: number },
    position: { top: number; left: number },
  ) => void;
  /**
   * ノートがフォルダに落とされたとき。渡されたときだけドロップを受け付ける。
   * copy=true は Ctrl / Cmd を押しながら（今の場所から出ずに入る）。
   */
  onDropNotes?: (folderPath: string, noteIds: string[], copy: boolean) => void;
};

// 行の外殻。シェブロン（開閉）と本体（選択）は別ボタンにするため
// interactive 要素を入れ子にせず、div がホバー/選択の見た目を持つ
const rowShellClass = (active: boolean) =>
  `relative flex items-center rounded transition-colors ${
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
  onFolderContextMenu,
  onDropNotes,
}: FolderTreeProps) {
  const t = useT();
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const tree = useMemo(() => buildFolderTree(folders, emptyFolders ?? []), [folders, emptyFolders]);

  // ドラッグ中に枠を出しているフォルダ（小文字 path キー）
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  // インライン新規作成。creating = null なら閉、"" ならルート、"親名" ならその子を作る
  const [creating, setCreating] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<"invalid" | "tooDeep" | null>(null);
  const closeDraft = () => {
    setCreating(null);
    setDraft("");
    setDraftError(null);
  };
  const openDraftUnder = (parent: string) => {
    setDraft("");
    setDraftError(null);
    setCreating(parent);
    // 子を作るときは親を開いておく（作った直後に見えないと迷子になる）
    if (parent) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(parent.toLowerCase());
        return next;
      });
    }
  };
  /** 入力値を確定する。親配下なら "親/入力" に組み立ててから検証する */
  const commitDraft = () => {
    if (creating === null) return;
    const raw = draft.trim();
    if (!raw) {
      closeDraft();
      return;
    }
    const path = creating ? `${creating}/${raw}` : raw;
    const verdict = validateFolderPath(path);
    if (verdict !== "ok") {
      // raw は空でないので "empty" は返らないが、型を絞るためにフォールバックを置く
      setDraftError(verdict === "empty" ? "invalid" : verdict);
      return;
    }
    onCreateFolder?.(path);
    closeDraft();
  };

  const draftInput = (indent: boolean) => (
    <div className={`py-1 pr-2 ${indent ? "pl-9" : "px-2"}`}>
      <input
        autoFocus
        value={draft}
        placeholder={creating ? t("nav.folderNameChildPlaceholder") : t("nav.folderNamePlaceholder")}
        className="w-full text-sm px-1.5 py-0.5 rounded border border-sidebar-border bg-background outline-none focus:border-primary/50"
        onChange={(e) => {
          setDraft(e.target.value);
          setDraftError(null);
        }}
        onKeyDown={(e) => {
          // IME 変換確定の Enter では作成しない（WKWebView の確定順対策も含む）
          if (isImeKey(e)) return;
          if (e.key === "Enter") commitDraft();
          else if (e.key === "Escape") closeDraft();
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
  );

  const selectedKey = selected && selected !== UNFILED_PATH ? selected.toLowerCase() : null;

  const renderFolderRow = (node: FolderNode, isChild: boolean) => {
    const key = node.path.toLowerCase();
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(key);
    const isActive = selectedKey === key;
    // 子フォルダを作れるのは root だけ（2 階層制約）
    const canAddChild = !isChild && !!onCreateFolder;
    const isDropTarget = dropTarget === key;
    return (
      <div
        key={node.path}
        className={`group ${rowShellClass(isActive)}${
          isDropTarget ? " ring-2 ring-primary/60 bg-primary/10" : ""
        }`}
        onContextMenu={
          onFolderContextMenu
            ? (e) => {
                e.preventDefault();
                onFolderContextMenu(
                  { path: node.path, name: node.name, noteCount: node.totalCount },
                  { top: e.clientY, left: e.clientX },
                );
              }
            : undefined
        }
        {...(onDropNotes
          ? {
              onDragOver: (e: React.DragEvent) => {
                if (!e.dataTransfer.types.includes(FOLDER_DRAG_MIME)) return;
                // preventDefault しないとブラウザがドロップを拒否する
                e.preventDefault();
                e.dataTransfer.dropEffect = e.metaKey || e.ctrlKey ? "copy" : "move";
                setDropTarget(key);
              },
              onDragLeave: (e: React.DragEvent) => {
                // 子要素間の移動でも leave が飛ぶので、行の外に出たときだけ解除する
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDropTarget((prev) => (prev === key ? null : prev));
              },
              onDrop: (e: React.DragEvent) => {
                const ids = readDraggedNoteIds(e.dataTransfer.getData(FOLDER_DRAG_MIME));
                setDropTarget(null);
                if (ids.length === 0) return;
                e.preventDefault();
                onDropNotes(node.path, ids, e.metaKey || e.ctrlKey);
              },
            }
          : {})}
      >
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
            // ＋ が出ている間は件数をその左に逃がす（重ねて隠さない）。
            // 位置が動くのは ＋ が出ている行だけなので、他セクションとの縦揃えは保たれる。
            <span
              className={`text-xs text-muted-foreground tabular-nums transition-[margin] ${
                canAddChild ? (isActive ? "mr-6" : "group-hover:mr-6") : ""
              }`}
            >
              {node.totalCount}
            </span>
          )}
        </button>
        {/* このフォルダの中に子を作る。スラッシュを手で打たせないための入口。
            件数の「右」に絶対配置で重ねる — 行の流れに置くと件数が押し出されて、
            他セクション（素材・ラベル）の件数の右端と縦に揃わなくなる。
            hover に加えて選択中も出す（選択したフォルダで次にやることが「中に作る」なので、
            マウスを載せ直さずに続けられる）。 */}
        {canAddChild && (
          <button
            type="button"
            title={t("nav.newSubfolderIn", { value: node.name })}
            aria-label={t("nav.newSubfolderIn", { value: node.name })}
            onClick={() => openDraftUnder(node.path)}
            // right-1.5 = 6px: アイコンの右端が他セクションの件数の右端（同じ pr-2 の内側）に揃う
            className={`absolute right-1.5 w-5 h-5 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-opacity ${
              isActive
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <Plus size={12} />
          </button>
        )}
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
          {/* このフォルダ配下の新規入力（＋ボタン由来）は子の末尾に出す。
              子がまだ無い（＝シェブロンが無く展開の概念がない）フォルダでも出す */}
          {creating === node.path && draftInput(true)}
        </div>
      ))}

      {typeof unfiledCount === "number" && (
        <>
          {/* 区切り線は引かない — サイドバーは divider が既に多く、増やすと混乱する（2026-08-31 レビュー） */}
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

      {onCreateFolder && creating === null && (
        <button
          type="button"
          onClick={() => openDraftUnder("")}
          className="w-full flex items-center gap-1.5 py-1 pr-2 rounded text-xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          <span className="w-4 ml-2 shrink-0" aria-hidden />
          <Plus size={13} className="shrink-0" />
          <span className="flex-1 text-left">{t("nav.newFolder")}</span>
        </button>
      )}
      {onCreateFolder && creating === "" && draftInput(false)}
    </div>
  );
}
