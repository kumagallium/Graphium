// 記録の画面（アプリのメイン領域に出す入れ物）。
// ノートの索引・素材の索引・メモの一覧を読むだけで、どれも書き換えない。
// ⌘K が「行き先へ飛ぶ」ためのものなのに対し、ここは「何を残したか」を日ごとに振り返る場所。
import { useMemo, useState } from "react";
import type { MediaIndex } from "../asset-browser/media-index";
import type { CaptureIndex } from "../mobile-capture/capture-store";
import type { GraphiumIndex } from "../navigation/index-file";
import "./record-dashboard.css";
import { useRecordCopy } from "./copy";
import { buildRecords } from "./from-indexes";
import { RecordDashboard } from "./RecordDashboard";
import type { RecordItem } from "./types";

export type RecordsViewProps = {
  noteIndex: GraphiumIndex | null | undefined;
  mediaIndex: MediaIndex | null | undefined;
  captureIndex: CaptureIndex | null | undefined;
  /** 索引をまだ読んでいる途中か */
  loading?: boolean;
  /** 開いたときに入れておく探す言葉（⌘K の「記録で見る」から来たとき） */
  initialQuery?: string;
  /** ノート・AI のページを開く。AI のページは wiki が true */
  onOpenNote: (noteId: string, wiki: boolean) => void;
  /** 素材を開く */
  onOpenMedia: (fileId: string) => void;
  /** メモを開く */
  onOpenMemo: (captureId: string) => void;
};

/** "note:abc" → "abc"（from-indexes.ts が付けた種類の前置きを外す） */
function sourceIdOf(item: RecordItem): string {
  return item.id.slice(item.id.indexOf(":") + 1);
}

export function RecordsView({
  noteIndex,
  mediaIndex,
  captureIndex,
  loading,
  initialQuery = "",
  onOpenNote,
  onOpenMedia,
  onOpenMemo,
}: RecordsViewProps) {
  const copy = useRecordCopy();
  // 今日・昨日の判定に使う「いま」。開いた時点で固定する（開いている間に日付が変わっても、並びは動かさない）
  const [now] = useState(() => new Date().toISOString());
  const records = useMemo(
    () => buildRecords({ notes: noteIndex?.notes ?? [], media: mediaIndex?.media ?? [], captures: captureIndex?.captures ?? [] }),
    [noteIndex, mediaIndex, captureIndex],
  );

  const open = (item: RecordItem) => {
    const id = sourceIdOf(item);
    if (item.kind === "media") onOpenMedia(id);
    else if (item.kind === "memo") onOpenMemo(id);
    else onOpenNote(id, item.kind === "wiki");
  };

  return (
    <div className="rd-view">
      <div className="rd-view-inner">
        {loading && records.length === 0 ? (
          <p className="rd-view-loading">{copy.loading}</p>
        ) : (
          // 探す言葉が変わったら（⌘K から別の言葉で来たら）、中の状態ごと作り直す
          <RecordDashboard key={initialQuery} items={records} now={now} layout="find" initialQuery={initialQuery} onOpen={open} />
        )}
      </div>
    </div>
  );
}
