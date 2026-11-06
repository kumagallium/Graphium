// 「テンプレートとして共有」ダイアログ（PR 3）。
// 作法は share-media-dialog.tsx に合わせる（同じ枠・同じ入力・同じボタン配置）。
//
// トリガーは持たない（ノートの ⋯ メニュー側が開閉を持つ）。なぜ: 素材共有と違って
// 入口がメニュー項目なので、ボタンを内蔵すると二重に見える。
//
// 共有する本文は「開いた時点」ではなく「共有を押した時点」に組み立てる（resolveSource）。
// ダイアログを開いたまま編集を続けても、共有されるのは最新の本文になる。

import { DIALOG_LAYER } from "@/ui/z-layers";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";
import type { StepAttributes } from "../context-label/label-attributes";
import { loadAuthorIdentity } from "../identity";
import { getSharedRoot, getBlobRoot, type SharedEntry } from "../../lib/storage/shared";
import { SharedFolderPicker } from "./SharedFolderPicker";
import { confirmCrossFolderCitations, findCrossFolderCitations } from "./cross-folder";
import { shareTemplate } from "./share-template";
import { notifySharedLibraryChanged } from "./shared-library-store";

export type ShareTemplateDialogProps = {
  open: boolean;
  /** タイトル入力の初期値（既定はノート題名） */
  defaultTitle: string;
  /** 共有元のノート（作者本人の一覧で「元のノートを開く」を出すために記録する） */
  sourceNote?: { id?: string; title: string };
  /**
   * 共有対象の本文を組み立てる。null を返した場合は共有しない。
   * 呼び出し側が最新の doc とページ（複数ページなら開いているページ）を返す。
   *
   * attributes は手順の連動属性（blockId → StepAttributes）。ページに保存されない
   * 実行時の状態なので、ラベルストアを持つ呼び出し側から受け取るしかない。
   */
  resolveSource: () => Promise<{
    doc: GraphiumDocument;
    page: GraphiumPage;
    attributes?: [string, StepAttributes][];
  } | null>;
  onClose: () => void;
  /** 共有成功後（共有ライブラリへの通知はこのコンポーネントが済ませてある） */
  onShared?: (entry: SharedEntry) => void;
};

export function ShareTemplateDialog({
  open,
  defaultTitle,
  sourceNote,
  resolveSource,
  onClose,
  onShared,
}: ShareTemplateDialogProps) {
  const t = useT();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 元のノートの題名も一緒に共有するか。既定は ON。OFF なら id だけ（作者本人の手元でだけ開ける・他の人には「記録なし」）
  const [shareSourceTitle, setShareSourceTitle] = useState(true);
  // 置き場（共有フォルダ）。テンプレートは共有するたびに新しい封筒なので、毎回選べる。初期値は既定の共有先
  const [folderRoot, setFolderRoot] = useState<string>(() => getSharedRoot() ?? "");

  // 開くたびに入力を初期化する（前回の説明が残っていると別テンプレートに紛れ込む）
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDescription("");
    setError(null);
    setFolderRoot(getSharedRoot() ?? "");
    setShareSourceTitle(true);
  }, [open, defaultTitle]);

  const handleShare = useCallback(async () => {
    const sharedRoot = folderRoot || getSharedRoot();
    const author = loadAuthorIdentity();
    if (!sharedRoot || !author) return;
    setBusy(true);
    setError(null);
    try {
      const source = await resolveSource();
      if (!source) {
        setError(t("share.template.noPage"));
        return;
      }
      // 共有先と違う共有フォルダにあるものを引用していたら、続けるか聞く（§26 PR4）
      if (!(await confirmCrossFolderCitations(findCrossFolderCitations({ pages: [source.page] }, sharedRoot), sharedRoot, t))) {
        return;
      }
      const result = await shareTemplate(source.doc, source.page, {
        sharedRoot,
        blobRoot: getBlobRoot(sharedRoot) ?? undefined,
        author,
        title,
        description,
        attributes: source.attributes,
        sourceNote: sourceNote
          ? shareSourceTitle
            ? sourceNote
            : { ...(sourceNote.id ? { id: sourceNote.id } : {}) }
          : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // 共有ライブラリが変わった（Library / 引用ピッカー / 語彙索引はこの通知で追従）
      notifySharedLibraryChanged();
      onShared?.(result.entry);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [resolveSource, sourceNote, shareSourceTitle, title, description, onShared, onClose, t, folderRoot]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            {t("share.template.dialog.title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("share.template.dialog.help")}</p>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">
            {t("share.template.dialog.titleLabel")}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">
            {t("share.template.dialog.descLabel")}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none resize-none"
          />
        </div>
        <SharedFolderPicker value={folderRoot} onChange={setFolderRoot} disabled={busy} />
        {sourceNote?.title && (
          <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              data-testid="share-source-title"
              checked={shareSourceTitle}
              disabled={busy}
              onChange={(e) => setShareSourceTitle(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t("share.template.dialog.sourceTitle", { title: sourceNote.title })}</span>
          </label>
        )}
        {error && (
          <p className="text-xs text-red-500 flex items-start gap-1">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleShare}
            disabled={busy || !title.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {t("share.sharing")}
              </>
            ) : (
              t("share.template.dialog.share")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
