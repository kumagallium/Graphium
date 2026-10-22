// 来歴タブの本体。buildLineageTree の結果と docs 一式から来歴スタックビューのモデルを組み立てて表示する。

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useT } from "../../i18n";
import { openExternalUrl } from "../../lib/external-link";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { MediaIndex } from "../asset-browser/media-index";
import type { LineageNode } from "./lineage-builder";
import { buildLineageStack } from "./lineage-stack-builder";
import type { StackNode } from "./lineage-stack-model";
import { LineageStackView } from "./lineage-stack-view";
import {
  getLatestProcessIndex,
  requestLatestProcessIndexRefresh,
  subscribeLatestProcessIndex,
} from "./process-index";

/** 来歴の組み立てに使う素データ（use-file-manager が lineageTree と同じ経路で作る） */
export type LineageSources = {
  files: GraphiumFile[];
  docs: Map<string, GraphiumDocument>;
  mediaIndex: MediaIndex | null;
};

export function LineageStackPanel({
  tree,
  sources,
  onNavigate,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
}: {
  tree: LineageNode | null;
  sources: LineageSources | null;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  /** URL ソースをアプリ内（素材サイドピークのリーダー）で開く。未指定なら外部ブラウザ。 */
  onOpenUrl?: (url: string) => void;
  /** memo: ソースをメモギャラリーの該当詳細で開く。未指定ならボタンを出さない。 */
  onOpenMemo?: (captureId: string) => void;
}) {
  const t = useT();
  const processIndex = useSyncExternalStore(subscribeLatestProcessIndex, getLatestProcessIndex);
  // 手順の索引が未読み込み（null）のままタブを開いたときだけ、最新化を 1 回頼む。
  // 読み込み済みなら、保存時に use-file-manager が索引を更新するので、ノート移動ごとには頼まない
  useEffect(() => {
    if (getLatestProcessIndex() === null) requestLatestProcessIndexRefresh();
  }, []);

  const model = useMemo(() => {
    if (!tree || !sources) return null;
    return buildLineageStack({
      currentId: tree.id,
      tree,
      files: sources.files,
      docs: sources.docs,
      mediaIndex: sources.mediaIndex,
      processIndex,
      labels: {
        wholeNote: t("lineageStack.wholeNote"),
        sources: t("lineageStack.sources"),
        groupMaterials: t("lineageStack.group.materials"),
        groupNotes: t("lineageStack.group.notes"),
        groupKnowledge: t("lineageStack.group.knowledge"),
        groupClaims: t("lineageStack.group.claims"),
        groupTopics: t("lineageStack.group.topics"),
      },
    });
  }, [tree, sources, processIndex, t]);

  if (!model) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {t("lineage.empty")}
      </div>
    );
  }

  // 対応するハンドラが無い種類では「開く」を出さない
  const canOpen = (node: StackNode) => {
    const type = node.open?.type;
    if (type === "media") return !!onOpenMedia;
    if (type === "memo") return !!onOpenMemo;
    return !!type;
  };

  const handleOpen = (node: StackNode) => {
    const target = node.open;
    if (!target) return;
    switch (target.type) {
      case "note":
        onNavigate(target.navId);
        break;
      case "media":
        onOpenMedia?.(target.fileId);
        break;
      case "url":
        if (onOpenUrl) onOpenUrl(target.url);
        else void openExternalUrl(target.url);
        break;
      case "memo":
        onOpenMemo?.(target.captureId);
        break;
    }
  };

  return (
    <div className="h-full overflow-auto p-3">
      <LineageStackView model={model} onOpen={handleOpen} canOpen={canOpen} />
    </div>
  );
}
