// 「元のノートへ変更を提案」ダイアログ（§25 C-3）。
// 作法は ShareTemplateDialog に合わせる（同じ枠・同じ入力・同じボタン配置・
// 本文は「押した時点」に組み立てる resolveSource）。
//
// トリガーは持たない（ノートの ⋯ メニュー側が開閉を持つ）。
//
// ここで見せるのは 3 つだけ:
//   - どのノートへの提案か（題名と作者）
//   - 基準版の状態（派生した時点の版と一致しているか / その後更新されたか）
//   - 説明（任意の 1 行）
// 「提案する」を押すと proposals/ に自分名義の封筒が 1 通できるだけで、
// 元のノートには一切書かない —— その安心を文言でも言い切る。

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, GitPullRequestArrow, Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import type { GraphiumDocument } from "../../lib/document-types";
import { loadAuthorIdentity } from "../identity";
import {
  getSharedRoot,
  getBlobRoot,
  getShareIncludesPrivateHistory,
  type SharedEntry,
} from "../../lib/storage/shared";
import { shareProposal, type ShareProposalResult } from "./share-proposal";
import { notifySharedLibraryChanged, useSharedLibrary } from "./shared-library-store";
import { sharedEntryTitle } from "./shared-entry-parts";
import { isTargetUpdatedSinceFork, type ResolvedProposalBase } from "./proposal-base";

export type ProposeChangesDialogProps = {
  open: boolean;
  /**
   * 提案先＝派生元の共有エントリ id（doc.forkedFrom.sharedId）。
   *
   * 実体はこのダイアログが共有ストアから引く。呼び出し側（ノートのエディタ）に
   * ストアを購読させると、共有フォルダが更新されるたびにノート本体まで
   * 描き直すことになる —— 購読する部品をここに閉じ込める（コメントのバッジと同じ作法）。
   * 一覧に無ければ「見つからない」案内だけを出して提案させない（何への提案か
   * 分からない封筒を作らないため）。
   */
  targetId: string;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
  /** 手元ノートの forkedFrom（基準版の状態表示に使う） */
  forkedFrom?: GraphiumDocument["forkedFrom"];
  /** 既に提案として共有済みか（見出しとボタンが「提案を更新」になる） */
  isUpdate?: boolean;
  /**
   * 提案する本文を組み立てる。null を返した場合は提案しない。
   * ダイアログを開いたまま編集を続けても、共有されるのは最新の本文になる
   * （ShareTemplateDialog と同じ約束）。
   */
  resolveSource: () => Promise<GraphiumDocument | null>;
  /**
   * 基準版（3 者比較の土台）の解決。未指定なら基準版なし＝ 2 者比較で提案する。
   * 呼び出し側（note-app）が resolveProposalBase を通して渡す。
   */
  resolveBase?: (target: SharedEntry) => Promise<ResolvedProposalBase>;
  onClose: () => void;
  /** 提案成功後（共有ライブラリへの通知は済ませてある）。呼び出し側が doc を保存する */
  onShared?: (doc: GraphiumDocument, entry: SharedEntry) => void;
  /** DI: 実際の書き込み（既定は shareProposal）。テスト・Storybook 用 */
  __share?: typeof shareProposal;
};

export function ProposeChangesDialog({
  open,
  targetId,
  entries,
  forkedFrom,
  isUpdate,
  resolveSource,
  resolveBase,
  onClose,
  onShared,
  __share,
}: ProposeChangesDialogProps) {
  const t = useT();
  const snapshot = useSharedLibrary();
  const all = entries ?? snapshot.entries;
  // 提案への提案は無いので、同 id の提案封筒を元エントリと取り違えない
  const target = useMemo(
    () => all.find((e) => e.id === targetId && e.type !== "proposal") ?? null,
    [all, targetId],
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開くたびに入力を初期化する（前回の説明が別の提案に紛れ込まないように）
  useEffect(() => {
    if (!open) return;
    setMessage("");
    setError(null);
  }, [open]);

  const handlePropose = useCallback(async () => {
    const sharedRoot = getSharedRoot();
    const author = loadAuthorIdentity();
    if (!sharedRoot || !author || !target) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await resolveSource();
      if (!doc) {
        setError(t("share.propose.dialog.noTarget"));
        return;
      }
      // 基準版は「提案する」を押した時点で取り寄せる。開いた瞬間に読むと、
      // ダイアログを開いたまま元が更新された場合に古い判断のまま出すことになる
      const base = resolveBase ? await resolveBase(target) : { origin: "none" as const };
      const result: ShareProposalResult = await (__share ?? shareProposal)(
        doc,
        {
          target: target.id,
          targetHash: target.hash,
          targetTitle: sharedEntryTitle(target, t),
          message,
          base: base.body,
        },
        {
          root: sharedRoot,
          author,
          blobRoot: getBlobRoot() ?? undefined,
          // 単発の共有と同じく、設定のスイッチがそのまま効く（§24）
          includePrivateHistory: getShareIncludesPrivateHistory(),
        },
      );
      if (!result.ok) {
        setError(t("share.propose.failed", { error: result.error }));
        return;
      }
      // 共有ライブラリが変わった（Library / 引用ピッカーはこの通知 1 本で追従する）
      notifySharedLibraryChanged();
      onShared?.(result.doc, result.entry);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [target, resolveSource, resolveBase, message, onShared, onClose, t, __share]);

  if (!open) return null;

  const targetTitle = target ? sharedEntryTitle(target, t) : "";
  const targetAuthor = target?.author?.name ?? "";
  const stale = isTargetUpdatedSinceFork(target, forkedFrom);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      data-testid="propose-changes-dialog"
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1.5">
            <GitPullRequestArrow size={14} className="text-muted-foreground" />
            {isUpdate ? t("share.propose.update") : t("share.propose.dialog.title")}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("share.propose.dialog.help")}
          </p>
        </div>

        {target ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1.5">
            <div className="flex items-start gap-3 text-xs">
              <span className="text-muted-foreground w-16 shrink-0">
                {t("share.propose.dialog.targetLabel")}
              </span>
              <span className="flex-1 min-w-0 text-foreground">
                <span className="block truncate font-medium">{targetTitle}</span>
                {targetAuthor && (
                  <span className="block text-muted-foreground">{targetAuthor}</span>
                )}
              </span>
            </div>
            <div className="flex items-start gap-3 text-xs">
              <span className="text-muted-foreground w-16 shrink-0">
                {t("share.propose.dialog.baseLabel")}
              </span>
              <span
                className={`flex-1 min-w-0 leading-relaxed ${
                  stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
                }`}
              >
                {stale
                  ? t("share.propose.dialog.baseStale")
                  : t("share.propose.dialog.baseSame")}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2 leading-relaxed">
            {t("share.propose.dialog.noTarget")}
          </p>
        )}

        <div>
          <label className="text-[11px] text-muted-foreground block mb-1" htmlFor="propose-message">
            {t("share.propose.dialog.messageLabel")}
          </label>
          <input
            id="propose-message"
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("share.propose.dialog.messagePlaceholder")}
            disabled={busy || !target}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none"
          />
        </div>

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
            onClick={handlePropose}
            disabled={busy || !target}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {t("share.sharing")}
              </>
            ) : isUpdate ? (
              t("share.propose.dialog.submitUpdate")
            ) : (
              t("share.propose.dialog.submit")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
