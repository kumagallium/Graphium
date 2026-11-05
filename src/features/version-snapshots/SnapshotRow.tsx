// 版タイムラインの 1 行（手動で残した版）。
//
// 自動改訂（DocumentProvenancePanel の地味なカード）と視覚階層を付けるため、
// 版＝主役として primary グリーンで強調する（design.md「主役/補助/参考」）。
// i18n 非依存: 表示文字列は labels prop で受け取り、Storybook / テストで provider 不要にする。

import { useState } from "react";
import { Pin, Eye, GitBranch, Pencil, Trash2, RotateCcw, Bot, ListTree, Lock, ShieldCheck, Download } from "lucide-react";
import type { SnapshotOrigin } from "./types";
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
  restore: string;
  rename: string;
  delete: string;
  /** origin が "ai_rewrite" の版に付ける小さな印（例: "AI書き換え前"） */
  aiRewriteBadge: string;
  /** origin が "frame_backfill" の版に付ける小さな印（例: "補完前"） */
  frameBackfillBadge: string;
  /** 封印の操作・表示（封印に対応していない画面では省略できる） */
  seal?: string;
  sealedBadge?: string;
  verifySeal?: string;
  exportSeal?: string;
  /** "{time} より前に存在したことを証明" の形。{time} に日時が入る */
  provenBefore?: string;
  /** 確定待ちの証明がある。{count} に件数が入る */
  proofWaiting?: string;
  /** 時刻の証明がまだ 1 件も無い */
  proofNone?: string;
  /** 封印ファイルが見つからない・合わない */
  sealProblem?: string;
};

/** 封印した版の表示用の要約（受領書を読んで呼び出し側が作る） */
export type SnapshotRowSeal = {
  /** 確定した証明のうち、いちばん早い証明時刻（ISO）。無ければ undefined */
  provenAt?: string;
  /** 確定待ちの証明の件数 */
  pending: number;
  /** 封印ファイルが見つからない・ハッシュが合わない */
  problem?: boolean;
};

type Props = {
  version: number;
  label?: string;
  savedAt: string;
  /** この版の出どころ。"ai_rewrite" なら AI が書き換える直前、"frame_backfill" なら構造の補完前に自動で残した版 */
  origin?: SnapshotOrigin;
  /** 選択中（中央サイドピークで開いている版）なら枠を強調 */
  selected?: boolean;
  onOpen?: () => void;
  onDerive?: () => void;
  /** この版の内容で現在のドキュメントを上書きする（スキル等、復元が自然な文書向け） */
  onRestore?: () => void;
  /** 新しいラベルを確定したときに呼ぶ（空文字は「未命名に戻す」） */
  onRename?: (newLabel: string) => void;
  onDelete?: () => void;
  /** 封印した版なら要約。封印した版は改名・削除の手段を出さない */
  seal?: SnapshotRowSeal;
  /** 封印する（人が残した版で、まだ封印していないときだけ渡す） */
  onSeal?: () => void;
  /** 封印をアプリ内で検証する */
  onVerifySeal?: () => void;
  /** 証拠を書き出す */
  onExportSeal?: () => void;
  labels: SnapshotRowLabels;
};

export function SnapshotRow({
  version,
  label,
  savedAt,
  origin,
  selected,
  onOpen,
  onDerive,
  onRestore,
  onRename,
  onDelete,
  seal,
  onSeal,
  onVerifySeal,
  onExportSeal,
  labels,
}: Props) {
  const sealed = seal !== undefined;
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
        {!editing && origin === "ai_rewrite" && (
          <span
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground"
          >
            <Bot size={11} aria-hidden />
            {labels.aiRewriteBadge}
          </span>
        )}
        {!editing && origin === "frame_backfill" && (
          <span
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground"
          >
            <ListTree size={11} aria-hidden />
            {labels.frameBackfillBadge}
          </span>
        )}
        {!editing && sealed && labels.sealedBadge && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-primary">
            <Lock size={11} aria-hidden />
            {labels.sealedBadge}
          </span>
        )}
        {!editing && (
          <span className="ml-auto shrink-0 text-muted-foreground">{formatDateTime(savedAt)}</span>
        )}
      </div>
      {sealed && <SealStatusLine seal={seal} labels={labels} />}
      <div className="mt-1.5 flex items-center gap-0.5">
        <RowAction icon={<Eye size={14} />} title={labels.open} onClick={onOpen} />
        <RowAction icon={<GitBranch size={14} />} title={labels.derive} onClick={onDerive} />
        <RowAction icon={<RotateCcw size={14} />} title={labels.restore} onClick={onRestore} />
        {/* 封印した版は封印ファイルの label と食い違わないよう改名させない */}
        <RowAction
          icon={<Pencil size={14} />}
          title={labels.rename}
          onClick={onRename && !sealed ? startEdit : undefined}
        />
        {!sealed && labels.seal && (
          <RowAction icon={<Lock size={14} />} title={labels.seal} onClick={onSeal} />
        )}
        {sealed && labels.verifySeal && (
          <RowAction icon={<ShieldCheck size={14} />} title={labels.verifySeal} onClick={onVerifySeal} />
        )}
        {sealed && labels.exportSeal && (
          <RowAction icon={<Download size={14} />} title={labels.exportSeal} onClick={onExportSeal} />
        )}
        {/* 削除は誤操作防止のため右端に隔離（design.md ServerCard 流）。封印した版には出さない */}
        <RowAction
          icon={<Trash2 size={14} />}
          title={labels.delete}
          onClick={sealed ? undefined : onDelete}
          danger
          className="ml-auto"
        />
      </div>
    </div>
  );
}

/** 封印した版の状態の 1 行（参考情報なので小さく・控えめに） */
function SealStatusLine({ seal, labels }: { seal: SnapshotRowSeal; labels: SnapshotRowLabels }) {
  const parts: string[] = [];
  if (seal.problem && labels.sealProblem) {
    return <div className="mt-1 text-status-error">{labels.sealProblem}</div>;
  }
  if (seal.provenAt && labels.provenBefore) {
    parts.push(labels.provenBefore.replace("{time}", formatDateTime(seal.provenAt)));
  }
  if (seal.pending > 0 && labels.proofWaiting) {
    parts.push(labels.proofWaiting.replace("{count}", String(seal.pending)));
  }
  if (parts.length === 0 && labels.proofNone) parts.push(labels.proofNone);
  if (parts.length === 0) return null;
  return <div className="mt-1 text-muted-foreground">{parts.join(" · ")}</div>;
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
      data-tooltip={title}
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
