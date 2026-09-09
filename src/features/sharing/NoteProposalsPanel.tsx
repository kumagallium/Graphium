// ノート編集画面（元の作者側）の右パネル「提案」タブの中身。仕様 §25b B。
//
// 何をする場所か:
//   自分が共有したノートに来ている「変更の提案」を読み、選んだ変更だけを
//   手元のノートへ取り込む。共有側の本文は書かない（取り込みは手元の編集）。
//
// 守っていること（NoteSharedCommentsPanel と同じ作法）:
//   - 共有ストアのスナップショット（useSharedLibrary）から組み立てる。ここで
//     フォルダを直接読みに行かない（読み出しの入口を増やすと版がずれる）
//   - 共有ストアの購読はこの部品と小さなバッジの中だけに閉じる。ノート本体を
//     共有フォルダの更新で描き直させない（エディタごと重い）
//   - 比べる相手（mine）は共有コピーではなく **いま開いているノートの最新本文**。
//     共有コピーは「最後に更新を押した時点」なので、それと比べると取り込んだ
//     はずの変更がもう一度出る
//   - 取り込みそのもの（版を残す → 適用 → エディタ反映 → 来歴 → 保存）は
//     呼び出し側（note-app）の onAdopt に委ねる。ここは選択と表示だけ
//   - 既読の控え（markProposalsSeen）は手元の localStorage だけ
//
// 設計詳細: docs/internal/team-shared-storage-design.md §25b

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GitPullRequestArrow } from "lucide-react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { GraphiumDocument } from "../../lib/document-types";
import type { BlobRef, SharedEntry } from "../../lib/storage/shared";
import { ProposalDiffPanel } from "./ProposalDiffPanel";
import { proposalEntriesFor, proposalStatus, readProposalExtra } from "./share-proposal";
import type { ProposalStatus } from "./share-proposal";
import {
  getSharedLibrarySnapshot,
  readSharedEntryBody,
  subscribeSharedLibrary,
  useSharedLibrary,
} from "./shared-library-store";
import { markProposalsSeen, newProposalCount } from "./shared-seen";
import { useProposalDiff } from "./use-proposal-diff";
import {
  countSelected,
  defaultProposalSelection,
  toggleProposalSelection,
} from "./proposal-selection";
import type { ProposalDiff } from "./proposal-diff";

// ──────────────────────────────────────────────
// 件数（レール・バッジ・タブのゲート）
// ──────────────────────────────────────────────

/**
 * このノートの共有コピーに来ている提案の件数。
 *
 * スナップショットそのものではなく **数** を返すのが肝。ノート本体（note-app）は
 * この数でタブの出し入れを決めるので、共有フォルダが更新されても件数が変わらない
 * 限り再描画が起きない（useSyncExternalStore は Object.is で比べる）。
 */
export function useNoteProposalCount(targetId: string | undefined | null): number {
  const getCount = useCallback(
    () => (targetId ? proposalEntriesFor(targetId, getSharedLibrarySnapshot().entries).length : 0),
    [targetId],
  );
  return useSyncExternalStore(subscribeSharedLibrary, getCount, getCount);
}

// ── 既読の控えの変化を伝える（モジュール内だけの購読） ──
// markProposalsSeen は localStorage を書くだけなので、そのままではレールのドットが
// 残る。書いた側から知らせて、同じ画面の印をその場で消す。
const seenListeners = new Set<() => void>();

function subscribeSeen(listener: () => void): () => void {
  seenListeners.add(listener);
  return () => {
    seenListeners.delete(listener);
  };
}

function notifySeenChanged(): void {
  for (const listener of [...seenListeners]) listener();
}

function useUnseenProposals(targetId: string | undefined, total: number): number {
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const recompute = () => setUnseen(targetId ? newProposalCount(targetId, total) : 0);
    recompute();
    return subscribeSeen(recompute);
  }, [targetId, total]);
  return unseen;
}

// ──────────────────────────────────────────────
// 小さな部品（ヘッダのバッジ / レールのアイコン）
// ──────────────────────────────────────────────

/**
 * ヘッダの共有済みバッジの横に出す「提案 N」。新着があれば強調する。
 * 提案がまだ 1 件も無いときは何も出さない（0 の表示は場所を取るだけ）。
 */
export function NoteProposalsBadge({
  targetId,
  onClick,
  entries,
}: {
  targetId: string;
  onClick?: () => void;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
}) {
  const t = useT();
  const shared = useSharedLibrary();
  const source = entries ?? shared.entries;
  const total = useMemo(() => proposalEntriesFor(targetId, source).length, [source, targetId]);
  const unseen = useUnseenProposals(targetId, total);
  if (total === 0) return null;
  const label = t("proposal.countLabel", { count: String(total) });
  return (
    <button
      type="button"
      onClick={onClick}
      title={unseen > 0 ? t("proposal.newBadge", { count: String(unseen) }) : label}
      data-testid="note-proposals-badge"
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-md shrink-0 inline-flex items-center gap-1 transition-colors",
        unseen > 0
          ? "bg-primary/15 text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground",
        onClick ? "cursor-pointer" : "cursor-default",
      )}
    >
      <GitPullRequestArrow size={10} />
      {label}
      {unseen > 0 && <span>{t("proposal.newBadge", { count: String(unseen) })}</span>}
    </button>
  );
}

/** 右レールの「提案」アイコン。新着があるときだけ小さなドットを重ねる */
export function NoteProposalsRailIcon({
  targetId,
  entries,
}: {
  targetId?: string;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
}) {
  const shared = useSharedLibrary();
  const source = entries ?? shared.entries;
  const total = useMemo(
    () => (targetId ? proposalEntriesFor(targetId, source).length : 0),
    [source, targetId],
  );
  const unseen = useUnseenProposals(targetId, total);
  return (
    <span className="relative inline-flex items-center justify-center">
      <GitPullRequestArrow size={18} />
      {unseen > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
      )}
    </span>
  );
}

// ──────────────────────────────────────────────
// 本体
// ──────────────────────────────────────────────

/** note-app の取り込み処理へ渡すもの。実際の適用は呼び出し側が行う */
export type AdoptProposalRequest = {
  /** 提案の共有エントリ id（来歴の `shared:<id>` になる） */
  proposalId: string;
  /** 提案の題名（トーストと版の名前に使える） */
  proposalTitle: string;
  /** 比べた元（＝いま開いているノートの本文）。差分と同じ版を渡す */
  mine: GraphiumDocument;
  /** 提案の本文 */
  theirs: GraphiumDocument;
  diff: ProposalDiff;
  /** 選ばれた項目 id */
  selected: Set<string>;
};

export type AdoptProposalOutcome = {
  applied: number;
  skipped: string[];
};

type ReadEntryBody = (entry: SharedEntry) => Promise<{ body: Uint8Array; verified: boolean }>;

export type NoteProposalsPanelProps = {
  /** 対象＝このノートの共有エントリ id（doc.sharedRef.id） */
  targetId: string;
  /** 対象の現在の hash（既読の控えに使う） */
  targetHash: string;
  /** いま開いているノートの最新本文を組み立てる（note-app の buildDocument） */
  resolveMine: () => Promise<GraphiumDocument>;
  /** 選んだ変更を取り込む。null なら読むだけ（取り込みボタンを出さない） */
  onAdopt?: (request: AdoptProposalRequest) => Promise<AdoptProposalOutcome>;
  /** 差分項目のクリックで本文の該当ブロックをハイライトする */
  onHighlightBlock?: (blockId: string | null) => void;
  /** 提案を全画面で開く（本文をまるごと読みたいとき） */
  onOpenProposalFull?: (sharedId: string) => void;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
  /** DI: 本文の取り寄せ（既定は共有ストアの LRU 付きリーダ） */
  readBody?: ReadEntryBody;
  /** DI: 基準版 blob の取り寄せ（既定は blob root から読む） */
  readBlob?: (ref: BlobRef) => Promise<Uint8Array>;
  /**
   * 開いた直後にこの提案を選んだ状態にする（§25b B-6）。
   * 共有ライブラリの全画面から「このノートに取り込む」で来たときの着地点
   * —— 一覧に落として「どれだっけ」を探させない。
   */
  initialProposalId?: string;
  /**
   * initialProposalId を開いたことの通知。呼び出し側はこれを受けて指定を落とす。
   * 落とさないと、一覧へ戻ったあとに同じ提案が開き直る。
   */
  onInitialProposalOpened?: () => void;
};

/** 状態ごとの色。NoteProposalStatusBadge と揃える */
const STATUS_CLASS: Record<ProposalStatus, string> = {
  open: "bg-primary/10 text-primary",
  adopted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  stale: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  missing: "text-muted-foreground",
};

function formatDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleString();
}

/** 紐付け先ブロックへスクロールする（ハイライトは親の highlightBlockIds が担う） */
function scrollToBlock(blockId: string): void {
  const el = document.querySelector(
    `[data-id="${blockId}"][data-node-type="blockOuter"]`,
  ) as HTMLElement | null;
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function NoteProposalsPanel({
  targetId,
  targetHash,
  resolveMine,
  onAdopt,
  onHighlightBlock,
  onOpenProposalFull,
  entries,
  readBody,
  readBlob,
  initialProposalId,
  onInitialProposalOpened,
}: NoteProposalsPanelProps) {
  const t = useT();
  const shared = useSharedLibrary();
  const allEntries = entries ?? shared.entries;

  const proposals = useMemo(
    () => proposalEntriesFor(targetId, allEntries),
    [allEntries, targetId],
  );

  // タブを開いた時点と、開いている間に増えた分を既読にする
  useEffect(() => {
    markProposalsSeen(targetId, targetHash, proposals.length);
    notifySeenChanged();
  }, [targetId, targetHash, proposals.length]);

  const [openId, setOpenId] = useState<string | null>(initialProposalId ?? null);
  const openEntry = useMemo(
    () => proposals.find((e) => e.id === openId) ?? null,
    [proposals, openId],
  );

  // 外から「この提案を開いて」と言われたとき（共有ライブラリの全画面から来た経路）。
  // 開いたら呼び出し側に知らせて指定を落としてもらう —— 指定が残っていると
  // 「一覧へ戻る」を押した直後にまた同じ提案が開く
  const onInitialOpenedRef = useRef(onInitialProposalOpened);
  onInitialOpenedRef.current = onInitialProposalOpened;
  useEffect(() => {
    if (!initialProposalId) return;
    setOpenId(initialProposalId);
    onInitialOpenedRef.current?.();
  }, [initialProposalId]);

  // タブを閉じる・別のノートへ移るときにハイライトを残さない
  const onHighlightRef = useRef(onHighlightBlock);
  onHighlightRef.current = onHighlightBlock;
  useEffect(() => {
    return () => {
      onHighlightRef.current?.(null);
    };
  }, []);

  if (proposals.length === 0) {
    return (
      <div className="flex-1 overflow-auto px-4 py-6 text-xs text-muted-foreground leading-relaxed">
        {t("proposal.adopt.empty")}
      </div>
    );
  }

  if (openEntry) {
    return (
      <ProposalDetail
        key={openEntry.id}
        entry={openEntry}
        entries={allEntries}
        resolveMine={resolveMine}
        onAdopt={onAdopt}
        onHighlightBlock={onHighlightBlock}
        onOpenProposalFull={onOpenProposalFull}
        onBack={() => {
          onHighlightRef.current?.(null);
          setOpenId(null);
        }}
        readBody={readBody}
        readBlob={readBlob}
      />
    );
  }

  return (
    <div className="flex-1 overflow-auto px-3 py-3 space-y-2" data-testid="note-proposals-panel">
      <p className="text-[11px] text-muted-foreground leading-relaxed px-1">
        {t("proposal.adopt.listHint")}
      </p>
      <ul className="space-y-1.5">
        {proposals.map((entry) => {
          const extra = readProposalExtra(entry);
          const status = proposalStatus(entry, null, allEntries);
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setOpenId(entry.id)}
                data-testid={`note-proposal-row-${entry.id}`}
                className="w-full text-left rounded-md border border-border bg-background px-3 py-2 space-y-1 hover:border-primary/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground truncate">
                    {extra?.title || entry.id}
                  </span>
                  <span
                    className={cn(
                      "ml-auto text-[9px] px-1 py-0.5 rounded shrink-0",
                      STATUS_CLASS[status],
                    )}
                    title={t(`proposal.status.${status}Hint`)}
                  >
                    {t(`proposal.status.${status}`)}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {entry.author?.name ?? ""} · {formatDate(entry.updated_at)}
                </div>
                {extra?.message && (
                  <p className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                    {extra.message}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────
// 1 件の詳細（差分 + 取り込み）
// ──────────────────────────────────────────────

function ProposalDetail({
  entry,
  entries,
  resolveMine,
  onAdopt,
  onHighlightBlock,
  onOpenProposalFull,
  onBack,
  readBody,
  readBlob,
}: {
  entry: SharedEntry;
  entries: readonly SharedEntry[];
  resolveMine: () => Promise<GraphiumDocument>;
  onAdopt?: (request: AdoptProposalRequest) => Promise<AdoptProposalOutcome>;
  onHighlightBlock?: (blockId: string | null) => void;
  onOpenProposalFull?: (sharedId: string) => void;
  onBack: () => void;
  readBody?: ReadEntryBody;
  readBlob?: (ref: BlobRef) => Promise<Uint8Array>;
}) {
  const t = useT();
  const extra = useMemo(() => readProposalExtra(entry), [entry]);

  // 提案の本文（theirs）。封筒とは別ファイルなので取り寄せる
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const read = readBody ?? readSharedEntryBody;
    void read(entry)
      .then(({ body: bytes }) => {
        if (live) setBody(new TextDecoder().decode(bytes));
      })
      .catch((e: unknown) => {
        if (live) setBodyError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [entry, readBody]);

  // 比べる元（mine）はいま開いているノートの最新本文。取り込んだあとは組み直して
  // 差分を作り直す（取り込んだ項目が消え、残りだけになる）
  const [mine, setMine] = useState<GraphiumDocument | null>(null);
  const [mineGeneration, setMineGeneration] = useState(0);
  const resolveMineRef = useRef(resolveMine);
  resolveMineRef.current = resolveMine;
  useEffect(() => {
    let live = true;
    void resolveMineRef
      .current()
      .then((doc) => {
        if (live) setMine(doc);
      })
      .catch(() => {
        if (live) setMine(null);
      });
    return () => {
      live = false;
    };
  }, [mineGeneration]);

  const state = useProposalDiff({
    entry,
    body,
    entries,
    mine,
    readEntryBody: readBody,
    readBlob,
  });

  // 選択は差分が作り直されるたびに既定へ戻す（残った項目の既定選択になる）。
  // useEffect（コミット後）ではなくレンダー中に戻すこと —— 差分が出た最初のコミットで
  // チェックボックスが「全部外れた状態」で一瞬描かれ、そのあと既定が入る、という
  // ちらつきになる。取り込みボタンも同じ一瞬だけ disabled のままになる
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const diff = state.diff;
  const [selectionFor, setSelectionFor] = useState<typeof diff>(null);
  if (selectionFor !== diff) {
    setSelectionFor(diff);
    setSelected(defaultProposalSelection(diff));
  }

  const handleToggle = useCallback(
    (id: string) => {
      setSelected((prev) => (diff ? toggleProposalSelection(diff, prev, id) : prev));
    },
    [diff],
  );

  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AdoptProposalOutcome | null>(null);
  const selectedCount = countSelected(diff, selected);

  const handleAdopt = useCallback(async () => {
    if (!onAdopt || !diff || !mine || !body || selectedCount === 0) return;
    let theirs: GraphiumDocument | null = null;
    try {
      theirs = JSON.parse(body) as GraphiumDocument;
    } catch {
      theirs = null;
    }
    if (!theirs) return;
    setBusy(true);
    try {
      const result = await onAdopt({
        proposalId: entry.id,
        proposalTitle: extra?.title ?? "",
        mine,
        theirs,
        diff,
        selected: new Set(selected),
      });
      setOutcome(result);
      // 取り込み後の本文で差分を作り直す
      setMineGeneration((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, [onAdopt, diff, mine, body, selectedCount, entry.id, extra, selected]);

  return (
    <div className="flex flex-col h-full" data-testid="note-proposal-detail">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
        >
          ← {t("proposal.adopt.back")}
        </button>
        <span className="text-xs font-medium text-foreground truncate">
          {extra?.title || entry.id}
        </span>
        {onOpenProposalFull && (
          <button
            type="button"
            onClick={() => onOpenProposalFull(entry.id)}
            className="ml-auto text-[11px] text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
          >
            {t("proposal.adopt.openFull")}
          </button>
        )}
      </div>

      {extra?.message && (
        <p className="px-4 pt-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-words shrink-0">
          {extra.message}
        </p>
      )}

      <ProposalDiffPanel
        diff={state.diff}
        summary={state.summary}
        hasBase={state.hasBase}
        loading={state.loading}
        error={bodyError ?? state.error}
        targetMissing={state.targetMissing}
        onJumpToBlock={
          onHighlightBlock
            ? (blockId) => {
                onHighlightBlock(blockId);
                scrollToBlock(blockId);
              }
            : undefined
        }
        selectable={!!onAdopt}
        selected={selected}
        onToggleSelect={handleToggle}
      />

      {onAdopt && (
        <div className="px-3 py-2 border-t border-border shrink-0 space-y-1">
          {outcome && outcome.skipped.length > 0 && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              {t("proposal.adopt.skipped", { count: String(outcome.skipped.length) })}
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleAdopt()}
            disabled={busy || selectedCount === 0 || !mine || !body}
            data-testid="note-proposal-adopt"
            className="w-full px-3 py-1.5 text-xs font-semibold rounded-md border border-primary bg-primary/5 text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
          >
            {busy
              ? t("proposal.adopt.running")
              : t("proposal.adopt.submit", { count: String(selectedCount) })}
          </button>
        </div>
      )}
    </div>
  );
}
