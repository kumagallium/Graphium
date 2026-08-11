// shared:// 引用カード（Phase 2c-2 の表示コンポーネント）。
//
// 設計判断:
// - BlockNote 非依存の純 React コンポーネント。ブロック配線（spec 定義・挿入 UI・
//   hash 照合の実行）は Storybook でこの見た目に合意してから後続で行う（疎結合方針）
// - 検証状態の配色は SharedLibraryView の HashBadge を踏襲
// - 本体は shared 側にあり、カードは参照（id）+ ローカルキャッシュを表示する前提。
//   そのため「offline = キャッシュ表示」「missing = 共有側に無い」という引用固有の
//   状態を Library の HashStatus に加えて持つ
// - minor 更新（同一 id で hash 更新）は自動追従なので状態にしない。major 改訂
//   （superseded_by）だけを「新しい版があります」バナーで知らせる
//
// 設計詳細: docs/internal/team-shared-storage-design.md §5 / §9

import {
  AlertTriangle,
  ArrowUpCircle,
  ArrowUpRight,
  Atom as AtomIcon,
  BookOpen,
  CheckCircle2,
  CloudOff,
  Database,
  FileText,
  LayoutTemplate,
  Lightbulb,
  RefreshCw,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import type { SharedEntryType } from "../../lib/storage/shared";
import { formatDate } from "../../lib/format-datetime";
import { t } from "../../i18n";

/**
 * 引用カードの照合状態。
 * - verified: manifest の hash と本体が一致（正常）
 * - checking: 照合中
 * - mismatch: hash 不一致（破損・意図しない書き換えの可能性）
 * - offline: 共有ストレージに接続できず、ローカルキャッシュを表示中
 * - missing: 共有ストレージにエントリが存在しない（削除・共有解除）
 */
export type CitationStatus =
  | "verified"
  | "checking"
  | "mismatch"
  | "offline"
  | "missing";

export type SharedCitationCardProps = {
  /** 引用先エントリのタイトル（extra.title 相当） */
  title: string;
  entryType: SharedEntryType;
  authorName: string;
  /** ISO 日時（SharedEntry.updated_at） */
  updatedAt: string;
  status: CitationStatus;
  /** メジャー改訂で増える版番号。1 のときは表示しない */
  version?: number;
  /** major 改訂の後継が存在する（superseded_by 相当） */
  hasNewerVersion?: boolean;
  /** data-manifest 用: 引用対象のファイル名とサイズ（表示用整形済み文字列） */
  fileInfo?: { name: string; sizeLabel?: string };
  /** 引用先を開く（Library のピーク表示）。未指定なら開くボタンを出さない */
  onOpen?: () => void;
  /** 新版（後継エントリ）を開く */
  onOpenLatest?: () => void;
};

const TYPE_ICONS: Record<string, LucideIcon> = {
  note: FileText,
  reference: BookOpen,
  "data-manifest": Database,
  template: LayoutTemplate,
  claim: Lightbulb,
  atom: AtomIcon,
  report: ScrollText,
};

function StatusBadge({ status }: { status: CitationStatus }) {
  if (status === "verified") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-700 dark:text-emerald-400"
        title={t("citation.status.verifiedHint")}
      >
        <CheckCircle2 size={11} />
        {t("citation.status.verified")}
      </span>
    );
  }
  if (status === "checking") {
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
        <RefreshCw size={11} className="animate-spin" />
        {t("citation.status.checking")}
      </span>
    );
  }
  if (status === "mismatch") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-destructive"
        title={t("citation.status.mismatchHint")}
      >
        <AlertTriangle size={11} />
        {t("citation.status.mismatch")}
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground"
        title={t("citation.status.offlineHint")}
      >
        <CloudOff size={11} />
        {t("citation.status.offline")}
      </span>
    );
  }
  // missing
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-amber-600">
      <AlertTriangle size={11} />
      {t("citation.status.missing")}
    </span>
  );
}

/**
 * ノート本文中に置かれる shared:// 引用カード。
 * 表示専用 — データ取得・hash 照合・キャッシュ管理は呼び出し側の責務。
 */
export function SharedCitationCard({
  title,
  entryType,
  authorName,
  updatedAt,
  status,
  version,
  hasNewerVersion,
  fileInfo,
  onOpen,
  onOpenLatest,
}: SharedCitationCardProps) {
  const Icon = TYPE_ICONS[entryType] ?? FileText;
  const missing = status === "missing";
  return (
    <div
      className={`group my-1 flex overflow-hidden rounded-md border border-border bg-background transition-colors ${
        missing ? "opacity-70" : "hover:border-primary/50"
      }`}
    >
      {/* 左アクセント: blockquote 風の「引用」メタファ */}
      <div className="w-1 shrink-0 bg-primary/25" />
      <div className="min-w-0 flex-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Icon size={12} />
            {t(`citation.type.${entryType}` as never)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {title}
          </span>
          <StatusBadge status={status} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {authorName && <span className="truncate">{authorName}</span>}
          {authorName && updatedAt && <span className="opacity-50">·</span>}
          {updatedAt && <span>{formatDate(updatedAt)}</span>}
          {version != null && version > 1 && (
            <>
              <span className="opacity-50">·</span>
              <span>v{version}</span>
            </>
          )}
          {fileInfo && (
            <>
              <span className="opacity-50">·</span>
              <span className="truncate">
                {fileInfo.name}
                {fileInfo.sizeLabel ? ` (${fileInfo.sizeLabel})` : ""}
              </span>
            </>
          )}
        </div>
        {hasNewerVersion && !missing && (
          <div className="mt-1.5 flex items-center gap-1.5 rounded bg-info-bg px-2 py-1 text-[11px] text-info">
            <ArrowUpCircle size={12} className="shrink-0" />
            <span className="min-w-0 flex-1">{t("citation.newerVersion")}</span>
            {onOpenLatest && (
              <button
                onClick={onOpenLatest}
                className="shrink-0 font-medium underline-offset-2 hover:underline"
              >
                {t("citation.openLatest")}
              </button>
            )}
          </div>
        )}
        {missing && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("citation.missingHint")}
          </div>
        )}
      </div>
      {onOpen && !missing && (
        <button
          onClick={onOpen}
          className="flex items-center self-stretch border-l border-border px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("citation.open")}
        >
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}
