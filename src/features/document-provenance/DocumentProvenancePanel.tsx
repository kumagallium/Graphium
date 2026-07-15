// ドキュメント来歴パネル
// 手動で残した「版」と自動保存の「リビジョン」を 1 本のタイムラインに統合表示する。
// 版が主役（primary で強調・全文を開ける）、リビジョンは参考（差分ハイライト）。

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { DocumentProvenance, RevisionSummary, RevisionEntity, BlockContentDiff, EditActivity, EditAgent } from "./types";
import { useT } from "../../i18n";
import { activityTypeLabelKey } from "./activity-label";
import type { SnapshotMeta } from "../version-snapshots/types";
import { SnapshotRow, formatDateTime } from "../version-snapshots/SnapshotRow";

/** 取り込みソース（EditActivity.used）の表示用解決結果 */
export type ResolvedRevisionSource = {
  /** 表示ラベル（ノートタイトル / 外部ソースのキー） */
  label: string;
  /** ソース種別（note / wiki / pdf / url / document / chat） */
  kind: string;
  /** SidePeek 等で開ける ID（開けないソースは undefined） */
  openId?: string;
};

type Props = {
  provenance: DocumentProvenance | null | undefined;
  /** 手動で残した版（新しい順でなくてよい。内部で時系列ソートする） */
  snapshots?: SnapshotMeta[];
  /** 中央サイドピークで開いている版の ID（選択強調用） */
  selectedSnapshotId?: string | null;
  /** リビジョン選択時のコールバック（ブロック ID 一覧） */
  onHighlightBlocks?: (blockIds: string[]) => void;
  /** EditActivity.used の ID を表示用に解決する（未指定なら生 ID をそのまま表示） */
  resolveSource?: (id: string) => ResolvedRevisionSource;
  /** ソースチップのクリックで開く（resolveSource が openId を返したチップのみ有効） */
  onOpenSource?: (openId: string) => void;
  /** 版をサイドピークで開く */
  onOpenSnapshot?: (snapshotId: string) => void;
  /** 版を下敷きに新ノートを派生する */
  onDeriveSnapshot?: (snapshotId: string) => void;
  /** 版のラベルを変更する（空文字は「未命名に戻す」） */
  onRenameSnapshot?: (snapshotId: string, label: string) => void;
  /** 版を削除する */
  onDeleteSnapshot?: (snapshotId: string) => void;
};

/** テキストを省略表示（長すぎる場合） */
function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/** 変更サマリを人間が読める形式に変換 */
function formatSummary(summary: RevisionSummary, t: ReturnType<typeof useT>): string[] {
  const parts: string[] = [];
  if (summary.blocksAdded > 0) parts.push(`+${summary.blocksAdded} ${t("history.blocks")}`);
  if (summary.blocksRemoved > 0) parts.push(`-${summary.blocksRemoved} ${t("history.blocks")}`);
  if (summary.blocksModified > 0) parts.push(`~${summary.blocksModified} ${t("history.blocks")}`);
  if (summary.labelsChanged.length > 0) parts.push(`${t("history.labels")}: ${summary.labelsChanged.join(", ")}`);
  if (summary.provLinksAdded > 0) parts.push(`+${summary.provLinksAdded} prov links`);
  if (summary.provLinksRemoved > 0) parts.push(`-${summary.provLinksRemoved} prov links`);
  if (summary.knowledgeLinksAdded > 0) parts.push(`+${summary.knowledgeLinksAdded} knowledge links`);
  if (summary.knowledgeLinksRemoved > 0) parts.push(`-${summary.knowledgeLinksRemoved} knowledge links`);
  return parts;
}

/** 操作種別の表示ラベル（キー対応は activity-label.ts に一元化。lineage/グラフと共用） */
function activityTypeLabel(type: string, t: ReturnType<typeof useT>): string {
  const key = activityTypeLabelKey(type);
  return key ? t(key as never) : type;
}

/** RevisionSummary から変更ブロック ID を集約 */
function getChangedBlockIds(summary: RevisionSummary): string[] {
  return [
    ...(summary.addedBlockIds ?? []),
    ...(summary.modifiedBlockIds ?? []),
  ];
}

/** diff type のアイコン・色 */
function diffTypeStyle(type: BlockContentDiff["type"]) {
  switch (type) {
    case "add": return { icon: "+", color: "text-green-600 dark:text-green-400" };
    case "remove": return { icon: "−", color: "text-red-600 dark:text-red-400" };
    case "modify": return { icon: "~", color: "text-blue-600 dark:text-blue-400" };
  }
}

/** テキスト差分の展開表示 */
function ContentDiffView({ diffs }: { diffs: BlockContentDiff[] }) {
  return (
    <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5">
      {diffs.map((diff, i) => {
        const { icon, color } = diffTypeStyle(diff.type);
        return (
          <div key={i} className="text-xs leading-relaxed">
            <div className="flex items-start gap-1">
              <span className={`font-bold ${color} shrink-0 w-3 text-center`}>{icon}</span>
              <span className="font-mono text-muted-foreground/60 shrink-0">
                {diff.blockId.slice(0, 8)}
              </span>
              <div className="min-w-0 flex-1">
                {diff.type === "modify" && diff.before && (
                  <div className="text-red-600/70 dark:text-red-400/70 line-through break-all">
                    {truncate(diff.before)}
                  </div>
                )}
                {(diff.type === "add" || diff.type === "modify") && diff.after && (
                  <div className={`${diff.type === "add" ? "text-green-600/70 dark:text-green-400/70" : "text-foreground/70"} break-all`}>
                    {truncate(diff.after)}
                  </div>
                )}
                {diff.type === "remove" && diff.before && (
                  <div className="text-red-600/70 dark:text-red-400/70 line-through break-all">
                    {truncate(diff.before)}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 自動保存リビジョン 1 件のカード（参考＝控えめ表示） */
function RevisionCard({
  rev,
  activity,
  agent,
  isSelected,
  onClick,
  resolveSource,
  onOpenSource,
  t,
}: {
  rev: RevisionEntity;
  activity: EditActivity | undefined;
  agent: EditAgent | null;
  isSelected: boolean;
  onClick: () => void;
  resolveSource?: (id: string) => ResolvedRevisionSource;
  onOpenSource?: (openId: string) => void;
  t: ReturnType<typeof useT>;
}) {
  const summaryParts = formatSummary(rev.summary, t);
  const hasBlocks = getChangedBlockIds(rev.summary).length > 0;
  const hasDiffs = rev.summary.contentDiff && rev.summary.contentDiff.length > 0;
  const clickable = hasBlocks || hasDiffs;

  return (
    <div
      onClick={() => clickable && onClick()}
      className={[
        "border rounded px-2.5 py-1.5 text-xs space-y-0.5 transition-colors",
        isSelected ? "border-primary bg-primary/5" : "border-border bg-background",
        clickable ? "cursor-pointer hover:border-primary/50" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-muted-foreground">{rev.id}</span>
        <span className="text-muted-foreground">{formatDateTime(rev.savedAt)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {activity && (
          <span className="px-1 py-0.5 rounded text-xs font-semibold bg-primary/10 text-primary">
            {activityTypeLabel(activity.type, t)}
          </span>
        )}
        {agent && (() => {
          // 人間エージェントは AuthorIdentity > email > label の順で表示する
          const isHuman = agent.type === "human";
          const displayName = isHuman ? (agent.author?.name ?? agent.label) : agent.label;
          const subText = isHuman ? (agent.author?.email ?? agent.email) : agent.email;
          return (
            <span className="text-muted-foreground">
              {agent.type === "ai" ? "AI" : ""} {displayName}
              {subText && <span className="ml-1 text-muted-foreground/60">({subText})</span>}
            </span>
          );
        })()}
      </div>
      {/* 成長タイムライン: この操作が取り込んだソース（EditActivity.used） */}
      {activity && activity.used && activity.used.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <span className="text-xs text-muted-foreground/70 shrink-0">{t("history.sources")}</span>
          {activity.used.map((srcId) => {
            const resolved = resolveSource?.(srcId) ?? { label: srcId, kind: "note" };
            const clickableChip = Boolean(resolved.openId && onOpenSource);
            const chipClass =
              "max-w-[160px] truncate rounded border border-border/70 bg-muted/40 px-1 py-px text-xs text-muted-foreground";
            return clickableChip ? (
              <button
                key={srcId}
                type="button"
                title={`${resolved.kind}: ${srcId}`}
                className={`${chipClass} cursor-pointer hover:border-primary/60 hover:text-foreground`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSource!(resolved.openId!);
                }}
              >
                {resolved.label}
              </button>
            ) : (
              <span key={srcId} title={`${resolved.kind}: ${srcId}`} className={chipClass}>
                {resolved.label}
              </span>
            );
          })}
        </div>
      )}
      {summaryParts.length > 0 && (
        <div className="text-muted-foreground">{summaryParts.join(" | ")}</div>
      )}
      {/* テキスト差分の展開表示（選択時） */}
      {isSelected && hasDiffs && <ContentDiffView diffs={rev.summary.contentDiff!} />}
    </div>
  );
}

type TimelineItem =
  | { kind: "snap"; at: string; snap: SnapshotMeta }
  | { kind: "rev"; at: string; rev: RevisionEntity }
  /** 連続する自動リビジョンの集約（版が主役のとき、編集ログは畳む） */
  | { kind: "revGroup"; at: string; revs: RevisionEntity[] };

export function DocumentProvenancePanel({
  provenance,
  snapshots,
  selectedSnapshotId,
  onHighlightBlocks,
  resolveSource,
  onOpenSource,
  onOpenSnapshot,
  onDeriveSnapshot,
  onRenameSnapshot,
  onDeleteSnapshot,
}: Props) {
  const t = useT();
  const [selectedRevId, setSelectedRevId] = useState<string | null>(null);
  // 折りたたまれた「編集 N 回」グループのうち、開いているもの（key = 先頭 rev の id）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const revisions = provenance?.revisions ?? [];
  const snaps = snapshots ?? [];

  if (revisions.length === 0 && snaps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        {t("history.empty")}
      </div>
    );
  }

  const activityMap = new Map((provenance?.activities ?? []).map((a) => [a.id, a]));
  const agentMap = new Map((provenance?.agents ?? []).map((a) => [a.id, a]));

  // 版とリビジョンを時系列（新しい順）に統合
  const flat: TimelineItem[] = [
    ...revisions.map((rev): TimelineItem => ({ kind: "rev", at: rev.savedAt, rev })),
    ...snaps.map((snap): TimelineItem => ({ kind: "snap", at: snap.savedAt, snap })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // 版が 1 つ以上あるときは版を主役にし、間の連続リビジョンを「編集 N 回」に畳む。
  // 版を使っていないノートは従来どおり全リビジョンを並べる（体験を変えない）。
  const items: TimelineItem[] = [];
  if (snaps.length === 0) {
    items.push(...flat);
  } else {
    for (const it of flat) {
      const last = items[items.length - 1];
      if (it.kind === "rev" && last?.kind === "revGroup") {
        last.revs.push(it.rev);
      } else if (it.kind === "rev") {
        items.push({ kind: "revGroup", at: it.at, revs: [it.rev] });
      } else {
        items.push(it);
      }
    }
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const rowLabels = {
    unnamed: t("version.unnamed"),
    open: t("version.open"),
    derive: t("version.derive"),
    rename: t("version.rename"),
    delete: t("version.delete"),
  };

  const handleRevisionClick = (revId: string, summary: RevisionSummary) => {
    if (selectedRevId === revId) {
      setSelectedRevId(null);
      onHighlightBlocks?.([]);
    } else {
      setSelectedRevId(revId);
      onHighlightBlocks?.(getChangedBlockIds(summary));
    }
  };

  return (
    <div className="p-3 space-y-1">
      <div className="text-xs text-muted-foreground mb-2">
        {snaps.length > 0 && (
          <span className="text-primary font-medium">{snaps.length} {t("version.count")} · </span>
        )}
        {revisions.length} {t("history.revisions")}
      </div>
      {items.map((item) => {
        if (item.kind === "snap") {
          return (
            <SnapshotRow
              key={`snap-${item.snap.id}`}
              version={item.snap.version}
              label={item.snap.label}
              savedAt={item.snap.savedAt}
              selected={selectedSnapshotId === item.snap.id}
              labels={rowLabels}
              onOpen={onOpenSnapshot ? () => onOpenSnapshot(item.snap.id) : undefined}
              onDerive={onDeriveSnapshot ? () => onDeriveSnapshot(item.snap.id) : undefined}
              onRename={onRenameSnapshot ? (label: string) => onRenameSnapshot(item.snap.id, label) : undefined}
              onDelete={onDeleteSnapshot ? () => onDeleteSnapshot(item.snap.id) : undefined}
            />
          );
        }
        const renderRev = (rev: RevisionEntity) => (
          <RevisionCard
            key={`rev-${rev.id}`}
            rev={rev}
            activity={activityMap.get(rev.wasGeneratedBy)}
            agent={(() => {
              const a = activityMap.get(rev.wasGeneratedBy);
              return a ? agentMap.get(a.wasAssociatedWith) ?? null : null;
            })()}
            isSelected={selectedRevId === rev.id}
            onClick={() => handleRevisionClick(rev.id, rev.summary)}
            resolveSource={resolveSource}
            onOpenSource={onOpenSource}
            t={t}
          />
        );
        if (item.kind === "revGroup") {
          const groupKey = item.revs[0].id;
          const expanded = expandedGroups.has(groupKey);
          return (
            <div key={`grp-${groupKey}`} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleGroup(groupKey)}
                className="flex w-full items-center gap-1.5 rounded border border-transparent px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{t("version.editGroup", { count: String(item.revs.length) })}</span>
                <span className="ml-auto">{formatDateTime(item.at)}</span>
              </button>
              {expanded && item.revs.map(renderRev)}
            </div>
          );
        }
        return renderRev(item.rev);
      })}
    </div>
  );
}
