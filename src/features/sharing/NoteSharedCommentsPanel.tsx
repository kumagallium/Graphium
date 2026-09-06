// ノート編集画面（学生側）の右パネル「コメント」タブの中身。
//
// 何をする場所か:
//   自分が共有したノートに付いたコメントを読み、返信し、自分でもコメントを足す。
//   先生側（Library の詳細パネル）と同じ SharedCommentsThread を描くので、
//   同じスレッドがどちらの画面でも同じ形で見える。
//
// 守っていること:
//   - 共有ストアのスナップショット（useSharedLibrary）から組み立てる。ここで
//     フォルダを直接読みに行かない（読み出しの入口を増やすと版がずれる）
//   - エディタ本体には常時の印を出さない（#587 の決定）。対応関係は
//     「カード → ブロック」の向きだけ。ハイライトは履歴・メモタブと同じ
//     highlightBlockIds 機構を親から借りる（onHighlightBlock）
//   - 書き込みのあとは notifySharedLibraryChanged() で読み直す。共有ストレージは
//     他人も書く場所なので、書いた本人の画面も「読み直した結果」を見る
//   - 既読の控え（markSeen）は手元の localStorage だけ。共有側には書かない
//
// 設計詳細: docs/internal/team-shared-storage-design.md §21 E

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { AuthorIdentity } from "../document-provenance/types";
import type { SharedEntry } from "../../lib/storage/shared";
import {
  commentEntriesFor,
  commentsFor,
  createComment,
  deleteComment,
  editComment,
  loadCommentTexts,
  type SharedCommentProvider,
} from "./shared-comments";
import { SharedCommentsThread } from "./SharedCommentsThread";
import { notifySharedLibraryChanged, useSharedLibrary } from "./shared-library-store";
import { markSeen, newCommentCount } from "./shared-seen";

// ── 既読の控えの変化を伝える（モジュール内だけの購読） ──
// markSeen は localStorage を書くだけなので、そのままではヘッダのバッジが
// 「新着」を出したまま残る。控えを書いた側から明示的に知らせて、同じ画面の
// バッジ・レールのドットをその場で消す。
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

/**
 * 対象に付いたコメントの件数と、前回見たときからの増分。
 *
 * バッジ・レールのドットがそれぞれ自前で購読することで、ノート編集画面の本体を
 * 共有ストアの更新に巻き込まずに済む（本体が再描画されるとエディタごと重い）。
 */
function useCommentCounts(
  targetId: string | undefined,
  entries?: readonly SharedEntry[],
): { total: number; unseen: number } {
  const shared = useSharedLibrary();
  const source = entries ?? shared.entries;
  const total = useMemo(
    () => (targetId ? commentEntriesFor(targetId, source).length : 0),
    [source, targetId],
  );
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const recompute = () => setUnseen(targetId ? newCommentCount(targetId, total) : 0);
    recompute();
    return subscribeSeen(recompute);
  }, [targetId, total]);
  return { total, unseen };
}

/** 紐付け先ブロックへスクロールする（ハイライトは親の highlightBlockIds が担う） */
function scrollToBlock(blockId: string) {
  const el = document.querySelector(
    `[data-id="${blockId}"][data-node-type="blockOuter"]`,
  ) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

export type NoteSharedCommentsPanelProps = {
  /** 対象＝このノートの共有エントリ id（doc.sharedRef.id） */
  targetId: string;
  /** 対象の現在の hash（doc.sharedRef.hash）。古い版のコメントの畳み判定に使う */
  targetHash: string;
  /** 共有ルート（書き込み先） */
  root: string;
  /** 自分の identity。null なら読むだけ（投稿できない案内を出す） */
  author: AuthorIdentity | null;
  /**
   * カードのクリックで該当ブロックをハイライトする。blockId でハイライト、
   * null で解除。親（NoteEditorInner）がメモ・履歴タブと同じ機構で描画する。
   */
  onHighlightBlock?: (blockId: string | null) => void;
  /**
   * ¶ チップのライブ解決。現在のエディタからブロックの表示ラベルを返す。
   * null（削除済み等）のときは付けた時点の抜粋にフォールバックする。
   */
  resolveBlockLabel?: (blockId: string) => string | null;
  /**
   * DI: コメント封筒を含む共有エントリ一覧。既定は共有ストアのスナップショット。
   * Storybook / テストのように共有フォルダを読めない場所で差し替える
   * （SharedEntryComments と同じ差し替え口に揃えてある）。
   */
  entries?: readonly SharedEntry[];
  /** DI: 本文の取り寄せ（既定は共有ストアの LRU 付きリーダ） */
  readBody?: (entry: SharedEntry) => Promise<{ body: Uint8Array; verified: boolean }>;
  /** DI: 書き込み先（既定は共有ルートの LocalFolderSharedProvider） */
  provider?: SharedCommentProvider;
};

export function NoteSharedCommentsPanel({
  targetId,
  targetHash,
  root,
  author,
  onHighlightBlock,
  resolveBlockLabel,
  entries,
  readBody,
  provider,
}: NoteSharedCommentsPanelProps) {
  const t = useT();
  const shared = useSharedLibrary();
  const allEntries = entries ?? shared.entries;

  const commentEntries = useMemo(
    () => commentEntriesFor(targetId, allEntries),
    [allEntries, targetId],
  );
  // 本文は封筒とは別のファイルなので取り寄せる。版（id|hash）が変わったときだけ
  // 読み直す（スナップショットが差し替わるたびに読むと同じ中身を何度も読む）
  const versionKey = commentEntries.map((e) => `${e.id}|${e.hash}`).join(",");
  const [texts, setTexts] = useState<Map<string, string>>(new Map());
  const entriesRef = useRef(commentEntries);
  entriesRef.current = commentEntries;
  useEffect(() => {
    let live = true;
    void loadCommentTexts(entriesRef.current, readBody).then((m) => {
      if (live) setTexts(m);
    });
    return () => {
      live = false;
    };
  }, [versionKey, readBody]);

  const threads = useMemo(
    () => commentsFor(targetId, allEntries, texts),
    [targetId, allEntries, texts],
  );

  // タブを開いた時点（＝この部品がマウントされた時点）と、開いている間に
  // 増えた分を既読にする。開いたまま届いたコメントに「新着」を出し続けても
  // 意味がない
  useEffect(() => {
    markSeen(targetId, targetHash, commentEntries.length);
    notifySeenChanged();
  }, [targetId, targetHash, commentEntries.length]);

  // 選択中カードの紐付けブロック（エディタ側でハイライト表示中）
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const onHighlightBlockRef = useRef(onHighlightBlock);
  onHighlightBlockRef.current = onHighlightBlock;
  // タブ切替・パネル閉じでハイライトを残さない
  useEffect(() => {
    return () => {
      onHighlightBlockRef.current?.(null);
    };
  }, []);

  const handleJumpToBlock = useCallback(
    (blockId: string) => {
      const highlight = onHighlightBlockRef.current;
      if (!highlight) return;
      if (selectedBlockId === blockId) {
        // 再クリックで解除（メモタブと同じ作法）
        setSelectedBlockId(null);
        highlight(null);
        return;
      }
      setSelectedBlockId(blockId);
      highlight(blockId);
      scrollToBlock(blockId);
    },
    [selectedBlockId],
  );

  const anchorLabel = useCallback(
    (blockId: string, fallback: string) => resolveBlockLabel?.(blockId) ?? fallback,
    [resolveBlockLabel],
  );

  /** 書き込み 3 種の共通処理。失敗は握りつぶさず知らせ、成功したら読み直す */
  const runWrite = useCallback(
    async (
      action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    ): Promise<void> => {
      const result = await action();
      if (!result.ok) {
        window.alert(t("comment.failed") + ": " + result.error);
        return;
      }
      notifySharedLibraryChanged();
    },
    [t],
  );

  const handleCreate = useCallback(
    async (text: string) => {
      if (!author) return;
      await runWrite(() =>
        createComment({
          root,
          author,
          target: targetId,
          targetHash,
          text,
          ...(provider ? { __provider: provider } : {}),
        }),
      );
    },
    [author, provider, root, runWrite, targetHash, targetId],
  );

  const handleReply = useCallback(
    async (rootId: string, text: string) => {
      if (!author) return;
      await runWrite(() =>
        createComment({
          root,
          author,
          target: targetId,
          targetHash,
          text,
          parentId: rootId,
          ...(provider ? { __provider: provider } : {}),
        }),
      );
    },
    [author, provider, root, runWrite, targetHash, targetId],
  );

  const handleEdit = useCallback(
    async (id: string, text: string) => {
      if (!author) return;
      await runWrite(() =>
        editComment({ root, author, id, text, ...(provider ? { __provider: provider } : {}) }),
      );
    },
    [author, provider, root, runWrite],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!author) return;
      // スレッド部品は確認を出さない。消したコメントは戻せないのでここで一度聞く
      if (!window.confirm(t("comment.deleteConfirm"))) return;
      await runWrite(() =>
        deleteComment({ root, author, id, ...(provider ? { __provider: provider } : {}) }),
      );
    },
    [author, provider, root, runWrite, t],
  );

  return (
    <SharedCommentsThread
      threads={threads}
      currentHash={targetHash}
      currentIdentity={author}
      anchorLabel={anchorLabel}
      onJumpToBlock={onHighlightBlock ? handleJumpToBlock : undefined}
      onReply={handleReply}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onCreate={handleCreate}
      composerDisabledReason={author ? undefined : t("comment.identityRequired")}
    />
  );
}

/**
 * ヘッダの共有済みバッジの横に出す「コメント N」。新着があれば強調する。
 * コメントがまだ 1 件も無いときは何も出さない（0 の表示は場所を取るだけ）。
 */
export function NoteSharedCommentsBadge({
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
  const { total, unseen } = useCommentCounts(targetId, entries);
  if (total === 0) return null;
  const label = t("comment.countLabel", { count: String(total) });
  return (
    <button
      type="button"
      onClick={onClick}
      title={unseen > 0 ? t("comment.newBadge", { count: String(unseen) }) : label}
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-md shrink-0 inline-flex items-center gap-1 transition-colors",
        unseen > 0
          ? "bg-primary/15 text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground",
        onClick ? "cursor-pointer" : "cursor-default",
      )}
    >
      <MessageSquare size={10} />
      {label}
      {unseen > 0 && <span>{t("comment.newBadge", { count: String(unseen) })}</span>}
    </button>
  );
}

/**
 * 右レールの「コメント」アイコン。新着があるときだけ小さなドットを重ねる
 * （パネルを閉じていても届いたことが分かる）。
 */
export function NoteSharedCommentsRailIcon({
  targetId,
  entries,
}: {
  targetId?: string;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
}) {
  const { unseen } = useCommentCounts(targetId, entries);
  return (
    <span className="relative inline-flex items-center justify-center">
      <MessageSquare size={18} />
      {unseen > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
      )}
    </span>
  );
}
