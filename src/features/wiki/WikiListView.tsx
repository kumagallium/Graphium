// Wiki リストビュー（メインエリアに表示）
// Summary / Claim / Synthesis カテゴリ別に Wiki ドキュメント一覧をテーブル形式で表示
// NoteListView と一貫したテーブル + ソート + チェックボックス削除構造

import { useCallback, useMemo, useState } from "react";
import { Bot, Search, Trash2, RefreshCw, Globe2 } from "lucide-react";
import type {
  AtomType,
  ClaimRole,
  GroundingValidityVerdict,
  SynthesisMode,
  WikiKind,
  WikiMetaSummary,
} from "../../lib/document-types";
import type { GraphiumFile } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useT } from "../../i18n";
import { useRangeSelect } from "../../hooks/use-range-select";
import { formatDateTime } from "../../lib/format-datetime";

type SortKey =
  | "title"
  | "kind"
  | "modifiedAt"
  | "createdAt"
  | "sources"
  | "incoming"
  | "outgoing"
  | "verdict"
  | "model";
type SortDirection = "asc" | "desc";

// 世界モデル照合 verdict のソート順。値が小さいほど "established" 寄りで先頭に。
// undefined（KB マッチなし / 未照合）は最後に並べる。
const VERDICT_ORDER: Record<string, number> = {
  established: 0,
  supported: 1,
  weak: 2,
  contested: 3,
};
function verdictRank(verdict?: string): number {
  if (!verdict) return 99;
  return VERDICT_ORDER[verdict] ?? 50;
}

// PR 2A 方針 §5: 当初は一覧の verdict 列のソートを外していたが、
// 2026-05-21 のユーザー要望「全ての列が並び替え対象になるように」に従って sort を許可した。
// verdict は「妥当度ランキング」ではなく KB からの位置づけとして読まれるべきなので、
// 一覧で並び替えできる UI は誤った含意（強い→弱い順）を与える。

type Props = {
  noteIndex: GraphiumIndex | null;
  wikiKind: WikiKind;
  wikiFiles: GraphiumFile[];
  wikiMetas: Map<string, WikiMetaSummary>;
  /** クリック時（サイドピーク表示用） */
  onOpenWiki: (wikiId: string) => void;
  /** ダブルクリック or フルで開く */
  onOpenWikiFull?: (wikiId: string) => void;
  onBack: () => void;
  onDeleteWiki: (wikiId: string) => Promise<void>;
  /** 一括再生成（任意）— 提供時のみアクションバーに表示 */
  onRegenerateWiki?: (wikiId: string) => Promise<unknown> | void;
  /**
   * 一括世界照合（任意, Phase 2 / PR 2A）— 提供時のみアクションバーに表示。
   * Summary は対象外。蒸留 KB のみで照合するため fire-and-forget で並列実行を許容する。
   */
  onWorldCheckWiki?: (wikiId: string) => Promise<unknown> | void;
};

// 削除確認ダイアログ
function DeleteConfirmDialog({
  count,
  onConfirm,
  onCancel,
  deleting,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {count === 1
            ? t("wikiList.deleteConfirmTitleSingle")
            : t("wikiList.deleteConfirmTitleMulti", { count: String(count) })}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("wikiList.deleteConfirmMessage")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("wikiList.deleteConfirmCancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {deleting ? t("wikiList.deleting") : t("wikiList.deleteConfirmOk")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Wiki 一覧の「種別」列に表示する意味的なバッジ。
// 一覧は既に kind でフィルタされているため kind 自体は冗長で、代わりに
// 提案 v4 Phase 1 の意味的な型（claimRole / atomType / synthesisMode）を見せる。
// 型が未推定のエントリは小さなフォールバック（— または kind の小ラベル）を返す。
//
// hypothesisStatus はユーザー操作で状態を昇格させる UI フローが無く、
// 既定値以外がほぼ出ないため一覧では表示しない（データは wikiMeta に残す）。
function TypeBadge({
  kind,
  claimRole,
  atomType,
  synthesisMode,
}: {
  kind: WikiKind;
  claimRole?: ClaimRole[];
  atomType?: AtomType;
  synthesisMode?: SynthesisMode;
}) {
  const t = useT();

  if (kind === "summary") {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[11px] font-medium">
        {t("wikiList.kindSummary")}
      </span>
    );
  }

  if (kind === "claim") {
    if (!claimRole || claimRole.length === 0) {
      return <span className="text-muted-foreground/40 text-[11px]">—</span>;
    }
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        {claimRole.map((role) => (
          <span
            key={role}
            title={t(`wikiTypes.claimRole.${role}` as any)}
            className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[11px] font-medium"
          >
            {t(`wikiTypes.claimRole.${role}` as any)}
          </span>
        ))}
      </span>
    );
  }

  if (kind === "atom") {
    if (!atomType) {
      return <span className="text-muted-foreground/40 text-[11px]">—</span>;
    }
    return (
      <span
        title={t(`wikiTypes.atomType.${atomType}` as any)}
        className="inline-block px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-400 text-[11px] font-medium"
      >
        {t(`wikiTypes.atomType.${atomType}` as any)}
      </span>
    );
  }

  if (kind === "synthesis") {
    if (!synthesisMode) {
      return <span className="text-muted-foreground/40 text-[11px]">—</span>;
    }
    return (
      <span
        title={t(`wikiTypes.synthesisMode.${synthesisMode}` as any)}
        className="inline-block px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-400 text-[11px] font-medium"
      >
        {t(`wikiTypes.synthesisMode.${synthesisMode}` as any)}
      </span>
    );
  }

  return null;
}

export function WikiListView({
  noteIndex,
  wikiKind,
  wikiFiles,
  wikiMetas,
  onOpenWiki,
  onOpenWikiFull,
  onBack,
  onDeleteWiki,
  onRegenerateWiki,
  onWorldCheckWiki,
}: Props) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 被参照カウント（このページを参照している「distinct なノート/wiki」の数）
  // 1 ノートが本文で同じ wiki を複数回引用しても 1 と数える。
  const incomingRefCount = useMemo(() => {
    const counts = new Map<string, number>();
    if (!noteIndex) return counts;
    for (const entry of noteIndex.notes) {
      const targets = new Set<string>();
      for (const link of entry.outgoingLinks ?? []) {
        if (link.targetNoteId) targets.add(link.targetNoteId);
      }
      for (const target of targets) {
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }
    }
    return counts;
  }, [noteIndex]);

  // 参照先カウント（この Wiki が参照している distinct な targetNoteId 数）
  // 同一 target を複数回引用しても 1 と数える。
  const outgoingRefCountById = useMemo(() => {
    const counts = new Map<string, number>();
    if (!noteIndex) return counts;
    for (const entry of noteIndex.notes) {
      const targets = new Set<string>();
      for (const link of entry.outgoingLinks ?? []) {
        if (link.targetNoteId) targets.add(link.targetNoteId);
      }
      counts.set(entry.noteId, targets.size);
    }
    return counts;
  }, [noteIndex]);

  // 生成元ノート数を index から引く（doc を読み込まなくても済むように）
  // 同一ノートが derivedFromNotes に重複登録されている場合に備えて Set で dedupe する。
  const sourcesCountById = useMemo(() => {
    const counts = new Map<string, number>();
    if (!noteIndex) return counts;
    for (const entry of noteIndex.notes) {
      const unique = new Set(entry.derivedFromNotes ?? []);
      counts.set(entry.noteId, unique.size);
    }
    return counts;
  }, [noteIndex]);

  const wikiEntries = useMemo(() => {
    return wikiFiles
      .filter((f) => {
        const meta = wikiMetas.get(f.id);
        return meta && meta.kind === wikiKind;
      })
      .map((f) => ({
        id: f.id,
        title: wikiMetas.get(f.id)!.title,
        modifiedAt: f.modifiedTime,
        createdAt: f.createdTime,
        kind: wikiMetas.get(f.id)!.kind,
        level: wikiMetas.get(f.id)!.level,
        status: wikiMetas.get(f.id)!.status,
        model: wikiMetas.get(f.id)!.model,
        // 提案 v4 Phase 1: 意味的な型を一覧で見せるためのフィールド
        claimRole: wikiMetas.get(f.id)!.claimRole,
        atomType: wikiMetas.get(f.id)!.atomType,
        synthesisMode: wikiMetas.get(f.id)!.synthesisMode,
        hypothesisStatus: wikiMetas.get(f.id)!.hypothesisStatus,
        sources: sourcesCountById.get(f.id) ?? 0,
        incoming: incomingRefCount.get(f.id) ?? 0,
        outgoing: outgoingRefCountById.get(f.id) ?? 0,
        // 世界モデル照合 verdict（Phase 2 / PR 2A） — summary 以外で意味を持つ
        worldGrounding: wikiMetas.get(f.id)!.groundingValidity,
      }));
  }, [wikiFiles, wikiMetas, wikiKind, sourcesCountById, incomingRefCount, outgoingRefCountById]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return key;
      }
      setSortDir(key === "title" ? "asc" : "desc");
      return key;
    });
  }, []);

  const filtered = useMemo(() => {
    let result = wikiEntries;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((e) => e.title.toLowerCase().includes(q));
    }
    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title, "ja");
          break;
        case "kind":
          // 種別の sort は意味的な順序ではなく単純に文字列比較（atomType / synthesisMode の
          // 中の細目で並ぶ）。kindLabel の i18n まで巻き込むと一覧の挙動が i18n に依存する
          // ことになるので、保存値の atomType / synthesisMode を直接比較する。
          cmp = (a.atomType ?? a.synthesisMode ?? "").localeCompare(
            b.atomType ?? b.synthesisMode ?? "",
            "en",
          );
          break;
        case "modifiedAt":
          cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "sources":
          cmp = a.sources - b.sources;
          break;
        case "incoming":
          cmp = a.incoming - b.incoming;
          break;
        case "outgoing":
          cmp = a.outgoing - b.outgoing;
          break;
        case "verdict":
          cmp = verdictRank(a.worldGrounding?.verdict) - verdictRank(b.worldGrounding?.verdict);
          break;
        case "model":
          cmp = (a.model ?? "").localeCompare(b.model ?? "", "en");
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [wikiEntries, searchQuery, sortKey, sortDir]);

  // ドラッグ範囲選択（チェックボックス列）
  const orderedIds = useMemo(() => filtered.map((e) => e.id), [filtered]);
  const range = useRangeSelect(orderedIds, selectedIds, setSelectedIds);

  const toggleSelectAll = useCallback(() => {
    const ids = filtered.map((e) => e.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(ids));
  }, [filtered, selectedIds]);

  const allSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      for (const id of deleteTarget) {
        await onDeleteWiki(id);
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of deleteTarget) next.delete(id);
        return next;
      });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDeleteWiki]);

  const kindLabel =
    wikiKind === "summary" ? t("wikiList.kindSummary")
    : wikiKind === "synthesis" ? t("wikiList.kindSynthesis")
    : wikiKind === "atom" ? t("wikiList.kindAtom")
    : t("wikiList.kindClaim");

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <Breadcrumb items={[
          { label: t("nav.home"), onClick: onBack },
          { label: t("wikiList.crumbWiki") },
          { label: kindLabel },
        ]} />
        <span className="text-xs text-muted-foreground">
          {t("wikiList.count", { filtered: String(filtered.length), total: String(wikiEntries.length) })}
        </span>
        {someSelected && (
          <div className="ml-auto flex items-center gap-2">
            {onWorldCheckWiki && wikiKind !== "summary" && (
              <button
                onClick={() => {
                  // 一括世界照合（Phase 2 / PR 2A）— 蒸留 KB のみで照合するため fire-and-forget OK
                  for (const id of selectedIds) {
                    void onWorldCheckWiki(id);
                  }
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                title={t("wikiList.worldCheckSelectedTitle")}
              >
                <Globe2 size={12} />
                {t("wikiList.worldCheckSelected", { count: String(selectedIds.size) })}
              </button>
            )}
            {onRegenerateWiki && (
              <button
                onClick={() => {
                  // regenerate は内部で toast キューに積む fire-and-forget を許容
                  // 並列に走るが、各 wiki ごとに個別ジョブとしてトーストに表示される
                  for (const id of selectedIds) {
                    void onRegenerateWiki(id);
                  }
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                title={t("wikiList.regenerateSelectedTitle")}
              >
                <RefreshCw size={12} />
                {t("wikiList.regenerateSelected", { count: String(selectedIds.size) })}
              </button>
            )}
            <button
              onClick={() => setDeleteTarget([...selectedIds])}
              className="px-3 py-1 text-xs font-medium rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              {t("wikiList.deleteSelected", { count: String(selectedIds.size) })}
            </button>
          </div>
        )}
      </div>

      {/* ツールバー（検索） */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border/50">
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("wikiList.search")}
            className="pl-7 pr-2.5 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60 w-48 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* テーブル */}
      <div className="flex-1 overflow-auto px-6">
        {wikiMetas.size === 0 && wikiFiles.length > 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("wikiList.loading")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Bot size={24} className="opacity-30" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? t("wikiList.noMatching") : t("wikiList.noWikisYet", { kind: kindLabel })}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-2 w-[36px]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    title={allSelected ? t("wikiList.deselectAll") : t("wikiList.selectAll")}
                  />
                </th>
                <th
                  className="py-2 px-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("title")}
                >
                  {t("wikiList.colTitle")}{sortKey === "title" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 px-3 w-[140px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("kind")}
                >
                  {t("wikiList.colType")}{sortKey === "kind" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 pl-3 w-[80px] cursor-pointer hover:text-foreground tabular-nums"
                  onClick={() => handleSort("sources")}
                  title={t("wikiList.colSourcesTooltip")}
                >
                  {t("wikiList.colSources")}{sortKey === "sources" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 pl-3 w-[70px] cursor-pointer hover:text-foreground tabular-nums"
                  onClick={() => handleSort("outgoing")}
                  title={t("wikiList.colOutgoingTooltip")}
                >
                  {t("wikiList.colOutgoing")}{sortKey === "outgoing" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 pl-3 w-[70px] cursor-pointer hover:text-foreground tabular-nums"
                  onClick={() => handleSort("incoming")}
                  title={t("wikiList.colIncomingTooltip")}
                >
                  {t("wikiList.colIncoming")}{sortKey === "incoming" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                {wikiKind !== "summary" && (
                  <th
                    className="py-2 pl-3 w-[110px] cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("verdict")}
                    title={t("wikiList.colWorldVerdictTooltip")}
                  >
                    {t("wikiList.colWorldVerdict")}{sortKey === "verdict" && (sortDir === "desc" ? " ↓" : " ↑")}
                  </th>
                )}
                <th
                  className="py-2 px-2 w-[120px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("model")}
                >
                  {t("wikiList.colModel")}{sortKey === "model" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 pl-3 w-[100px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("createdAt")}
                >
                  {t("wikiList.colCreated")}{sortKey === "createdAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 pl-3 w-[100px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("modifiedAt")}
                >
                  {t("wikiList.colModified")}{sortKey === "modifiedAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-2 w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, index) => (
                <tr
                  key={entry.id}
                  className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group ${
                    selectedIds.has(entry.id) ? "bg-primary/5" : ""
                  }`}
                  onMouseDown={(e) => range.onRowMouseDown(e, index)}
                  onMouseEnter={() => range.onRowMouseEnter(index)}
                  onClick={() => {
                    if (range.shouldSuppressClick()) return;
                    onOpenWiki(entry.id);
                  }}
                  onDoubleClick={() => onOpenWikiFull?.(entry.id)}
                >
                  <td
                    className="py-2 px-2 cursor-pointer"
                    title={t("wikiList.dragToRangeSelect")}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => range.onCheckboxMouseDown(e, index)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      readOnly
                      tabIndex={-1}
                      className="w-3.5 h-3.5 rounded border-border accent-primary pointer-events-none"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <span className="inline-flex items-center gap-2">
                      <Bot size={14} className="text-primary shrink-0" />
                      <span className="text-foreground hover:text-primary transition-colors">
                        {entry.title}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs">
                    <TypeBadge
                      kind={entry.kind}
                      claimRole={entry.claimRole}
                      atomType={entry.atomType}
                      synthesisMode={entry.synthesisMode}
                    />
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums">
                    {entry.sources > 0 ? entry.sources : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums">
                    {entry.outgoing > 0 ? entry.outgoing : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums">
                    {entry.incoming > 0 ? entry.incoming : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  {wikiKind !== "summary" && (
                    <td className="py-2 pl-3 text-xs">
                      <WorldVerdictCell grounding={entry.worldGrounding} />
                    </td>
                  )}
                  <td className="py-2 px-2 text-xs text-muted-foreground truncate" title={entry.model ?? ""}>
                    {entry.model ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block text-xs font-medium rounded px-1 py-0.5 bg-muted">🤖</span>
                        <span className="truncate">{entry.model}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatDateTime(entry.modifiedAt)}
                  </td>
                  <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setDeleteTarget([entry.id])}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                      title={t("wikiList.deleteRowTitle")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteTarget && (
        <DeleteConfirmDialog
          count={deleteTarget.length}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}

// 世界モデル照合 verdict のセル（Phase 2 / PR 2A）。
// - verdict あり: 色付き verdict ラベル + Globe アイコン
// - 照合済 / マッチなし: 薄い ◯ + "—"
// - 未照合: 薄い "—"（自動照合がまだ走っていない）
function WorldVerdictCell({
  grounding,
}: {
  grounding?: { verdict?: GroundingValidityVerdict; checkedAt?: string };
}) {
  const t = useT();
  const verdict = grounding?.verdict;
  if (verdict) {
    const palette: Record<GroundingValidityVerdict, { fg: string; bg: string }> = {
      established: { fg: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10" },
      supported: { fg: "text-emerald-600 dark:text-emerald-500", bg: "bg-emerald-500/5" },
      weak: { fg: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/10" },
      contested: { fg: "text-rose-700 dark:text-rose-400", bg: "bg-rose-500/10" },
    };
    const p = palette[verdict];
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${p.bg} ${p.fg}`}
        title={`${t("wikiBanner.worldVerdictLabel")}: ${t(`wikiBanner.worldVerdict.${verdict}` as any)}`}
      >
        <Globe2 size={10} />
        {t(`wikiBanner.worldVerdict.${verdict}` as any)}
      </span>
    );
  }
  if (grounding?.checkedAt) {
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground/60 text-[11px]"
        title={t("wikiBanner.worldNoMatchHint")}
      >
        <Globe2 size={10} />
        {t("wikiList.colWorldVerdictNoMatch")}
      </span>
    );
  }
  return <span className="text-muted-foreground/40">—</span>;
}
