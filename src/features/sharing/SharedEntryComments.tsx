// 共有エントリ 1 件に付いたコメントの節（詳細パネル / ノートのコメントタブの中身）。
//
// なぜ表示部品（SharedCommentsThread）と分けるか:
//   スレッドの見た目は 2 か所で共通だが、「どこから読むか・どこへ書くか」は
//   画面の事情（共有ルート・identity・段落の指定）で変わる。読み書きと既読の
//   記録をこの層に集め、表示部品は副作用を持たないまま保つ。
//
// 守っていること:
//   - 本文（body）は封筒には入っていないので、封筒の版（id|hash）が変わったときだけ
//     取り寄せ直す。毎レンダーで読みに行かない
//   - 書いた後は notifySharedLibraryChanged() を呼ぶ（自分の画面にも即反映）。
//     共有ストアの再読込を待たずに楽観更新はしない —— 書けたかどうかは
//     共有フォルダを読み直した結果を正とする
//   - 既読（graphium-shared-seen）は手元だけ。共有フォルダには書かない
//   - identity 未登録では書けない。入力欄を出さず理由を出す（黙って失敗させない）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §21 A / D / E

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { AuthorIdentity } from "../document-provenance/types";
import type { SharedEntry } from "../../lib/storage/shared";
import { useT } from "../../i18n";
import {
  commentEntriesFor,
  commentsFor,
  countCommentsFor,
  createComment,
  deleteComment,
  editComment,
  loadCommentTexts,
  type SharedCommentProvider,
} from "./shared-comments";
import {
  SharedCommentsThread,
  type SharedCommentAnchor,
} from "./SharedCommentsThread";
import { markSeen } from "./shared-seen";
import { notifySharedLibraryChanged, useSharedLibrary } from "./shared-library-store";

/** loadCommentTexts に渡す本文リーダ（既定は共有ストア経由） */
type CommentBodyReader = (
  entry: SharedEntry,
) => Promise<{ body: Uint8Array; verified: boolean }>;

export type SharedEntryCommentsProps = {
  /** 対象の共有エントリ id（Library は entry.id、ノート編集画面は sharedRef.id） */
  targetId: string;
  /** 対象の現在の hash。これと違う版に付いたコメントは古い版として畳まれる */
  targetHash: string;
  /** 共有ルート。空なら書き込めない（表示だけ） */
  sharedRoot: string;
  /** 自分の identity。null なら投稿できない */
  currentIdentity: AuthorIdentity | null;
  /** ¶ チップのライブ解決（現在の本文から抜粋を出す） */
  anchorLabel?: (blockId: string, fallback: string) => string;
  /** カード / ¶ チップのクリックで該当ブロックへ飛ばす */
  onJumpToBlock?: (blockId: string) => void;
  /** 段落を選んでいるとき（入力欄の上に「¶ 抜粋」を出す） */
  pendingAnchor?: SharedCommentAnchor | null;
  onClearAnchor?: () => void;
  /**
   * DI: コメント封筒を含む共有エントリ一覧。既定は共有ストアのスナップショット。
   * Storybook / テストのように共有フォルダを読めない場所で差し替える。
   */
  entries?: readonly SharedEntry[];
  /** DI: 本文の取り寄せ（既定は共有ストアの LRU 付きリーダ） */
  readBody?: CommentBodyReader;
  /** DI: 書き込み先（既定は共有ルートの LocalFolderSharedProvider） */
  provider?: SharedCommentProvider;
  /**
   * 既読を記録したことの通知。控えは localStorage なので、一覧側は
   * これを合図にしないと「新着」の印が次の再描画まで消えない。
   */
  onSeenRecorded?: () => void;
  /**
   * 並べ方。既定の "stacked" は従来どおり（ノート右パネル・スクロールに流す節）。
   * "docked" は Library 詳細パネルの下部に固定する形で、見出し行で一覧を開閉でき、
   * 一覧は自前の高さ上限内でスクロールする。
   */
  layout?: "stacked" | "docked";
  /** docked のときの一覧の最大高さ（既定 40vh） */
  threadsMaxHeight?: string;
};

export function SharedEntryComments({
  targetId,
  targetHash,
  sharedRoot,
  currentIdentity,
  anchorLabel,
  onJumpToBlock,
  pendingAnchor,
  onClearAnchor,
  entries,
  readBody,
  provider,
  onSeenRecorded,
  layout = "stacked",
  threadsMaxHeight,
}: SharedEntryCommentsProps) {
  const uiT = useT();
  const docked = layout === "docked";
  // ドックの開閉。既定は開。画面を閉じたら忘れる（永続化しない）
  const [threadsOpen, setThreadsOpen] = useState(true);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // 段落を選んだら、そのまま書き始められる状態にする（ドックを開いて入力欄へ移す）。
  // blockId で見る: 抜粋の文字列だけが変わったときに開き直さないため
  const pendingBlockId = pendingAnchor?.blockId ?? null;
  // 段落を選んだら入力欄へフォーカスを移す。一覧の開閉は触らない —
  // 入力欄は畳んでいても見えているし、ここで一覧を開くとプレビューが縮んで
  // 選んだ段落（強調表示）が視界から消える。
  useEffect(() => {
    if (!docked || !pendingBlockId) return;
    // フォーカス移動は commit の外へ逃がす。effect の中で同期的に focus() を呼ぶと、
    // BlockNote 側の focus ハンドラが React の描画を再入させ
    // 「Should not already be working」で落ちる（Storybook で実測）
    const timer = window.setTimeout(() => composerRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [docked, pendingBlockId]);
  const snapshot = useSharedLibrary();
  const allEntries = entries ?? snapshot.entries;

  const commentEntries = useMemo(
    () => commentEntriesFor(targetId, allEntries),
    [targetId, allEntries],
  );
  // 版が変わったときだけ本文を読み直すための鍵（封筒の並びと hash で作る）
  const versionKey = useMemo(
    () => commentEntries.map((e) => `${e.id}|${e.hash}`).join(","),
    [commentEntries],
  );

  const [texts, setTexts] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    void loadCommentTexts(commentEntries, readBody).then((m) => {
      if (live) setTexts(m);
    });
    return () => {
      live = false;
    };
    // commentEntries は毎回新しい配列になるので、中身の版（versionKey）で判定する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionKey, readBody]);

  const threads = useMemo(
    () => commentsFor(targetId, allEntries, texts),
    [targetId, allEntries, texts],
  );

  // 「新着コメント N」の基準になる通し数（返信も含む）
  const total = useMemo(
    () => countCommentsFor(targetId, allEntries),
    [targetId, allEntries],
  );

  // 通知の関数は毎レンダー作り直されうるので、記録の条件に混ぜない（ref 経由で最新を呼ぶ）
  const onSeenRecordedRef = useRef(onSeenRecorded);
  onSeenRecordedRef.current = onSeenRecorded;

  // この節が見えている＝読んだ、とみなして控えを更新する。
  // 数や版が動いたら書き直す（開いている間に増えた分は新着にしない）
  useEffect(() => {
    if (!targetId) return;
    markSeen(targetId, targetHash, total);
    onSeenRecordedRef.current?.();
  }, [targetId, targetHash, total]);

  const [actionError, setActionError] = useState<string | null>(null);

  /** 書き込み後の共通処理。失敗はその場に文言で出す（黙って消さない） */
  const settle = useCallback(
    (result: { ok: true } | { ok: false; error: string }) => {
      if (result.ok) {
        setActionError(null);
        notifySharedLibraryChanged();
        return;
      }
      setActionError(result.error);
    },
    [],
  );

  const handleCreate = useCallback(
    async (text: string, anchor?: SharedCommentAnchor) => {
      if (!currentIdentity) return;
      settle(
        await createComment({
          root: sharedRoot,
          author: currentIdentity,
          target: targetId,
          targetHash,
          text,
          ...(anchor ? { blockId: anchor.blockId, blockText: anchor.blockText } : {}),
          ...(provider ? { __provider: provider } : {}),
        }),
      );
      // 付け先の指定は 1 通ごとに使い切る（次のコメントに引きずらない）
      onClearAnchor?.();
    },
    [currentIdentity, sharedRoot, targetId, targetHash, provider, onClearAnchor, settle],
  );

  const handleReply = useCallback(
    async (rootId: string, text: string) => {
      if (!currentIdentity) return;
      settle(
        await createComment({
          root: sharedRoot,
          author: currentIdentity,
          target: targetId,
          targetHash,
          text,
          parentId: rootId,
          ...(provider ? { __provider: provider } : {}),
        }),
      );
    },
    [currentIdentity, sharedRoot, targetId, targetHash, provider, settle],
  );

  const handleEdit = useCallback(
    async (id: string, text: string) => {
      if (!currentIdentity) return;
      settle(
        await editComment({
          root: sharedRoot,
          author: currentIdentity,
          id,
          text,
          ...(provider ? { __provider: provider } : {}),
        }),
      );
    },
    [currentIdentity, sharedRoot, provider, settle],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!currentIdentity) return;
      settle(
        await deleteComment({
          root: sharedRoot,
          author: currentIdentity,
          id,
          ...(provider ? { __provider: provider } : {}),
        }),
      );
    },
    [currentIdentity, sharedRoot, provider, settle],
  );

  // 書けない理由（identity 未登録 / 共有ルート未設定）。訳してから渡す
  const disabledReason = !currentIdentity?.email
    ? uiT("comment.identityRequired")
    : !sharedRoot
      ? uiT("comment.noSharedRoot")
      : undefined;

  const countLabel = uiT("comment.countLabel", { count: String(total) });

  return (
    <div
      className={
        docked
          ? "flex flex-col min-h-0 shrink-0 border-t border-border bg-background"
          : "border border-border rounded-lg overflow-hidden"
      }
    >
      {docked ? (
        // ドックの見出し行は一覧の開閉ボタンを兼ねる（入力欄は畳んでも残る）
        <button
          type="button"
          onClick={() => setThreadsOpen((v) => !v)}
          aria-expanded={threadsOpen}
          title={threadsOpen ? uiT("comment.collapseList") : uiT("comment.expandList")}
          className="w-full px-3 py-2 flex items-center justify-between gap-2 bg-muted/20 text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors"
        >
          <span>{countLabel}</span>
          {threadsOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      ) : (
        <div className="px-3 py-2 border-b border-border bg-muted/20 text-xs font-semibold text-foreground">
          {countLabel}
        </div>
      )}
      {actionError && (
        <div className="px-3 py-2 border-b border-border text-[11px] text-destructive">
          {uiT("comment.actionFailed", { error: actionError })}
        </div>
      )}
      <SharedCommentsThread
        threads={threads}
        currentHash={targetHash}
        currentIdentity={currentIdentity}
        anchorLabel={anchorLabel}
        onJumpToBlock={onJumpToBlock}
        onCreate={handleCreate}
        onReply={handleReply}
        onEdit={handleEdit}
        onDelete={handleDelete}
        pendingAnchor={pendingAnchor}
        onClearAnchor={onClearAnchor}
        composerDisabledReason={disabledReason}
        layout={layout}
        threadsOpen={threadsOpen}
        composerRef={composerRef}
        {...(threadsMaxHeight ? { threadsMaxHeight } : {})}
      />
    </div>
  );
}
