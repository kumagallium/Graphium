// ──────────────────────────────────────────────
// プロセス一覧
//
// 各ノートが記述している手順の流れを、ノートを跨いで並べて見る。
// 素材一覧・ラベル一覧と同じ棚に並ぶが、性質はひとつ違う:
//
//   プロセスはノート本文から導出されるもので、ここでは編集できない（P-3）。
//   素材は実体が外にあって編集できるので、並べると取り違えられやすい。
//   そのため行は「開く」導線に徹し、読み取り専用であることを明示する。
//
// 表示するデータは process-index（投影キャッシュ）から来る。ここで
// グラフを組み直さない — 組み直すと右パネルと構造が食い違う（P-1）。
//
// 右のプレビューはノート編集時の手順フローと同じ StepFlowView を使う。
// 別の描き方をすると「同じものを見ている」感覚が切れるため、コールバックを
// 渡さないことで読み取り専用にするだけに留める。
// ──────────────────────────────────────────────

import { useMemo, useState } from "react";
import { GitBranch, ArrowRight, CornerDownRight, ExternalLink } from "lucide-react";
import { useT } from "../../i18n";
import type { ProcessIndex, ProcessIndexEntry } from "./process-index";
import { StepFlowView } from "./step-flow-view";

export type ProcessGalleryViewProps = {
  processIndex: ProcessIndex | null;
  onBack: () => void;
  onNavigateNote: (noteId: string) => void;
};

type SortKey = "stepCount" | "modifiedAt" | "title";

/** 行に出す工程の先頭いくつか。多いノートで行が伸びないように抑える */
const PREVIEW_STEPS = 3;

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function ProcessGalleryView({
  processIndex,
  onBack,
  onNavigateNote,
}: ProcessGalleryViewProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const processes = processIndex?.processes ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // 工程名でも引けるようにする — 「焼成をやったノート」の探し方はこれが自然
    const matched = q
      ? processes.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.graph.steps.some((s) => s.name.toLowerCase().includes(q)),
        )
      : processes;

    return [...matched].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "stepCount") cmp = a.summary.stepCount - b.summary.stepCount;
      else if (sortKey === "modifiedAt")
        cmp = new Date(a.sourceModifiedAt).getTime() - new Date(b.sourceModifiedAt).getTime();
      else cmp = a.title.localeCompare(b.title);
      return sortAsc ? cmp : -cmp;
    });
  }, [processes, searchQuery, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((asc) => !asc);
        return key;
      }
      // 件数・日付は多い/新しい順、名前は五十音順が既定
      setSortAsc(key === "title");
      return key;
    });
  };

  const sortButton = (key: SortKey, label: string) => (
    <button
      onClick={() => handleSort(key)}
      className={`text-[11px] px-2 py-1 rounded transition-colors ${
        sortKey === key
          ? "bg-primary/10 text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {sortKey === key && (sortAsc ? " ↑" : " ↓")}
    </button>
  );

  // 右が空のままだと何を見せるペインなのか伝わらないので、明示選択が無ければ先頭を見せる。
  // effect で選択 state を書き戻さない — 絞り込みのたびに選択が動いて読めなくなる。
  const selected =
    filtered.find((entry) => entry.noteId === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="flex-1 flex overflow-hidden bg-background">
      {/* 左: 一覧 */}
      <div className="flex flex-col overflow-hidden shrink-0" style={{ width: "44%", minWidth: 340 }}>
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.back")}
          </button>
          <span className="text-sm font-semibold text-foreground">{t("process.title")}</span>
          <span className="text-xs text-muted-foreground">
            {t("process.count", { n: String(filtered.length) })}
          </span>
        </div>

        <div className="px-6 py-2 border-b border-border flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("process.search")}
            className="w-full max-w-xs text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
          <div className="flex items-center gap-1 ml-auto">
            {sortButton("stepCount", t("process.sortSteps"))}
            {sortButton("modifiedAt", t("asset.sortDate"))}
            {sortButton("title", t("process.sortTitle"))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-6 py-10 text-center text-xs text-muted-foreground">
              {processes.length === 0 ? t("process.empty") : t("process.noMatch")}
            </div>
          )}
          {filtered.map((process) => (
            <ProcessRow
              key={process.noteId}
              process={process}
              selected={process.noteId === selected?.noteId}
              onSelect={() => setSelectedId(process.noteId)}
            />
          ))}
        </div>
      </div>

      {/* 右: 手順フローのプレビュー（ノート編集時と同じ描画） */}
      <div className="flex-1 flex flex-col min-w-0 border-l border-border">
        {selected ? (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <span className="text-xs font-medium text-foreground truncate">{selected.title}</span>
              <span className="text-[10px] text-text-tertiary shrink-0">
                {t("process.previewReadOnly")}
              </span>
              <button
                onClick={() => onNavigateNote(selected.noteId)}
                className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded text-primary hover:bg-primary/10 transition-colors"
              >
                <ExternalLink size={11} strokeWidth={2.2} />
                {t("process.openNote")}
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {/* コールバックを渡さない = 読み取り専用（P-3）。
                  variant="preview" で属性テーブルを畳み、縮小の下限を上げる */}
              <StepFlowView graph={selected.graph} variant="preview" />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-8 text-center text-xs text-muted-foreground">
            {t("process.selectHint")}
          </div>
        )}
      </div>
    </div>
  );
}

function ProcessRow({
  process,
  selected,
  onSelect,
}: {
  process: ProcessIndexEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const { summary, graph } = process;
  const head = graph.steps.slice(0, PREVIEW_STEPS);
  const rest = graph.steps.length - head.length;

  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      className={`w-full text-left px-6 py-3 border-b border-border-subtle transition-colors ${
        selected ? "bg-primary/8" : "hover:bg-surface-hover"
      }`}
      style={selected ? { boxShadow: "inset 2px 0 0 var(--color-primary)" } : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground truncate">{process.title}</span>
        {summary.branching && (
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground shrink-0"
            title={t("process.branching")}
          >
            <GitBranch size={9} strokeWidth={2.2} />
            {t("process.branching")}
          </span>
        )}
        <span className="ml-auto text-[10px] text-text-tertiary shrink-0">
          {formatDate(process.sourceModifiedAt)}
        </span>
      </div>

      {/* 工程の並び。プロセスらしさは名前より流れに出る */}
      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground min-w-0">
        {head.map((step, i) => (
          <span key={step.id} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ArrowRight size={10} strokeWidth={2} className="shrink-0 text-text-tertiary" />}
            <span className="truncate">{step.name}</span>
          </span>
        ))}
        {rest > 0 && <span className="text-text-tertiary shrink-0">+{rest}</span>}
      </div>

      <div className="mt-1 flex items-center gap-3 text-[10px] text-text-tertiary">
        <span>{t("process.stepCount", { n: String(summary.stepCount) })}</span>
        {summary.materialCount > 0 && (
          <span>{t("process.materials", { n: String(summary.materialCount) })}</span>
        )}
        {summary.toolCount > 0 && (
          <span>{t("process.tools", { n: String(summary.toolCount) })}</span>
        )}
        {summary.outputCount > 0 && (
          <span>{t("process.outputs", { n: String(summary.outputCount) })}</span>
        )}
        {process.forkedFrom && (
          <span className="inline-flex items-center gap-1">
            <CornerDownRight size={9} strokeWidth={2.2} />
            {t("process.forkedFrom", { title: process.forkedFrom.title })}
          </span>
        )}
      </div>
    </button>
  );
}
