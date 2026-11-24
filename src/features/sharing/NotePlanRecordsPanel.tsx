// 計画ノートの「行ごとの記録」（ヘッダのバッジ・右レールのアイコン・右パネル）。
//
// なぜ要るか:
//   先生が計画を共有し、学生がそれを複製して行から記録を作り、区切りごとに共有する。
//   共有された記録には「どの計画のどの行か」が添えてある（plan-row-ref.ts）ので、
//   計画を開いた人は、行ごとに誰がいつ記録を出したかを 1 か所で眺められる。
//
// 守っていること:
//   - 保存するものは増やさない。計画の表の行と、共有フォルダの記録の封筒を読み合わせるだけ
//   - 進み具合の状態（済み・担当・期限）は持たない。出すのは「記録がある／まだ無い」という
//     事実と、誰がいつ出したかだけ。記録が無い行を「遅れ」とは言わない
//   - 合う行が見つからない記録も一覧の最後に残す（黙って消さない）
//   - 共有ストアの購読はこの部品の中だけ（提案・コメントのバッジと同じ作法）。
//     ノート本体を共有フォルダの更新で描き直させない
//   - 記録が 1 件も無いうちは、バッジもタブも出さない

import { ClipboardList } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import { formatDate } from "../../lib/format-datetime";
import type { SharedEntry } from "../../lib/storage/shared";
import { getSharedLibrarySnapshot, subscribeSharedLibrary, useSharedLibrary } from "./shared-library-store";
import { collectOperationRowsFromBlocks } from "../network-graph/plan-flow";
import { useTableMetaStore } from "../table-meta/store";
import { readSeenStore, type SharedSeenStore } from "./shared-seen";
import {
  entryUpdatedAt,
  findPlanRecords,
  groupPlanRecordsByRow,
  planRowDisplayName,
  planRowKey,
  type PlanRowRef,
} from "./plan-row-ref";

/** 一覧に出す計画の行（plan-flow の OperationRow から必要な分だけ） */
export type PlanRecordsRow = {
  tableBlockId: string;
  rowId?: string;
  name: string;
  /** 表のキャプション（表が 2 つ以上あるときの見出しに使う） */
  tableCaption?: string;
  /** 本文での表の順（0 始まり） */
  tableIndex?: number;
};

/**
 * 自分以外の記録が、まだ開いていない（new）か、開いたあとに更新された（updated）か。
 *
 * 共有フォルダの一覧（shared-seen.ts の isUpdatedSince）は、一度も開いていないものには印を
 * 付けない（全部に印が付くと読めない）。ここは逆に、開いていない記録を「新着」と出す。
 * 計画を立てた人が知りたいのは「新しく記録が出た」ことそのもので、対象もその計画の行の記録に
 * 限られるため。
 */
export type PlanRecordFreshness = "new" | "updated" | null;

export function planRecordFreshness(
  entry: SharedEntry,
  selfEmail: string | null | undefined,
  seen: SharedSeenStore,
): PlanRecordFreshness {
  if (selfEmail && entry.author?.email === selfEmail) return null;
  const record = seen[entry.id];
  if (!record) return "new";
  return record.hash !== entry.hash ? "updated" : null;
}

/** 計画を指している記録の件数と、そのうちまだ見ていない件数 */
function usePlanRecordCounts(
  planIds: readonly string[],
  selfEmail: string | null | undefined,
  entries?: readonly SharedEntry[],
): { total: number; unseen: number } {
  const shared = useSharedLibrary();
  const source = entries ?? shared.entries;
  const key = planIds.join("|");
  const records = useMemo(
    () => findPlanRecords(planIds, source),
    // planIds は呼び出し側が毎回組み直す配列なので、中身（key）で比べる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, source],
  );
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const seen = readSeenStore();
    setUnseen(records.filter((r) => planRecordFreshness(r.entry, selfEmail, seen) !== null).length);
  }, [records, selfEmail]);
  return { total: records.length, unseen };
}

/**
 * ヘッダに出す「記録 N」。まだ見ていない記録があれば強調する。
 * 記録が 1 件も無いときは何も出さない。
 */
export function NotePlanRecordsBadge({
  planIds,
  selfEmail,
  onClick,
  entries,
}: {
  planIds: readonly string[];
  selfEmail?: string | null;
  onClick?: () => void;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
}) {
  const t = useT();
  const { total, unseen } = usePlanRecordCounts(planIds, selfEmail, entries);
  if (total === 0) return null;
  const label = t("planRecords.countLabel", { count: String(total) });
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="note-plan-records-badge"
      data-tooltip={unseen > 0 ? t("planRecords.unseenHint", { count: String(unseen) }) : t("planRecords.badgeHint")}
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-md shrink-0 inline-flex items-center gap-1 transition-colors",
        unseen > 0 ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:text-foreground",
        onClick ? "cursor-pointer" : "cursor-default",
      )}
    >
      <ClipboardList size={10} />
      {label}
      {unseen > 0 && <span>{t("planRecords.newBadge", { count: String(unseen) })}</span>}
    </button>
  );
}

/** 右レールの「記録」アイコン。まだ見ていない記録があるときだけ小さな点を重ねる */
export function NotePlanRecordsRailIcon({
  planIds,
  selfEmail,
  entries,
}: {
  planIds: readonly string[];
  selfEmail?: string | null;
  entries?: readonly SharedEntry[];
}) {
  const { unseen } = usePlanRecordCounts(planIds, selfEmail, entries);
  return (
    <span className="relative inline-flex items-center justify-center">
      <ClipboardList size={18} />
      {unseen > 0 && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />}
    </span>
  );
}

/**
 * この計画を指している記録の件数。ノート本体がタブの出し入れを決めるのに使う。
 * 返るのは数なので、共有フォルダが更新されても件数が変わらない限りノート本体は描き直されない
 * （useNoteProposalCount と同じ作法）。planIdsKey は planIds を "|" でつないだもの
 */
export function useNotePlanRecordCount(planIdsKey: string): number {
  const getCount = useCallback(
    () => (planIdsKey ? findPlanRecords(planIdsKey.split("|"), getSharedLibrarySnapshot().entries).length : 0),
    [planIdsKey],
  );
  return useSyncExternalStore(subscribeSharedLibrary, getCount, getCount);
}

// ──────────────────────────────────────────────
// 本体
// ──────────────────────────────────────────────

function RecordButton({
  entry,
  freshness,
  isMine,
  secondary,
  onOpen,
}: {
  entry: SharedEntry;
  freshness: PlanRecordFreshness;
  isMine: boolean;
  /** 名前の後ろに添える補足（行名と違う題・表に無い行の名前） */
  secondary?: string;
  onOpen?: (sharedId: string) => void;
}) {
  const t = useT();
  // 封筒は他の人が書く。名前が文字列でないものは「不明」として出す（描画を落とさない）
  const author = typeof entry.author?.name === "string" && entry.author.name ? entry.author.name : t("library.unknownAuthor");
  return (
    <button
      type="button"
      onClick={onOpen ? () => onOpen(entry.id) : undefined}
      disabled={!onOpen}
      data-testid="plan-record-item"
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-md flex items-baseline gap-2 transition-colors",
        onOpen ? "hover:bg-muted cursor-pointer" : "cursor-default",
      )}
    >
      {/* 誰の記録かが先。題の補足が長くても、名前は削らない */}
      <span className={cn("text-xs truncate shrink-0 max-w-[60%]", freshness ? "font-semibold text-foreground" : "text-foreground")}>
        {author}
        {isMine && <span className="text-muted-foreground font-normal">{t("planRecords.mine")}</span>}
      </span>
      {secondary && <span className="text-[11px] text-muted-foreground truncate min-w-0 flex-1">{secondary}</span>}
      <span className="ml-auto shrink-0 inline-flex items-baseline gap-1.5">
        {freshness && (
          <span className="text-[10px] px-1 rounded bg-primary/15 text-primary font-semibold">
            {freshness === "new" ? t("planRecords.fresh.new") : t("comment.updatedBadge")}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground tabular-nums">{formatDate(entryUpdatedAt(entry))}</span>
      </span>
    </button>
  );
}

export type NotePlanRecordsPanelProps = {
  /** この計画ノートを指す共有エントリの id（planSharedIdsOf） */
  planIds: readonly string[];
  /** 計画の表の行（本文の順）。エディタのいまの中身から呼び出し側が集める */
  rows: readonly PlanRecordsRow[];
  /** 自分のメールアドレス（自分の記録に「新着」を付けない） */
  selfEmail?: string | null;
  /** 記録を開く（共有エントリを全画面で開く） */
  onOpenEntry?: (sharedId: string) => void;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
  /** DI: 既読の控え（既定は localStorage）。Storybook / テスト用 */
  seen?: SharedSeenStore;
};

export function NotePlanRecordsPanel({
  planIds,
  rows,
  selfEmail,
  onOpenEntry,
  entries,
  seen: seenOverride,
}: NotePlanRecordsPanelProps) {
  const t = useT();
  const shared = useSharedLibrary();
  const source = entries ?? shared.entries;
  const { byRow, unmatched } = useMemo(
    () => groupPlanRecordsByRow(planIds, rows, source),
    [planIds, rows, source],
  );
  // 開いた時点の控えで「新着・更新あり」を出す。開いている間に読み直すと、いま開いて
  // 戻ってきた記録の印がどれだったか分からなくなるので、一覧が変わったときだけ読み直す
  const seen = useMemo(
    () => seenOverride ?? readSeenStore(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seenOverride, source],
  );

  // 表が 2 つ以上あるときだけ、表ごとの見出しを出す
  const tableOrder = useMemo(() => {
    const ids: string[] = [];
    for (const row of rows) if (!ids.includes(row.tableBlockId)) ids.push(row.tableBlockId);
    return ids;
  }, [rows]);
  // 同じ名前の行（行の id がまだ無い古い表）や、保存前で同じ id を持つ行は、キーが重なる。
  // 記録は先に出た行にだけ並べる（同じ記録を 2 行に出さない・行数も二重に数えない）
  const recordsOfRow = useMemo(() => {
    const taken = new Set<string>();
    return rows.map((row) => {
      const key = planRowKey(row);
      if (taken.has(key)) return [] as SharedEntry[];
      taken.add(key);
      return byRow.get(key) ?? [];
    });
  }, [rows, byRow]);
  const withRecords = recordsOfRow.filter((list) => list.length > 0).length;

  const isMine = (entry: SharedEntry) => !!selfEmail && entry.author?.email === selfEmail;

  return (
    <div className="h-full overflow-auto px-3 py-3 space-y-3" data-testid="note-plan-records-panel">
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("planRecords.summary", { withRecords: String(withRecords), total: String(rows.length) })}
      </p>

      {tableOrder.map((tableBlockId) => {
        const tableRows = rows
          .map((row, index) => ({ row, records: recordsOfRow[index] }))
          .filter(({ row }) => row.tableBlockId === tableBlockId);
        const first = tableRows[0]?.row;
        const caption =
          first?.tableCaption?.trim() ||
          t("planRecords.tableFallback", { n: String((first?.tableIndex ?? tableOrder.indexOf(tableBlockId)) + 1) });
        return (
          <section key={tableBlockId} className="space-y-1.5">
            {tableOrder.length > 1 && (
              <h3 className="text-[11px] font-semibold text-muted-foreground tracking-wide">{caption}</h3>
            )}
            <ul className="space-y-1.5">
              {tableRows.map(({ row, records }, i) => {
                const rowName = planRowDisplayName(row.name);
                return (
                  <li
                    key={`${planRowKey(row)}:${i}`}
                    className="rounded-lg border border-border bg-background"
                    data-testid="plan-records-row"
                  >
                    <div className="px-2 pt-1.5 pb-1 flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-foreground truncate min-w-0">{rowName}</span>
                      {records.length === 0 && (
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {t("planRecords.none")}
                        </span>
                      )}
                    </div>
                    {records.length > 0 && (
                      <div className="pb-1">
                        {records.map((entry) => {
                          const title = (entry.extra as { title?: unknown } | undefined)?.title;
                          // 題が行の名前と違うときだけ添える（行から作った記録はたいてい同じ題）
                          const secondary =
                            typeof title === "string" && title.trim() && title.trim() !== rowName ? title.trim() : undefined;
                          return (
                            <RecordButton
                              key={entry.id}
                              entry={entry}
                              freshness={planRecordFreshness(entry, selfEmail, seen)}
                              isMine={isMine(entry)}
                              secondary={secondary}
                              onOpen={onOpenEntry}
                            />
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {unmatched.length > 0 && (
        <section className="space-y-1.5" data-testid="plan-records-unmatched">
          <h3
            className="text-[11px] font-semibold text-muted-foreground tracking-wide"
            data-tooltip={t("planRecords.unmatchedHint")}
          >
            {t("planRecords.unmatched", { count: String(unmatched.length) })}
          </h3>
          <div className="rounded-lg border border-border bg-background py-1">
            {unmatched.map(({ entry, ref }: { entry: SharedEntry; ref: PlanRowRef }) => (
              <RecordButton
                key={entry.id}
                entry={entry}
                freshness={planRecordFreshness(entry, selfEmail, seen)}
                isMine={isMine(entry)}
                secondary={ref.rowName}
                onOpen={onOpenEntry}
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">{t("planRecords.footnote")}</p>
    </div>
  );
}

/**
 * エディタのいまの表から行を集めて一覧に渡す（右パネル用）。
 * 行を足す・名前を変えると、その場で一覧も変わる。
 */
export function NotePlanRecordsLivePanel({
  editorRef,
  ...rest
}: Omit<NotePlanRecordsPanelProps, "rows"> & { editorRef: React.RefObject<any> }) {
  const tableMetaStore = useTableMetaStore();
  // 本文（ブロック）が変わった合図。表の注釈の変化は tableMetaStore.metas の参照で拾う
  const [docVersion, setDocVersion] = useState(0);
  useEffect(() => {
    const editor = editorRef.current;
    // 最初の描画でエディタがまだ付いていなかった場合に備えて、付いたあとに 1 度集め直す
    setDocVersion((n) => n + 1);
    // 打鍵ごとに集め直さない（表の編集が落ち着いてから 1 回）
    let timer = 0;
    const unsubscribe = editor?.onChange?.(() => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setDocVersion((n) => n + 1), 300);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [editorRef]);
  const rows = useMemo(
    () => collectOperationRowsFromBlocks(editorRef.current?.document ?? [], tableMetaStore.getSnapshot()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docVersion, tableMetaStore.metas, editorRef],
  );
  return <NotePlanRecordsPanel {...rest} rows={rows} />;
}
