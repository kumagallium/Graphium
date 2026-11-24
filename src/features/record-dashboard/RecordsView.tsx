// 記録の画面（アプリのメイン領域に出す入れ物）。
// ノートの索引・素材の索引・メモの一覧を読むだけで、どれも書き換えない。
// 共有フォルダにほかの人が出した記録も、封筒を読んで並べる（「共有の作者」に切り替えたときだけ出る）。
// 共有ストアの購読はこの画面の中だけで行い、アプリ全体を共有フォルダの更新で描き直させない。
// ⌘K が「行き先へ飛ぶ」ためのものなのに対し、ここは「何を残したか」を日ごとに振り返る場所。
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaIndex } from "../asset-browser/media-index";
import type { CaptureIndex } from "../mobile-capture/capture-store";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import { lexicalSearch, phraseHitsBySource } from "../lexical-search";
import { useSharedLibrary, type SharedLibrarySnapshot } from "../sharing/shared-library-store";
import "./record-dashboard.css";
import { useRecordCopy } from "./copy";
import { buildRecords, collectRecordingNoteIds, spreadRecordingHits } from "./from-indexes";
import { buildSharedRecords, sharedIdOfRecord } from "./from-shared";
import { tidyBodyHit, timeOf, type BodyHit } from "./model";
import { RecordDashboard } from "./RecordDashboard";
import type { RecordItem, WhoFilter } from "./types";

/**
 * 共有フォルダの記録は全画面で開くので、ホームを離れる。続けて見られるよう、共有の記録を開いたことだけを
 * 覚えておき、次にホームを開いたときに 1 回だけ「共有の作者」から始める。
 * 探す言葉を持って開いたとき（⌘K の「記録で見る」）は使わない（自分の記録が出なくなるため）。
 * 保存はしない（アプリを開き直せば「すべて」から始まる）
 */
let resumeSharedAuthors = false;

/** テスト用: 覚えている絞り込みを捨てる */
export function __resetRecordsViewResumeForTest(): void {
  resumeSharedAuthors = false;
}

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
  /** 共有フォルダの記録を開く。渡さなければ、共有フォルダの記録は並べない */
  onOpenShared?: (sharedId: string) => void;
  /** 自分のメールアドレス。自分が共有したものは手元のノートとして並んでいるので、共有の側からは外す */
  selfEmail?: string | null;
  /** DI: 共有フォルダの封筒と控え（既定は共有ストア）。Storybook / テスト用 */
  sharedLibrary?: Pick<SharedLibrarySnapshot, "entries" | "derived">;
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
  onOpenShared,
  selfEmail,
  sharedLibrary,
}: RecordsViewProps) {
  const copy = useRecordCopy();
  const sharedStore = useSharedLibrary();
  const shared = sharedLibrary ?? sharedStore;
  // 今日・昨日の判定に使う「いま」。開いた時点で固定する（開いている間に日付が変わっても、並びは動かさない）
  const [now] = useState(() => new Date().toISOString());
  // 共有の記録を開いたあとの最初のホームは、「共有の作者」から続ける。
  // 旗を下ろすのは描いたあと（初期値の関数は StrictMode で 2 回呼ばれるので、そこでは下ろさない）
  const [resumeQuery, setResumeQuery] = useState<string | null>(() => (resumeSharedAuthors && !initialQuery.trim() ? initialQuery : null));
  useEffect(() => {
    resumeSharedAuthors = false;
  }, []);
  // 探す言葉が替わると中の画面を作り直す。そのときは「すべて」から始める（続きは最初の 1 回だけ）
  if (resumeQuery !== null && resumeQuery !== initialQuery) setResumeQuery(null);
  const initialWho: WhoFilter = resumeQuery !== null && resumeQuery === initialQuery ? "other" : "all";
  const ownRecords = useMemo(
    () =>
      buildRecords({
        notes: noteIndex?.notes ?? [],
        media: mediaIndex?.media ?? [],
        captures: captureIndex?.captures ?? [],
        hiddenNotes: [...(trashedNotes ?? []), ...(archivedNotes ?? [])],
      }),
    [noteIndex, mediaIndex, captureIndex, trashedNotes, archivedNotes],
  );
  // 共有フォルダにほかの人が出した記録。開く先が無いとき（onOpenShared なし）は並べない
  const canOpenShared = !!onOpenShared;
  const sharedRecords = useMemo(
    () => (canOpenShared ? buildSharedRecords({ entries: shared.entries, derived: shared.derived, selfEmail }) : []),
    [canOpenShared, shared.entries, shared.derived, selfEmail],
  );
  const records = useMemo(
    () => (sharedRecords.length === 0 ? ownRecords : [...ownRecords, ...sharedRecords].sort((a, b) => timeOf(b.at) - timeOf(a.at))),
    [ownRecords, sharedRecords],
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
      // 共有フォルダの記録の本文（この端末で読んで索引に入っているもの）
      for (const [id, h] of phraseHitsBySource(query, ["shared"])) out.set(`shared:${id}`, tidyBodyHit(h.snippet));
      // 録音の文字起こしで当たったら、その録音を持つノートも当たりにする
      return spreadRecordingHits(out, mediaIndex?.media ?? [], collectRecordingNoteIds(noteIndex?.notes ?? []));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 索引が使えるようになったら引き直す
    [lexicalKey, mediaIndex, noteIndex],
  );

  const open = (item: RecordItem) => {
    const sharedId = sharedIdOfRecord(item);
    if (sharedId !== null) {
      if (!onOpenShared) return;
      resumeSharedAuthors = true;
      onOpenShared(sharedId);
      return;
    }
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
          <RecordDashboard key={initialQuery} items={records} now={now} layout="find" initialQuery={initialQuery} initialWho={initialWho} onOpen={open} openId={openId} findInBody={findInBody} />
        )}
      </div>
    </div>
  );
}
