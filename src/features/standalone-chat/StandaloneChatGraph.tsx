// ノートに紐づかないチャットの横に並べる全体グラフ（中身）。
//
// 会話から「AI が使ったページ」の重みを作り（used-pages.ts）、AI が探せる範囲
// （探すフォルダ・@ で渡したページ）を印して、GlobalGraphView の小さな表示に渡す。
// 重みと範囲は中身が変わったときだけ作り直す。会話の入力や読み込み中の再描画で
// 同じものを渡し続けるので、グラフは動かず、火花も走り直さない。

import { useMemo } from "react";
import type { ChatMessage } from "../../lib/document-types";
import type { GroundingScope } from "../../lib/grounding-scope";
import { GlobalGraphView, type GraphUsageScope } from "../network-graph/global-graph-view";
import type { NoteGraphData } from "../network-graph/graph-builder";
import { ChatGraphPane, type ChatGraphCounts } from "./ChatGraphPane";
import { chatReadPageIds, chatUsedPageWeights, latestWebSourceCount, outOfScopePageIds, usedPagesSignature } from "./used-pages";

export function StandaloneChatGraph({
  data,
  messages,
  titleToRef,
  scope,
  folder,
  scopeIdsFor,
  attachedIds,
  readingRefs = [],
  insightsEnabled,
  onClose,
  onSelectNote,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
}: {
  /** 全体グラフのデータ（buildGlobalGraph） */
  data: NoteGraphData;
  messages: readonly ChatMessage[];
  /** retriever の題名 → 参照（引用の題名をページに引くため） */
  titleToRef?: ReadonlyMap<string, string>;
  scope: GroundingScope;
  folder?: string;
  /** フォルダで探せるページ（collectFolderScopeIds）。null ならすべて。同じフォルダには同じ Set を返すこと */
  scopeIdsFor: (folder: string | undefined) => ReadonlySet<string> | null;
  /** @ で渡したページ */
  attachedIds: readonly string[];
  /** 答えを待っているあいだに AI が読んでいるページの参照（`wiki:` / `note:` / `asset:`） */
  readingRefs?: readonly string[];
  insightsEnabled?: boolean;
  onClose: () => void;
  onSelectNote: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  onOpenUrl?: (url: string) => void;
  onOpenMemo?: (captureId: string) => void;
}) {
  // 使ったページの重み（中身が同じなら同じ Map）
  const raw = useMemo(
    () => chatUsedPageWeights(messages, data.nodes, titleToRef),
    [messages, data.nodes, titleToRef],
  );
  const sig = usedPagesSignature(raw);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weights = useMemo(() => raw, [sig]);
  const web = useMemo(() => latestWebSourceCount(messages), [messages]);

  // いまの探すフォルダの範囲（柵。次の質問で探すところ）
  const inScopeIds = scopeIdsFor(folder);
  // いちばん新しい答えを出したときの範囲。答えに記録した探したフォルダ（searchFolder）で引く。
  // 答えのあとにフォルダを変えても、その答えを判定し直さない。記録の無い答えは判定しない（null）
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant");
  const nodeIds = useMemo(() => new Set(data.nodes.map((n) => n.id)), [data.nodes]);

  // 読んだページ: 会話全体（答えの readRefs）・いちばん新しい答え・読んでいる途中
  const readingKey = readingRefs.join("|");
  const reading = useMemo(
    () => chatReadPageIds([], nodeIds, readingRefs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeIds, readingKey],
  );
  const read = useMemo(() => chatReadPageIds(messages, nodeIds, readingRefs), [messages, nodeIds, readingKey]);
  const isReading = reading.size > 0;
  const latestRead = useMemo(
    () => (isReading ? reading : chatReadPageIds(lastAnswer ? [lastAnswer] : [], nodeIds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isReading, reading, lastAnswer, nodeIds],
  );
  // いちばん新しい答えの根拠は、その答えを出したときの範囲で判定する（記録の無い答えは判定しない）
  const answeredInScope =
    lastAnswer && lastAnswer.searchFolder !== undefined ? scopeIdsFor(lastAnswer.searchFolder ?? undefined) : null;
  // 読んだページの判定: 答えを待っているあいだはいまの範囲（送信したときのフォルダ）、返ったあとは答えたときの範囲。
  // 読んでいる途中に前の答えの根拠をいまの範囲で見ると、「すべて」で出した根拠まで赤くなる
  const readInScope = isReading ? inScopeIds : answeredInScope;

  // 範囲（中身が同じなら同じオブジェクト）
  const attachedKey = attachedIds.join("|");
  const usageScope: GraphUsageScope = useMemo(
    () => ({ inScope: inScopeIds, attached: new Set(attachedIds), answeredInScope, readInScope, read, latestRead, reading }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inScopeIds, attachedKey, answeredInScope, readInScope, read, latestRead, reading],
  );

  const counts: ChatGraphCounts = useMemo(() => {
    let latest = 0;
    let earlier = 0;
    for (const w of weights.values()) {
      if (w >= 0.999) latest++;
      else earlier++;
    }
    // 使ったページと読んだページが重なる分は 1 つに数える
    const outside = outOfScopePageIds({
      weights,
      readIds: latestRead,
      usedScope: answeredInScope,
      readScope: readInScope,
      attached: usageScope.attached,
    });
    const attached = attachedIds.filter((id) => nodeIds.has(id)).length;
    return { latest, earlier, web, attached, outOfScope: outside.size, read: latestRead.size, reading: isReading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights, web, answeredInScope, readInScope, usageScope, nodeIds, latestRead, isReading]);

  return (
    <ChatGraphPane counts={counts} scope={scope} folder={folder} onClose={onClose}>
      <GlobalGraphView
        compact
        data={data}
        insightsEnabled={insightsEnabled}
        onClose={onClose}
        onSelectNote={onSelectNote}
        onOpenMedia={onOpenMedia}
        onOpenUrl={onOpenUrl}
        onOpenMemo={onOpenMemo}
        usageWeights={weights}
        usageFiring="once"
        usageScope={usageScope}
      />
    </ChatGraphPane>
  );
}
