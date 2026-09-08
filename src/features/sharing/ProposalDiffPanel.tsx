// 「変更の提案」の差分パネル（§25 D-3）。全画面表示の右レール「差分」タブの中身。
//
// ここは表示だけ。何が変わったかの判断は純関数（proposal-diff.ts）が済ませてあり、
// このファイルは並べ方と色の割り当てしか持たない。
//
// 見せ方の約束:
//   - 「誰が変えたか」（by）を色で出す。提案者だけが変えたもの＝取り込みの候補が
//     いちばん目に入るようにする。両方が変えたもの（競合）は注意の色にする
//   - 基準版が無いときは色を付けない（分けられないものを分かったように見せない）
//   - 読むだけであることを明記する。取り込みは 8b で作者のノート側に付く
//   - 項目をクリックすると本文プレビューの該当ブロックへ飛ぶ（一時ハイライト）

import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type {
  BlockChange,
  ProposalChangeBy,
  ProposalDiff,
  ProposalDiffSummary,
  TableCellChange,
} from "./proposal-diff";

/** 「誰が変えたか」の色。基準版が無い（unknown）ときは色を付けない */
const BY_CLASS: Record<ProposalChangeBy, string> = {
  theirs: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  mine: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  both: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  unknown: "text-muted-foreground",
};

export type ProposalDiffPanelProps = {
  diff: ProposalDiff | null;
  summary: ProposalDiffSummary | null;
  /** 基準版を挟んだ 3 者比較か */
  hasBase: boolean;
  loading?: boolean;
  /** 元エントリの本文が読めなかった（差分は出せない） */
  error?: string | null;
  /** 元エントリが共有ライブラリに無い */
  targetMissing?: boolean;
  /** 項目のクリックで本文プレビューの該当ブロックへ飛ぶ */
  onJumpToBlock?: (blockId: string) => void;
};

export function ProposalDiffPanel({
  diff,
  summary,
  hasBase,
  loading,
  error,
  targetMissing,
  onJumpToBlock,
}: ProposalDiffPanelProps) {
  const t = useT();

  if (targetMissing) {
    return (
      <PanelMessage>{t("proposal.status.missingHint")}</PanelMessage>
    );
  }
  if (loading) {
    return <PanelMessage>{t("proposal.diff.loading")}</PanelMessage>;
  }
  if (error) {
    return <PanelMessage>{t("proposal.diff.failed", { error })}</PanelMessage>;
  }
  if (!diff) {
    return <PanelMessage>{t("proposal.diff.loading")}</PanelMessage>;
  }

  const changeCount = (summary?.total ?? diff.blocks.length) + (diff.title ? 1 : 0);

  return (
    <div className="flex-1 overflow-auto px-4 py-3 space-y-3" data-testid="proposal-diff-panel">
      {/* 何と何を比べているかを最初に言う（色の意味がここで決まる） */}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {hasBase ? t("proposal.diff.withBase") : t("proposal.diff.noBase")}
      </p>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {t("proposal.diff.readOnly")}
      </p>

      {diff.unsupported.length > 0 && (
        <ul className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
          {diff.unsupported.map((reason) => (
            <li key={reason}>{t(`proposal.diff.unsupported.${reason}`)}</li>
          ))}
        </ul>
      )}

      {changeCount === 0 ? (
        <p className="text-xs text-muted-foreground py-4">{t("proposal.diff.empty")}</p>
      ) : (
        <>
          <div className="text-[11px] font-semibold text-foreground">
            {t("proposal.diff.summary", { count: String(changeCount) })}
          </div>

          {diff.title && (
            <section className="rounded-md border border-border bg-background px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <KindBadge label={t("proposal.diff.titleChanged")} />
                <ByBadge by={diff.title.by} hasBase={hasBase} />
              </div>
              <TextPair
                before={diff.title.before}
                after={diff.title.after}
                base={hasBase ? diff.title.base : undefined}
              />
            </section>
          )}

          <ul className="space-y-1.5">
            {diff.blocks.map((change) => (
              <li key={`${change.kind}-${change.blockId}`}>
                <BlockChangeCard
                  change={change}
                  hasBase={hasBase}
                  onJumpToBlock={onJumpToBlock}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex-1 overflow-auto px-4 py-6 text-xs text-muted-foreground leading-relaxed"
      data-testid="proposal-diff-panel"
    >
      {children}
    </div>
  );
}

function KindBadge({ label }: { label: string }) {
  return (
    <span className="px-1 py-0.5 rounded bg-muted text-[9px] text-muted-foreground shrink-0">
      {label}
    </span>
  );
}

function ByBadge({ by, hasBase }: { by: ProposalChangeBy; hasBase: boolean }) {
  const t = useT();
  // 基準版が無いときは「誰が」を出さない（分けられないものを分かったように見せない）
  if (!hasBase || by === "unknown") return null;
  return (
    <span
      className={cn("px-1 py-0.5 rounded text-[9px] shrink-0", BY_CLASS[by])}
      title={t(`proposal.diff.by.${by}Hint`)}
      data-testid={`proposal-diff-by-${by}`}
    >
      {t(`proposal.diff.by.${by}`)}
    </span>
  );
}

function BlockChangeCard({
  change,
  hasBase,
  onJumpToBlock,
}: {
  change: BlockChange;
  hasBase: boolean;
  onJumpToBlock?: (blockId: string) => void;
}) {
  const t = useT();
  const jumpId = change.kind === "removed" ? change.mineBlockId ?? change.blockId : change.blockId;
  const hasCells = !!change.cells && change.cells.length > 0;
  const clickable = !!onJumpToBlock && change.kind !== "removed";
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background px-3 py-2 space-y-1",
        clickable && "cursor-pointer hover:border-primary/40 transition-colors",
      )}
      onClick={clickable ? () => onJumpToBlock?.(jumpId) : undefined}
      title={clickable ? t("proposal.diff.jumpToBlock") : undefined}
      data-testid={`proposal-diff-block-${change.blockId}`}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <KindBadge label={t(`proposal.diff.kind.${change.kind}`)} />
        <ByBadge by={change.by} hasBase={hasBase} />
        {change.moved && (
          <span className="text-[9px] text-muted-foreground">
            {t("proposal.diff.movedNote")}
          </span>
        )}
        <span className="text-[9px] text-muted-foreground/70 ml-auto">{change.blockType}</span>
      </div>

      {change.propsOnly ? (
        <p className="text-[11px] text-muted-foreground">{t("proposal.diff.propsOnly")}</p>
      ) : change.kind === "moved" ? (
        <TextLine label={t("proposal.diff.after")} value={change.after || change.before} />
      ) : hasCells ? (
        // 表はセル単位の内訳だけを出す。表全体の Markdown も並べると、
        // 同じ内容を 3 回（基準版・元・提案）読ませたうえで内訳が続く形になり、
        // 行が増えるほど「どこが変わったのか」が埋もれる
        null
      ) : (
        <TextPair
          before={change.kind === "added" ? undefined : change.before}
          after={change.kind === "removed" ? undefined : change.after}
          base={hasBase ? change.base : undefined}
        />
      )}

      {hasCells && (
        <ul className="space-y-1 pt-0.5">
          {change.cells!.map((cell, i) => (
            <li key={`${cell.kind}-${i}`}>
              <TableCellRow cell={cell} hasBase={hasBase} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TableCellRow({ cell, hasBase }: { cell: TableCellChange; hasBase: boolean }) {
  const t = useT();
  const row =
    "rowLabel" in cell
      ? cell.rowLabel || t("proposal.diff.rowIndex", { n: String(cell.rowIndex + 1) })
      : "";
  const column =
    "column" in cell
      ? cell.column || t("proposal.diff.columnIndex", { n: String(cell.columnIndex + 1) })
      : "";
  return (
    <div className="pl-2 border-l border-border/70 space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground truncate">
          {t(`proposal.diff.cell.${cell.kind}`, { row, column })}
        </span>
        <ByBadge by={cell.by} hasBase={hasBase} />
      </div>
      {cell.kind === "cellModified" ? (
        <TextPair before={cell.before} after={cell.after} />
      ) : (
        <TextLine
          label={
            cell.kind === "rowRemoved" || cell.kind === "columnRemoved"
              ? t("proposal.diff.before")
              : t("proposal.diff.after")
          }
          value={cell.cells.filter((c) => c).join(" / ")}
        />
      )}
    </div>
  );
}

/** 基準版 → 元のノート → 提案の順に並べる（読む向きを揃える） */
function TextPair({
  base,
  before,
  after,
}: {
  base?: string;
  before?: string;
  after?: string;
}) {
  const t = useT();
  return (
    <div className="space-y-0.5">
      {base !== undefined && <TextLine label={t("proposal.diff.base")} value={base} muted />}
      {before !== undefined && <TextLine label={t("proposal.diff.before")} value={before} />}
      {after !== undefined && <TextLine label={t("proposal.diff.after")} value={after} strong />}
    </div>
  );
}

function TextLine({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="text-muted-foreground/70 w-14 shrink-0">{label}</span>
      <span
        className={cn(
          "flex-1 min-w-0 whitespace-pre-wrap break-words",
          muted ? "text-muted-foreground/70" : strong ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {value || "—"}
      </span>
    </div>
  );
}
