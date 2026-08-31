// フォルダの右クリックメニュー（名前の変更・削除）。
//
// フォルダの実体は noteContexts のタグなので、ここでの操作はすべてタグの付け替えに落ちる:
//   - 名前の変更 = そのタグを持つ全ノートのタグを新しい名前に差し替える
//   - 削除       = そのタグを全ノートから外す（ノート自体は消さない）
// 実際の書き換えは呼び出し側（note-app）の責務で、この部品は入口と確認だけを持つ。

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Dropdown } from "@/ui/dropdown";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "@/hooks/use-ime-enter-guard";
import { validateFolderPath } from "./folder-tree-model";

export type FolderMenuProps = {
  /** 対象フォルダの path（"親" または "親/子"） */
  path: string;
  /** 表示名（末尾セグメント） */
  name: string;
  /** このフォルダに直接入っているノート数 + 子の合計 */
  noteCount: number;
  position: { top: number; left: number };
  onClose: () => void;
  /** 名前の変更。新しい path を渡す（親は変えない） */
  onRename?: (path: string, nextPath: string) => void;
  /** 削除（タグ剥がし）。中のノートは消さない */
  onDelete?: (path: string) => void;
};

export function FolderMenu({
  path,
  name,
  noteCount,
  position,
  onClose,
  onRename,
  onDelete,
}: FolderMenuProps) {
  const t = useT();
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const [mode, setMode] = useState<"menu" | "rename" | "confirmDelete">("menu");
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState(false);

  // path の親部分を保ったまま、末尾だけ差し替える（メニューから階層は動かさない）
  const commitRename = () => {
    const next = draft.trim();
    if (!next || next === name) {
      onClose();
      return;
    }
    // 末尾セグメントに "/" を書かれると階層が動いてしまうので弾く
    if (next.includes("/") || validateFolderPath(next) !== "ok") {
      setError(true);
      return;
    }
    const slash = path.lastIndexOf("/");
    const nextPath = slash < 0 ? next : `${path.slice(0, slash)}/${next}`;
    onRename?.(path, nextPath);
    onClose();
  };

  return (
    <Dropdown position={position} onClose={onClose} minWidth={240}>
      {mode === "menu" && (
        <div className="py-1">
          {onRename && (
            <button
              type="button"
              onClick={() => {
                setDraft(name);
                setError(false);
                setMode("rename");
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-foreground hover:bg-muted transition-colors"
            >
              <Pencil size={14} className="text-muted-foreground shrink-0" />
              <span>{t("nav.renameFolder")}</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => setMode("confirmDelete")}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 size={14} className="shrink-0" />
              <span>{t("nav.deleteFolder")}</span>
            </button>
          )}
        </div>
      )}

      {mode === "rename" && (
        <div className="p-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => {
              if (isImeKey(e)) return;
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") onClose();
            }}
            className="w-full text-sm px-2 py-1 rounded border border-border bg-background outline-none focus:border-primary/50"
            {...compositionHandlers}
          />
          {error && (
            <p className="text-[11px] text-destructive mt-1">{t("nav.folderNameInvalid")}</p>
          )}
        </div>
      )}

      {mode === "confirmDelete" && (
        <div className="p-3 space-y-3">
          {/* ファイルマネージャの「フォルダごと消える」とは挙動が違うので、
              中のノートが消えないことを削除の瞬間にはっきり書く */}
          <p className="text-sm text-foreground">
            {t("nav.deleteContextConfirm", { value: name, count: String(noteCount) })}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete?.(path);
                onClose();
              }}
              className="px-2.5 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              {t("nav.deleteFolder")}
            </button>
          </div>
        </div>
      )}
    </Dropdown>
  );
}
