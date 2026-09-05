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
}: SharedEntryCommentsProps) {
  const uiT = useT();
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

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/20 text-xs font-semibold text-foreground">
        {uiT("comment.countLabel", { count: String(total) })}
      </div>
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
      />
    </div>
  );
}
