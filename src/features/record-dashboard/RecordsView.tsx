// 記録の画面（アプリのメイン領域に出す入れ物）。
// ノートの索引・素材の索引・メモの一覧を読むだけで、どれも書き換えない。
// ⌘K が「行き先へ飛ぶ」ためのものなのに対し、ここは「何を残したか」を日ごとに振り返る場所。
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaIndex } from "../asset-browser/media-index";
import type { CaptureIndex } from "../mobile-capture/capture-store";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import { lexicalSearch, phraseHitsBySource } from "../lexical-search";
import "./record-dashboard.css";
import { useRecordCopy } from "./copy";
import { buildRecords, collectRecordingNoteIds, spreadRecordingHits } from "./from-indexes";
import { tidyBodyHit, type BodyHit } from "./model";
import { RecordDashboard } from "./RecordDashboard";
import type { RecordItem } from "./types";

export type RecordsViewProps = {
  noteIndex: GraphiumIndex | null | undefined;
  mediaIndex: MediaIndex | null | undefined;
  captureIndex: CaptureIndex | null | undefined;
  /**
   * ごみ箱とアーカイブのノート。一覧には出さず、録音の素材の札を決めるのにだけ使う
   * （noteIndex はごみ箱・アーカイブを除いた形で渡ってくる）
   */
  trashedNotes?: readonly NoteIndexEntry[];
  archivedNotes?: readonly NoteIndexEntry[];
  /** 索引をまだ読んでいる途中か */
  loading?: boolean;
  /** 開いたときに入れておく探す言葉（⌘K の「記録で見る」から来たとき） */
  initialQuery?: string;
  /** ノート・AI のページを開く。AI のページは wiki が true */
  onOpenNote: (noteId: string, wiki: boolean) => void;
  /** いま横で開いているノート・AI のページの id（"wiki:" の前置きは付いていてもよい） */
  openNoteId?: string | null;
  /** 素材を開く */
  onOpenMedia: (fileId: string) => void;
  /** メモを開く */
  onOpenMemo: (captureId: string) => void;
};

/** "note:abc" → "abc"（from-indexes.ts が付けた種類の前置きを外す） */
function sourceIdOf(item: RecordItem): string {
  return item.id.slice(item.id.indexOf(":") + 1);
}

/**
 * 全文の索引が使えるかどうか。索引づくりの進捗では描き直さず、使えるようになったとき・
 * 作り直されたとき（世代が進んだとき）だけ値が変わる
 */
function useLexicalReadyKey(): string {
  const read = () => `${lexicalSearch.isReady() ? "ready" : "none"}:${lexicalSearch.getStatus().generation}`;
  const [key, setKey] = useState(read);
  useEffect(() => lexicalSearch.subscribe(() => setKey(read())), []);
  return key;
}

export function RecordsView({
  noteIndex,
  mediaIndex,
  captureIndex,
  trashedNotes,
  archivedNotes,
  loading,
  initialQuery = "",
  onOpenNote,
  openNoteId,
  onOpenMedia,
  onOpenMemo,
}: RecordsViewProps) {
  const copy = useRecordCopy();
  // 今日・昨日の判定に使う「いま」。開いた時点で固定する（開いている間に日付が変わっても、並びは動かさない）
  const [now] = useState(() => new Date().toISOString());
  const records = useMemo(
    () =>
      buildRecords({
        notes: noteIndex?.notes ?? [],
        media: mediaIndex?.media ?? [],
        captures: captureIndex?.captures ?? [],
        hiddenNotes: [...(trashedNotes ?? []), ...(archivedNotes ?? [])],
      }),
    [noteIndex, mediaIndex, captureIndex, trashedNotes, archivedNotes],
  );

  // 本文でも探す: 全文の索引（ノート・AI のページの本文、素材の本文）を引き、記録の id に直して返す。
  // 索引がまだ無ければ空が返り、題・見出し・メモの本文・URL の抜粋だけで探す
  const lexicalKey = useLexicalReadyKey();
  const findInBody = useCallback(
    (query: string) => {
      const out = new Map<string, BodyHit>();
      // 入れた言葉がそのまま入っている断片だけを当たりにする（題や見出しの照合と同じく、部分一致）
      for (const [id, h] of phraseHitsBySource(query, ["note", "wiki"])) out.set(`note:${id}`, tidyBodyHit(h.snippet));
      for (const [id, h] of phraseHitsBySource(query, ["asset"])) out.set(`media:${id}`, tidyBodyHit(h.snippet));
      // 録音の文字起こしで当たったら、その録音を持つノートも当たりにする
      return spreadRecordingHits(out, mediaIndex?.media ?? [], collectRecordingNoteIds(noteIndex?.notes ?? []));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 索引が使えるようになったら引き直す
    [lexicalKey, mediaIndex, noteIndex],
  );

  const open = (item: RecordItem) => {
    const id = sourceIdOf(item);
    if (item.kind === "media") onOpenMedia(id);
    else if (item.kind === "memo") onOpenMemo(id);
    else onOpenNote(id, item.kind === "wiki");
  };

  // 横で開いているノートを、一覧の行の id（"note:abc"）に直す
  const openId = openNoteId ? `note:${openNoteId.replace(/^(wiki|skill):/, "")}` : null;

  return (
    <div className="rd-view">
      <div className="rd-view-inner">
        {loading && records.length === 0 ? (
          <p className="rd-view-loading">{copy.loading}</p>
        ) : (
          // 探す言葉が変わったら（⌘K から別の言葉で来たら）、中の状態ごと作り直す
          <RecordDashboard key={initialQuery} items={records} now={now} layout="find" initialQuery={initialQuery} onOpen={open} openId={openId} findInBody={findInBody} />
        )}
      </div>
    </div>
  );
}
