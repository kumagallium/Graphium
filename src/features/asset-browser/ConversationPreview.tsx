// AI との会話の素材を開いて読む。本文は loadMediaText で読んだ文字列を、
// 説明・日付・発言に分けて React の文字としてそのまま出す（HTML / Markdown としては解釈しない）。

import { useEffect, useMemo, useState } from "react";
import { getActiveProvider } from "../../lib/storage/registry";
import { formatDate } from "@/lib/format-datetime";
import { useT } from "../../i18n";
import type { MediaIndexEntry } from "./media-index";
import { parseConversationBody } from "./conversation-body";

/** この会話で作ったノート（題は索引から引く） */
export type CreatedNoteLink = { noteId: string; title: string };

const BOX_STYLE = {
  alignSelf: "stretch",
  width: "100%",
  maxWidth: 640,
  margin: "0 auto",
  padding: "20px 24px",
  background: "var(--color-card)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 12,
} as const;

/** 本文（文字列）を出す部品。読み込みとは切り離してあり、ストーリーから直接渡せる */
export function ConversationBody({ text }: { text: string }) {
  const blocks = useMemo(() => parseConversationBody(text), [text]);
  return (
    <div style={{ fontSize: 14, lineHeight: 1.8 }}>
      {blocks.map((b, i) => {
        if (b.kind === "lead") {
          return (
            <p key={i} className="text-xs text-muted-foreground" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {b.text}
            </p>
          );
        }
        if (b.kind === "date") {
          return (
            <h3 key={i} className="text-xs font-medium text-muted-foreground" style={{ margin: 0, marginTop: 20 }}>
              {b.text}
            </h3>
          );
        }
        return (
          <div key={i} style={{ marginTop: 8 }}>
            {b.label && <div className="text-xs text-muted-foreground">{b.label}</div>}
            <div
              className={b.side === "ai" ? "text-muted-foreground" : "text-foreground"}
              style={{ whiteSpace: "pre-wrap" }}
            >
              {b.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 箱と来歴の 1 行。本文の読み込み結果（undefined = 読み込み中、null = 無い）を受ける */
export function ConversationPreviewView({
  entry,
  text,
  createdNotes,
  onOpenNote,
}: {
  entry: Pick<MediaIndexEntry, "conversation">;
  text: string | null | undefined;
  /** この会話で作ったノート（索引に無いものは渡さない）。空なら見出しも出さない */
  createdNotes?: readonly CreatedNoteLink[];
  /** 題を押したときにそのノートを開く */
  onOpenNote?: (noteId: string) => void;
}) {
  const t = useT();
  const meta = entry.conversation;
  const start = meta?.startedAt ? formatDate(meta.startedAt) : "";
  const end = meta?.endedAt ? formatDate(meta.endedAt) : "";
  const period = start && end && start !== end ? `${start} 〜 ${end}` : start || end;
  const provenance = [meta?.workdir, period].filter(Boolean).join("　");
  return (
    <div style={{ alignSelf: "stretch", width: "100%", maxWidth: 640, margin: "0 auto" }}>
      {meta && provenance && (
        <div className="text-xs text-muted-foreground" style={{ marginBottom: 8, wordBreak: "break-all" }}>
          {provenance}
        </div>
      )}
      {createdNotes && createdNotes.length > 0 && (
        <div style={{ ...BOX_STYLE, marginBottom: 12, padding: "12px 24px" }} data-testid="conversation-created-notes">
          <h3 className="text-xs font-medium text-muted-foreground" style={{ margin: 0, marginBottom: 6 }}>
            {t("asset.conversation.createdNotes")}
          </h3>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {createdNotes.map((n) => (
              <li key={n.noteId} style={{ fontSize: 14, lineHeight: 1.8 }}>
                <button
                  type="button"
                  className="text-left text-foreground underline underline-offset-2 hover:text-primary"
                  style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                  onClick={() => onOpenNote?.(n.noteId)}
                >
                  {n.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={BOX_STYLE}>
        {text === undefined ? (
          <p className="text-sm text-muted-foreground">{t("asset.conversation.loading")}</p>
        ) : text === null || text === "" ? (
          <p className="text-sm text-muted-foreground">{t("asset.conversation.missing")}</p>
        ) : (
          <ConversationBody text={text} />
        )}
      </div>
    </div>
  );
}

export function ConversationPreview({
  entry,
  onOpenNote,
  noteTitleOf,
}: {
  entry: MediaIndexEntry;
  onOpenNote?: (noteId: string) => void;
  /** ノートの題を引く。索引に無い（消した）・ゴミ箱のノートは undefined で、一覧に出さない */
  noteTitleOf?: (noteId: string) => string | undefined;
}) {
  const createdNotes = useMemo(() => {
    const links: CreatedNoteLink[] = [];
    for (const id of entry.conversation?.createdNoteIds ?? []) {
      const title = noteTitleOf?.(id);
      if (title !== undefined) links.push({ noteId: id, title });
    }
    return links;
  }, [entry.conversation?.createdNoteIds, noteTitleOf]);
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setText(undefined);
    const load = getActiveProvider().loadMediaText;
    if (!load) { setText(null); return; }
    load.call(getActiveProvider(), entry.fileId)
      .then((s) => { if (!cancelled) setText(s ?? null); })
      .catch(() => { if (!cancelled) setText(null); });
    return () => { cancelled = true; };
  }, [entry.fileId]);
  return <ConversationPreviewView entry={entry} text={text} createdNotes={createdNotes} onOpenNote={onOpenNote} />;
}
