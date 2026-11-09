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
import { chatUsedPageWeights, latestWebSourceCount, usedPagesSignature } from "./used-pages";

export function StandaloneChatGraph({
  data,
  messages,
  titleToRef,
  scope,
  folder,
  scopeIdsFor,
  attachedIds,
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
  const answeredInScope =
    lastAnswer && lastAnswer.searchFolder !== undefined ? scopeIdsFor(lastAnswer.searchFolder ?? undefined) : null;

  // 範囲（中身が同じなら同じオブジェクト）
  const nodeIds = useMemo(() => new Set(data.nodes.map((n) => n.id)), [data.nodes]);
  const attachedKey = attachedIds.join("|");
  const usageScope: GraphUsageScope = useMemo(
    () => ({ inScope: inScopeIds, attached: new Set(attachedIds), answeredInScope }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inScopeIds, attachedKey, answeredInScope],
  );

  const counts: ChatGraphCounts = useMemo(() => {
    let latest = 0;
    let earlier = 0;
    let outOfScope = 0;
    for (const [id, w] of weights) {
      if (w >= 0.999) latest++;
      else earlier++;
      // 範囲の外で使ったかは、いちばん新しい答えのページを、答えたときの範囲で見る
      if (w >= 0.999 && answeredInScope && !answeredInScope.has(id) && !usageScope.attached?.has(id)) outOfScope++;
    }
    const attached = attachedIds.filter((id) => nodeIds.has(id)).length;
    return { latest, earlier, web, attached, outOfScope };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights, web, answeredInScope, usageScope, nodeIds]);

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
