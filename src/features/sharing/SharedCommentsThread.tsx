// 共有コメントのスレッド UI（表示専用）。
//
// なぜ 1 つの部品にまとめたか:
//   同じスレッドを 2 か所（Library の詳細パネル＝先生側、ノート編集画面の
//   コメントタブ＝学生側）で見せる。見た目や「古い版の畳み方」が画面ごとに
//   ずれると、同じデータが違う話に見えてしまう。書き込み・読み出しは親に任せ、
//   ここは受け取ったスレッドを描くことだけを担う。
//
// 守っていること:
//   - 表示専用。共有ストレージにも localStorage にも触らない（副作用は props 経由）
//   - 「解決」ボタンは持たない。対象の hash が変われば古い版のコメントが自動で畳まれる
//   - エディタ本体には印を出さない（#587 の決定）。段落との対応は
//     「カード → ブロック」の向きだけ（onJumpToBlock）
//   - 見た目はノートのメモタブ（NoteMemosSection / MemoComposer）に合わせる

import { useMemo, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { CornerDownRight, MessageSquare, Pilcrow, X } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { formatDateTime } from "../../lib/format-datetime";
import { useT } from "../../i18n";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  commentSummary,
  splitByTargetVersion,
  type CommentThread,
  type SharedComment,
} from "./shared-comments";

export type SharedCommentAnchor = { blockId: string; blockText: string };

export type SharedCommentsThreadProps = {
  /** 対象に付いたスレッド（commentsFor の戻り値をそのまま渡す） */
  threads: CommentThread[];
  /** 対象エントリの現在の hash。これと違う版に付いたスレッドは畳む */
  currentHash: string;
  /** 自分の identity。null なら投稿できない（自分のコメントの判定にも使う） */
  currentIdentity: AuthorIdentity | null;
  /**
   * ¶ チップの表示ラベルを現在の本文から解決する。ブロックが消えていれば
   * fallback（付けた時点の抜粋）をそのまま返す想定。
   */
  anchorLabel?: (blockId: string, fallback: string) => string;
  /** カード / チップのクリックで該当ブロックへ飛ばす */
  onJumpToBlock?: (blockId: string) => void;
  onReply: (rootId: string, text: string) => Promise<void>;
  onEdit: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreate: (text: string, anchor?: SharedCommentAnchor) => Promise<void>;
  /** 段落を選んでいるとき。入力欄の上に「¶ 抜粋」を出す */
  pendingAnchor?: SharedCommentAnchor | null;
  onClearAnchor?: () => void;
  /**
   * 投稿できない理由（identity 未登録など）。渡されると入力欄の代わりに
   * この文言を出す。文言は呼び出し側で訳しておく（画面ごとに導線が違うため）。
   */
  composerDisabledReason?: string;
  /**
   * 並べ方。
   * - "stacked"（既定）: 節としてそのまま縦に積む（ノート右パネル・従来の見え方）
   * - "docked": パネル下部に固定する前提。スレッド一覧が自前の高さ内でスクロールし、
   *   threadsOpen=false のときは入力欄だけを残して一覧を畳む
   */
  layout?: "stacked" | "docked";
  /** docked のときの一覧の開閉（既定は開） */
  threadsOpen?: boolean;
  /** docked のときの一覧の最大高さ（既定 40vh）。パネルの高さを食い潰さないための上限 */
  threadsMaxHeight?: string;
  /** 新規入力欄の textarea。段落を選んだときに親からフォーカスを移すために渡す */
  composerRef?: MutableRefObject<HTMLTextAreaElement | null>;
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  maxWidth: "100%",
  padding: "1px 6px",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 9999,
  color: "var(--color-text-tertiary)",
  fontSize: 10,
};

const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-text-tertiary)",
  cursor: "pointer",
  padding: 0,
  fontSize: 10,
  fontFamily: "inherit",
};

/**
 * 送信できるテキスト入力（新規・返信・編集で共用）。
 * Enter で送信・Shift+Enter で改行。IME 確定の Enter は共通ガードで弾く。
 */
function CommentInput({
  placeholder,
  initialText = "",
  autoFocus,
  submitLabel,
  onSubmit,
  onCancel,
  textareaRef,
}: {
  placeholder: string;
  initialText?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
  /** 外からフォーカスを当てるための ref（ドック時の段落クリック） */
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const t = useT();
  const [text, setText] = useState(initialText);
  const [submitting, setSubmitting] = useState(false);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || isImeKey(e)) return;
    e.preventDefault();
    void submit();
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        {...compositionHandlers}
        placeholder={placeholder}
        rows={2}
        disabled={submitting}
        className="
          w-full resize-none rounded-lg border border-border-subtle bg-background
          px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none
          placeholder:text-text-tertiary
          focus:border-ring focus:ring-2 focus:ring-ring/20
          disabled:opacity-60
        "
        style={{ fontFamily: "inherit" }}
      />
      {(submitLabel || onCancel) && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          {onCancel && (
            <button type="button" onClick={onCancel} style={linkButtonStyle}>
              {t("comment.cancel")}
            </button>
          )}
          {submitLabel && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || text.trim() === ""}
              style={{ ...linkButtonStyle, color: "var(--color-foreground)" }}
            >
              {submitLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** ¶ チップ（段落に付いたコメントの目印）。押すと該当ブロックへ飛ぶ */
function AnchorChip({
  label,
  onJump,
  title,
}: {
  label: string;
  onJump?: () => void;
  title?: string;
}) {
  return (
    <span
      style={{ ...chipStyle, margin: "0 0 4px", cursor: onJump ? "pointer" : undefined }}
      title={title}
      onClick={
        onJump
          ? (e) => {
              e.stopPropagation();
              onJump();
            }
          : undefined
      }
    >
      <Pilcrow size={9} style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </span>
  );
}

function CommentCard({
  comment,
  isReply,
  isMine,
  editing,
  onStartEdit,
  onCancelEdit,
  anchorLabel,
  onJumpToBlock,
  onEdit,
  onDelete,
  onStartReply,
}: {
  comment: SharedComment;
  isReply: boolean;
  isMine: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  anchorLabel?: (blockId: string, fallback: string) => string;
  onJumpToBlock?: (blockId: string) => void;
  onEdit: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onStartReply?: () => void;
}) {
  const t = useT();
  const blockId = comment.blockId;
  const fallback = comment.blockText || t("comment.anchoredBlock");
  const label = blockId ? (anchorLabel?.(blockId, fallback) ?? fallback) : "";
  const jumpable = Boolean(blockId && onJumpToBlock);
  const jump = () => {
    if (blockId && onJumpToBlock) onJumpToBlock(blockId);
  };

  return (
    <div
      onClick={jumpable ? jump : undefined}
      title={jumpable ? t("comment.showAnchoredBlock") : undefined}
      style={{
        padding: isReply ? "8px 12px 8px 22px" : "10px 12px 10px 10px",
        borderBottom: "1px solid var(--color-border-subtle)",
        fontSize: 12,
        lineHeight: 1.55,
        color: "var(--color-foreground)",
        cursor: jumpable ? "pointer" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {isReply ? (
          <CornerDownRight
            size={12}
            style={{ marginTop: 3, color: "var(--color-text-tertiary)", flexShrink: 0 }}
          />
        ) : (
          <MessageSquare
            size={12}
            style={{ marginTop: 3, color: "var(--color-text-tertiary)", flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {blockId && (
            <div>
              <AnchorChip
                label={label}
                title={jumpable ? t("comment.showAnchoredBlock") : undefined}
                onJump={jumpable ? jump : undefined}
              />
            </div>
          )}
          {editing ? (
            <CommentInput
              placeholder={t("comment.composerPlaceholder")}
              initialText={comment.text}
              autoFocus
              submitLabel={t("comment.save")}
              onCancel={onCancelEdit}
              onSubmit={async (text) => {
                await onEdit(comment.id, text);
                onCancelEdit();
              }}
            />
          ) : (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {comment.text}
            </p>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "4px 0 0",
              fontSize: 10,
              color: "var(--color-text-tertiary)",
            }}
          >
            <span>{comment.author?.name || comment.author?.email || ""}</span>
            <span>{formatDateTime(comment.createdAt)}</span>
            {comment.updatedAt !== comment.createdAt && <span>{t("comment.edited")}</span>}
            {onStartReply && !editing && (
              <button
                type="button"
                style={linkButtonStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  onStartReply();
                }}
              >
                {t("comment.reply")}
              </button>
            )}
            {isMine && !editing && (
              <>
                <button
                  type="button"
                  style={linkButtonStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEdit();
                  }}
                >
                  {t("comment.edit")}
                </button>
                <button
                  type="button"
                  style={linkButtonStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete(comment.id);
                  }}
                >
                  {t("comment.delete")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SharedCommentsThread({
  threads,
  currentHash,
  currentIdentity,
  anchorLabel,
  onJumpToBlock,
  onReply,
  onEdit,
  onDelete,
  onCreate,
  pendingAnchor,
  onClearAnchor,
  composerDisabledReason,
  layout = "stacked",
  threadsOpen = true,
  threadsMaxHeight = "40vh",
  composerRef,
}: SharedCommentsThreadProps) {
  const t = useT();
  const { current, older } = useMemo(
    () => splitByTargetVersion(threads, currentHash),
    [threads, currentHash],
  );
  const [showOlder, setShowOlder] = useState(false);
  // 畳んだ「古い版へのコメント」の中身のヒント（ポインタを載せたときだけ出す）。
  // 本文を畳んだまま画面に出すと、直したはずの指摘をずっと見せることになるので
  // 画面には出さず、いちばん新しい 1 件の 1 行要約と返信数を title に持たせる
  const olderHint = useMemo(() => {
    const latest = older[older.length - 1];
    if (!latest) return undefined;
    const summary = commentSummary(latest.root.text);
    if (!summary) return undefined;
    return latest.replies.length > 0
      ? `${summary} · ${t("comment.replyCount", { count: String(latest.replies.length) })}`
      : summary;
  }, [older, t]);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const isMine = (c: SharedComment): boolean =>
    Boolean(currentIdentity?.email && c.author?.email === currentIdentity.email);

  const renderThread = (thread: CommentThread, readOnly: boolean) => (
    <div key={thread.root.id}>
      <CommentCard
        comment={thread.root}
        isReply={false}
        isMine={isMine(thread.root)}
        editing={editingId === thread.root.id}
        onStartEdit={() => setEditingId(thread.root.id)}
        onCancelEdit={() => setEditingId(null)}
        anchorLabel={anchorLabel}
        onJumpToBlock={onJumpToBlock}
        onEdit={onEdit}
        onDelete={onDelete}
        // 古い版のスレッドには返信させない（直したあとの版で話を続ける）
        onStartReply={readOnly ? undefined : () => setReplyingTo(thread.root.id)}
      />
      {thread.replies.map((reply) => (
        <CommentCard
          key={reply.id}
          comment={reply}
          isReply
          isMine={isMine(reply)}
          editing={editingId === reply.id}
          onStartEdit={() => setEditingId(reply.id)}
          onCancelEdit={() => setEditingId(null)}
          anchorLabel={anchorLabel}
          onJumpToBlock={onJumpToBlock}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
      {replyingTo === thread.root.id && (
        <div style={{ padding: "8px 12px 10px 22px", borderBottom: "1px solid var(--color-border-subtle)" }}>
          <CommentInput
            placeholder={t("comment.replyPlaceholder")}
            autoFocus
            onCancel={() => setReplyingTo(null)}
            onSubmit={async (text) => {
              await onReply(thread.root.id, text);
              setReplyingTo(null);
            }}
          />
        </div>
      )}
    </div>
  );

  const docked = layout === "docked";

  // 一覧（現在の版 → 古い版）。docked ではこの塊だけを高さ上限つきでスクロールさせる
  const list = (
    <>
      {current.length === 0 && older.length === 0 ? (
        <div
          style={{
            padding: 24,
            color: "var(--color-text-tertiary)",
            fontSize: 12,
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          {t("comment.empty")}
        </div>
      ) : (
        current.map((thread) => renderThread(thread, false))
      )}

      {older.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowOlder((v) => !v)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              border: "none",
              borderBottom: "1px solid var(--color-border-subtle)",
              background: "transparent",
              color: "var(--color-text-tertiary)",
              fontSize: 11,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
            aria-expanded={showOlder}
            title={showOlder ? undefined : olderHint}
          >
            {showOlder ? "▾ " : "▸ "}
            {t("comment.olderVersions", { count: String(older.length) })}
          </button>
          {showOlder && (
            <>
              <p
                style={{
                  margin: 0,
                  padding: "6px 12px",
                  fontSize: 10,
                  lineHeight: 1.6,
                  color: "var(--color-text-tertiary)",
                }}
              >
                {t("comment.olderVersionsHint")}
              </p>
              {older.map((thread) => renderThread(thread, true))}
            </>
          )}
        </div>
      )}
    </>
  );

  return (
    // 2 か所（詳細パネル / 右パネルのタブ）に埋め込まれるので、見出しの文言を
    // 読み上げ用に持たせる（画面には別途タブ名・節見出しが出るため文字は増やさない）
    <div
      role="region"
      aria-label={t("comment.title")}
      style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      {/* 新規コメント欄。段落を選んでいれば「¶ 抜粋」を上に出す */}
      <div
        style={{
          padding: "12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        {composerDisabledReason ? (
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: "var(--color-text-tertiary)" }}>
            {composerDisabledReason}
          </p>
        ) : (
          <>
            {pendingAnchor && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                  {t("comment.anchorPrefix")}
                </span>
                <AnchorChip
                  label={pendingAnchor.blockText || t("comment.anchoredBlock")}
                  onJump={onJumpToBlock ? () => onJumpToBlock(pendingAnchor.blockId) : undefined}
                />
                {onClearAnchor && (
                  <button
                    type="button"
                    onClick={onClearAnchor}
                    title={t("comment.clearAnchor")}
                    aria-label={t("comment.clearAnchor")}
                    style={{ ...linkButtonStyle, display: "inline-flex", alignItems: "center" }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )}
            <CommentInput
              placeholder={t("comment.composerPlaceholder")}
              textareaRef={composerRef}
              onSubmit={async (text) => {
                await onCreate(text, pendingAnchor ?? undefined);
              }}
            />
          </>
        )}
      </div>

      {/* docked では一覧だけを畳める。入力欄は畳んでも残す
          （上の段落を選んですぐ書けることがドックの目的なので、入力欄を隠さない） */}
      {docked ? (
        threadsOpen && (
          <div
            data-testid="shared-comments-list"
            style={{ overflowY: "auto", maxHeight: threadsMaxHeight, minHeight: 0 }}
          >
            {list}
          </div>
        )
      ) : (
        list
      )}
    </div>
  );
}
