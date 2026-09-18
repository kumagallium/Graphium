// Wiki リストビュー（メインエリアに表示）
// Summary / Claim / Synthesis カテゴリ別に Wiki ドキュメント一覧をテーブル形式で表示
// NoteListView と一貫したテーブル + ソート + チェックボックス削除構造

import { useCallback, useMemo, useRef, useState } from "react";
import { Bot, Filter, Search, Share2, Trash2, RefreshCw, Globe2, Eraser, Merge } from "lucide-react";
import { FilterPopup, type FilterOption } from "../../ui/filter-popup";
import { cn } from "../../lib/utils";
import type {
  AtomType,
  ClaimRole,
  GroundingValidityVerdict,
  SourceCheckVerdict,
  SynthesisMode,
  WikiKind,
  WikiMetaSummary,
} from "../../lib/document-types";
import { sourceCheckVerdictPalette } from "../source-check/ui/SourceCheckBadge";
import { isNeedsReviewVerdict } from "../source-check/needs-review";
import { FileSearch } from "lucide-react";
import type { GraphiumFile } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useT } from "../../i18n";
import { useRangeSelect } from "../../hooks/use-range-select";
import { formatDateTime } from "../../lib/format-datetime";
import { listSearchInputProps } from "@/hooks/use-list-search-hotkey";

type SortKey =
  | "title"
  | "kind"
  | "modifiedAt"
  | "createdAt"
  | "sources"
  | "incoming"
  | "outgoing"
  | "verdict"
  | "sourceVerdict"
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

// 出典照合 verdict のソート順（aggregate.ts の優先順位と揃える）。
// 注意が要る順（ドキュメント単位の集約 aggregateDocumentVerdict と同じ順）。
const SOURCE_VERDICT_ORDER: Record<SourceCheckVerdict, number> = {
  contradicted: 0,
  "not-in-source": 1,
  unclear: 2,
  "source-missing": 3,
  supported: 4,
};
function sourceVerdictRank(verdict?: SourceCheckVerdict): number {
  if (!verdict) return 99;
  return SOURCE_VERDICT_ORDER[verdict] ?? 50;
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
  /**
   * 一括世界照合クリア（任意）— 提供時のみアクションバーに表示。
   * 選択した Wiki に焼き付いた verdict / 出典を消す。間違った判定や幻覚 URL を
   * まとめて剥がす用途。KB 側は触らない（ノートの grounding.validity のみ）。
   */
  onClearWorldValidity?: (wikiId: string) => Promise<unknown> | void;
  /**
   * 世界照合機能のマスタースイッチ（設定の features.worldGrounding、既定 true）。
   * false のときは「世界」列と verdict ソートを出さない。一括操作は
   * onWorldCheckWiki / onClearWorldValidity が undefined になることで隠れる
   * （呼び出し側が既に判定して渡す）。
   */
  worldGroundingEnabled?: boolean;
  /**
   * 一括チーム共有（任意）— 提供時のみアクションバーに表示。
   * 選択 id を渡すだけで、実行と進捗表示は呼び出し側（BulkShareModal）が担う。
   * デスクトップ + shared root + identity が揃っている場合にのみ渡される。
   */
  onShareSelected?: (wikiIds: string[]) => void;
  /**
   * テーマの選択統合（任意, wikiKind === "topic" のときだけ意味を持つ）— 提供時のみ
   * 一括操作バーに「統合」ボタンが出る（2 件以上選択時）。keepId に他を吸収させて
   * ゴミ箱へ送り、本文を書き直す。モデルは呼ばない（明示選択のみ）。
   */
  onMergeTopics?: (keepId: string, mergeIds: string[]) => Promise<{ merged: number } | void>;
};

// テーマ統合の確認ダイアログ — 残すテーマをラジオで選ぶ（既定は知見数が最も多いもの）
function MergeTopicsDialog({
  candidates,
  defaultKeepId,
  onConfirm,
  onCancel,
  merging,
}: {
  candidates: { id: string; title: string; sources: number }[];
  defaultKeepId: string;
  onConfirm: (keepId: string) => void;
  onCancel: () => void;
  merging: boolean;
}) {
  const t = useT();
  const [keepId, setKeepId] = useState(defaultKeepId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {t("wikiList.mergeConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t("wikiList.mergeConfirmMessage")}
        </p>
        <div className="flex flex-col gap-1.5 mb-4 max-h-60 overflow-y-auto">
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="radio"
                name="merge-topic-keep"
                checked={keepId === c.id}
                onChange={() => setKeepId(c.id)}
                disabled={merging}
              />
              <span className="truncate">{c.title}</span>
              <span className="text-muted-foreground/60 shrink-0">({c.sources})</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={merging}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("wikiList.mergeConfirmCancel")}
          </button>
          <button
            onClick={() => onConfirm(keepId)}
            disabled={merging}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {merging ? t("wikiList.merging") : t("wikiList.mergeConfirmOk")}
          </button>
        </div>
      </div>
    </div>
  );
}

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

  // topic は claimRole/atomType/synthesisMode のような細目分類を持たない
  // （知見を束ねるページなので、種別自体が kindLabel で示される）。
  if (kind === "topic") {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[11px] font-medium">
        {t("wikiList.kindTopic")}
      </span>
    );
  }

  // answer も topic と同じく細目分類を持たない
  if (kind === "answer") {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[11px] font-medium">
        {t("wikiList.kindAnswer")}
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
  onClearWorldValidity,
  worldGroundingEnabled = true,
  onShareSelected,
  onMergeTopics,
}: Props) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  // 既定は作成日の新しい順（ツールバーで並べ替え可能）
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string[] | null>(null);
  const [merging, setMerging] = useState(false);
  // 列フィルタ。Type 列は wikiKind ごとに claimRole / atomType / synthesisMode を対象にする。
  // wikiKind が切り替わると意味が変わるので、別 kind の選択は引きずらない。
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const [typeFilterPos, setTypeFilterPos] = useState({ top: 0, left: 0 });
  const typeFilterBtnRef = useRef<HTMLButtonElement>(null);
  // 出典照合の「要確認のみ」フィルタ（claim/topic のみ意味を持つ）。既定は全件表示。
  const [sourceCheckNeedsReviewOnly, setSourceCheckNeedsReviewOnly] = useState(false);

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
    const real = wikiFiles
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
        // topic の「生成元」列はメンバー知見数（derivedFromClaims）を出す —
        // 他 kind の「派生元ノート数」とは意味が違うが、同じ列を流用する（新規列を増やさない）。
        // 新形式トピック（derivedFromClaims が未設定/空で derivedFromNotes に資料 id を持つ）は
        // 0 件と誤表示しないよう、derivedFromClaims が空なら資料数にフォールバックする。
        sources:
          wikiKind === "topic"
            ? ((wikiMetas.get(f.id)!.derivedFromClaims?.length ?? 0) || (sourcesCountById.get(f.id) ?? 0))
            : (sourcesCountById.get(f.id) ?? 0),
        incoming: incomingRefCount.get(f.id) ?? 0,
        outgoing: outgoingRefCountById.get(f.id) ?? 0,
        // 世界モデル照合 verdict（Phase 2 / PR 2A） — summary 以外で意味を持つ
        worldGrounding: wikiMetas.get(f.id)!.groundingValidity,
        // 出典照合 verdict（Source check, v1.1） — claim/topic のみ意味を持つ
        sourceCheck: wikiMetas.get(f.id)!.sourceCheckVerdict,
      }));
    return real;
  }, [wikiFiles, wikiMetas, wikiKind, sourcesCountById, incomingRefCount, outgoingRefCountById]);

  // Type 列フィルタの選択肢を、現在の wikiEntries から動的に集計する。
  // claim → claimRole（複数可）, atom → atomType, synthesis → synthesisMode。
  // summary は意味的に 1 値しか取らないので filter は出さない。
  const typeFilterOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const e of wikiEntries) {
      if (wikiKind === "claim") {
        for (const role of e.claimRole ?? []) {
          counts.set(role, (counts.get(role) ?? 0) + 1);
        }
      } else if (wikiKind === "atom" && e.atomType) {
        counts.set(e.atomType, (counts.get(e.atomType) ?? 0) + 1);
      } else if (wikiKind === "synthesis" && e.synthesisMode) {
        counts.set(e.synthesisMode, (counts.get(e.synthesisMode) ?? 0) + 1);
      }
    }
    const tNs =
      wikiKind === "claim"
        ? "wikiTypes.claimRole"
        : wikiKind === "atom"
          ? "wikiTypes.atomType"
          : wikiKind === "synthesis"
            ? "wikiTypes.synthesisMode"
            : null;
    if (!tNs) return [];
    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: t(`${tNs}.${value}` as never),
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }, [wikiEntries, wikiKind, t]);

  // wikiKind が変わったら typeFilter をリセット（別 kind の選択肢は意味が違う）
  const lastWikiKindRef = useRef(wikiKind);
  if (lastWikiKindRef.current !== wikiKind) {
    lastWikiKindRef.current = wikiKind;
    if (typeFilter.length > 0) setTypeFilter([]);
    if (typeFilterOpen) setTypeFilterOpen(false);
    if (sourceCheckNeedsReviewOnly) setSourceCheckNeedsReviewOnly(false);
  }

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
    if (typeFilter.length > 0) {
      const set = new Set(typeFilter);
      result = result.filter((e) => {
        if (wikiKind === "claim") {
          return (e.claimRole ?? []).some((r) => set.has(r));
        }
        if (wikiKind === "atom") {
          return e.atomType ? set.has(e.atomType) : false;
        }
        if (wikiKind === "synthesis") {
          return e.synthesisMode ? set.has(e.synthesisMode) : false;
        }
        return true;
      });
    }
    if (sourceCheckNeedsReviewOnly && (wikiKind === "claim" || wikiKind === "topic")) {
      result = result.filter((e) => isNeedsReviewVerdict(e.sourceCheck));
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
        case "sourceVerdict":
          cmp = sourceVerdictRank(a.sourceCheck?.verdict) - sourceVerdictRank(b.sourceCheck?.verdict);
          break;
        case "model":
          cmp = (a.model ?? "").localeCompare(b.model ?? "", "en");
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [wikiEntries, searchQuery, sortKey, sortDir, typeFilter, wikiKind, sourceCheckNeedsReviewOnly]);

  // ドラッグ範囲選択（チェックボックス列）
  const orderedIds = useMemo(() => filtered.map((e) => e.id), [filtered]);
  const range = useRangeSelect(orderedIds, selectedIds, setSelectedIds);

  const selectableEntries = filtered;
  const toggleSelectAll = useCallback(() => {
    const ids = selectableEntries.map((e) => e.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(ids));
  }, [selectableEntries, selectedIds]);

  const allSelected = selectableEntries.length > 0 && selectableEntries.every((e) => selectedIds.has(e.id));
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

  const mergeCandidates = useMemo(() => {
    if (!mergeTarget) return [];
    return mergeTarget
      .map((id) => wikiEntries.find((e) => e.id === id))
      .filter((e): e is (typeof wikiEntries)[number] => !!e)
      .map((e) => ({ id: e.id, title: e.title, sources: e.sources }));
  }, [mergeTarget, wikiEntries]);

  const mergeDefaultKeepId = useMemo(() => {
    if (mergeCandidates.length === 0) return "";
    // 既定は最も知見数（sources）が多いもの。同数なら最初の候補。
    return mergeCandidates.reduce((best, c) => (c.sources > best.sources ? c : best), mergeCandidates[0]).id;
  }, [mergeCandidates]);

  const handleMergeConfirm = useCallback(async (keepId: string) => {
    if (!mergeTarget || !onMergeTopics) return;
    const mergeIds = mergeTarget.filter((id) => id !== keepId);
    if (mergeIds.length === 0) {
      setMergeTarget(null);
      return;
    }
    setMerging(true);
    try {
      await onMergeTopics(keepId, mergeIds);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of mergeTarget) next.delete(id);
        return next;
      });
    } finally {
      setMerging(false);
      setMergeTarget(null);
    }
  }, [mergeTarget, onMergeTopics]);

  const kindLabel =
    wikiKind === "summary" ? t("wikiList.kindSummary")
    : wikiKind === "synthesis" ? t("wikiList.kindSynthesis")
    : wikiKind === "atom" ? t("wikiList.kindAtom")
    : wikiKind === "topic" ? t("wikiList.kindTopic")
    : wikiKind === "answer" ? t("wikiList.kindAnswer")
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
            {onShareSelected && (
              <button
                onClick={() => {
                  const ids = [...selectedIds];
                  setSelectedIds(new Set());
                  onShareSelected(ids);
                }}
                className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                title={t("share.bulk.title")}
              >
                <Share2 size={12} />
                {t("share.bulk.selected", { count: String(selectedIds.size) })}
              </button>
            )}
            {onWorldCheckWiki && wikiKind !== "summary" && wikiKind !== "topic" && wikiKind !== "answer" && (
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
            {onClearWorldValidity && wikiKind !== "summary" && wikiKind !== "topic" && wikiKind !== "answer" && (
              <button
                onClick={async () => {
                  // 選択した Wiki の照合結果（verdict / 出典）を一括クリア。
                  // ノート側 grounding.validity のみ剥がす（KB は触らない）。
                  // 保存は savingRef で直列化されるため、await で順に流して
                  // 並行 fire による取りこぼし（savingRef ガードで silent drop）を防ぐ。
                  for (const id of selectedIds) {
                    await onClearWorldValidity(id);
                  }
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1 text-xs font-medium rounded bg-muted text-muted-foreground hover:bg-muted/70 transition-colors inline-flex items-center gap-1.5"
                title={t("wikiList.clearWorldSelectedTitle")}
              >
                <Eraser size={12} />
                {t("wikiList.clearWorldSelected", { count: String(selectedIds.size) })}
              </button>
            )}
            {/* summary は新規生成パイプラインが撤退済み（PR3）。一括再生成は出さない
                （削除は下の deleteSelected ボタンでそのまま可能） */}
            {onRegenerateWiki && wikiKind !== "summary" && (
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
            {onMergeTopics && wikiKind === "topic" && selectedIds.size >= 2 && (
              <button
                onClick={() => setMergeTarget([...selectedIds])}
                className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                title={t("wikiList.mergeTopicsTitle")}
              >
                <Merge size={12} />
                {t("wikiList.mergeTopics")}
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
        {(wikiKind === "claim" || wikiKind === "topic") && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sourceCheckNeedsReviewOnly}
              onChange={(e) => setSourceCheckNeedsReviewOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
            />
            {t("wikiList.filterSourceCheckNeedsReviewOnly")}
          </label>
        )}
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            {...listSearchInputProps}
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
          <table className="w-full min-w-[1080px] text-sm">
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
                <th className="py-2 px-3 w-[140px]">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => handleSort("kind")}
                    >
                      {t("wikiList.colType")}{sortKey === "kind" && (sortDir === "desc" ? " ↓" : " ↑")}
                    </button>
                    {wikiKind !== "summary" && typeFilterOptions.length > 0 && (
                      <button
                        ref={typeFilterBtnRef}
                        type="button"
                        onClick={() => {
                          if (typeFilterBtnRef.current) {
                            const rect = typeFilterBtnRef.current.getBoundingClientRect();
                            setTypeFilterPos({ top: rect.bottom + 4, left: rect.left });
                          }
                          setTypeFilterOpen((v) => !v);
                        }}
                        className={cn(
                          "inline-flex items-center justify-center w-5 h-5 rounded transition-colors",
                          typeFilter.length > 0
                            ? "text-primary bg-primary/10 hover:bg-primary/15"
                            : "text-text-tertiary hover:text-foreground hover:bg-muted",
                        )}
                        aria-label={t("wikiList.filterType")}
                        title={t("wikiList.filterType")}
                      >
                        <Filter size={12} strokeWidth={2.25} />
                      </button>
                    )}
                    {typeFilter.length > 0 && (
                      <span className="text-[10px] tabular-nums text-primary">
                        ({typeFilter.length})
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className="py-2 pl-3 w-[80px] cursor-pointer hover:text-foreground tabular-nums"
                  onClick={() => handleSort("sources")}
                  title={wikiKind === "topic" ? t("wikiList.colSourcesTooltipTopic") : t("wikiList.colSourcesTooltip")}
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
                {wikiKind !== "summary" && wikiKind !== "topic" && wikiKind !== "answer" && worldGroundingEnabled && (
                  <th
                    className="py-2 pl-3 w-[110px] cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("verdict")}
                    title={t("wikiList.colWorldVerdictTooltip")}
                  >
                    {t("wikiList.colWorldVerdict")}{sortKey === "verdict" && (sortDir === "desc" ? " ↓" : " ↑")}
                  </th>
                )}
                {/* 出典照合 verdict — claim/topic のみ意味を持つ（世界照合列とは逆に、topic では出す）。
                    stale（本文変更）は本文を読まないと判定できないため一覧では出さない
                    （仕様 2-c の明示的な決定。SourceCheckBadge 側の stale 表示はバナー/詳細欄だけ）。 */}
                {(wikiKind === "claim" || wikiKind === "topic") && (
                  <th
                    className="py-2 pl-3 w-[120px] cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("sourceVerdict")}
                    title={t("wikiList.colSourceVerdictTooltip")}
                  >
                    {t("wikiList.colSourceVerdict")}
                    {sortKey === "sourceVerdict" && (sortDir === "desc" ? " ↓" : " ↑")}
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
                  {wikiKind !== "summary" && wikiKind !== "topic" && wikiKind !== "answer" && worldGroundingEnabled && (
                    <td className="py-2 pl-3 text-xs">
                      <WorldVerdictCell grounding={entry.worldGrounding} />
                    </td>
                  )}
                  {(wikiKind === "claim" || wikiKind === "topic") && (
                    <td className="py-2 pl-3 text-xs">
                      <SourceVerdictCell sourceCheck={entry.sourceCheck} />
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

      {typeFilterOpen && wikiKind !== "summary" && (
        <FilterPopup
          position={typeFilterPos}
          onClose={() => setTypeFilterOpen(false)}
          title={t("wikiList.filterType")}
          options={typeFilterOptions}
          selected={typeFilter}
          onChange={setTypeFilter}
          searchPlaceholder={t("common.search")}
          clearLabel={t("nav.clearFilter")}
          emptyText={t("wikiList.filterEmpty")}
          noMatchText={t("wikiList.noMatching")}
          minWidth={220}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          count={deleteTarget.length}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      {mergeTarget && mergeCandidates.length >= 2 && (
        <MergeTopicsDialog
          candidates={mergeCandidates}
          defaultKeepId={mergeDefaultKeepId}
          onConfirm={handleMergeConfirm}
          onCancel={() => setMergeTarget(null)}
          merging={merging}
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

// 出典照合 verdict のセル（Source check, v1.1）。世界照合の WorldVerdictCell と同じ作り。
// dismissed は verdict の色相を落とし、Check ではなく控えめなテキストで「確認済み」と示す
// （バッジ側の DISMISSED_PALETTE と同じ意図。一覧は幅が狭いのでアイコンだけにする）。
function SourceVerdictCell({
  sourceCheck,
}: {
  sourceCheck?: { verdict: SourceCheckVerdict; dismissed?: boolean };
}) {
  const t = useT();
  if (!sourceCheck) return <span className="text-muted-foreground/40">—</span>;
  const { verdict, dismissed } = sourceCheck;
  const p = sourceCheckVerdictPalette[verdict];
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{
        color: dismissed ? "var(--ink-3)" : p.color,
        background: dismissed ? "transparent" : p.bg,
        whiteSpace: "nowrap",
      }}
      title={`${t("sourceCheck.title")}: ${t(`sourceCheck.verdict.${verdict}` as never)}${dismissed ? ` (${t("sourceCheck.dismissed")})` : ""}`}
    >
      <FileSearch size={10} />
      {t(`sourceCheck.verdict.${verdict}` as never)}
    </span>
  );
}
