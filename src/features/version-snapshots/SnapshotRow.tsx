// 版タイムラインの 1 行（手動で残した版）。
//
// 自動改訂（DocumentProvenancePanel の地味なカード）と視覚階層を付けるため、
// 版＝主役として primary グリーンで強調する（design.md「主役/補助/参考」）。
// i18n 非依存: 表示文字列は labels prop で受け取り、Storybook / テストで provider 不要にする。

import { useState } from "react";
import { Pin, Eye, GitBranch, Pencil, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";

/** 日時を YYYY-MM-DD HH:MM で表示（design.md の日付キャプション形式に揃える） */
export function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type SnapshotRowLabels = {
  unnamed: string;
  open: string;
  derive: string;
  rename: string;
  delete: string;
};

type Props = {
  version: number;
  label?: string;
  savedAt: string;
  /** 選択中（中央サイドピークで開いている版）なら枠を強調 */
  selected?: boolean;
  onOpen?: () => void;
  onDerive?: () => void;
  /** 新しいラベルを確定したときに呼ぶ（空文字は「未命名に戻す」） */
  onRename?: (newLabel: string) => void;
  onDelete?: () => void;
  labels: SnapshotRowLabels;
};

export function SnapshotRow({
  version,
  label,
  savedAt,
  selected,
  onOpen,
  onDerive,
  onRename,
  onDelete,
  labels,
}: Props) {
  // インラインリネーム。IME（日本語入力）の変換確定 Enter を確定と誤認しないよう
  // useImeEnterGuard を必ず通す（WKWebView のイベント順対応）。
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const startEdit = () => {
    setDraft(label ?? "");
    setEditing(true);
  };
  const commitEdit = () => {
    setEditing(false);
    if ((label ?? "") !== draft.trim()) onRename?.(draft);
  };

  return (
    <div
      className={[
        "rounded-lg border px-2.5 py-2 text-xs transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-primary/40 bg-primary/5 hover:border-primary/70",
        onOpen ? "cursor-pointer" : "",
      ].join(" ")}
      onClick={onOpen}
    >
      <div className="flex items-center gap-1.5">
        <Pin size={13} className="shrink-0 text-primary" aria-hidden />
        <span className="rounded-full bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground">
          v{version}
        </span>
        {editing ? (
          <input
            autoFocus
            value={draft}
            placeholder={labels.unnamed}
            onChange={(e) => setDraft(e.target.value)}
            {...compositionHandlers}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isImeKey(e)) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            onBlur={commitEdit}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-primary/50 bg-background px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary"
          />
        ) : (
          <span className={label ? "font-medium text-foreground" : "text-muted-foreground"}>
            {label ?? labels.unnamed}
          </span>
        )}
        {!editing && (
          <span className="ml-auto shrink-0 text-muted-foreground">{formatDateTime(savedAt)}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-0.5">
        <RowAction icon={<Eye size={14} />} title={labels.open} onClick={onOpen} />
        <RowAction icon={<GitBranch size={14} />} title={labels.derive} onClick={onDerive} />
        <RowAction
          icon={<Pencil size={14} />}
          title={labels.rename}
          onClick={onRename ? startEdit : undefined}
        />
        {/* 削除は誤操作防止のため右端に隔離（design.md ServerCard 流） */}
        <RowAction
          icon={<Trash2 size={14} />}
          title={labels.delete}
          onClick={onDelete}
          danger
          className="ml-auto"
        />
      </div>
    </div>
  );
}

/** 版行のアイコンアクション（クリックは行の onOpen に伝播させない） */
function RowAction({
  icon,
  title,
  onClick,
  danger,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  onClick?: () => void;
  danger?: boolean;
  className?: string;
}) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={[
        "flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary transition-colors",
        danger ? "hover:bg-status-error-bg hover:text-status-error" : "hover:bg-surface-hover hover:text-foreground",
        className ?? "",
      ].join(" ")}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </button>
  );
}
