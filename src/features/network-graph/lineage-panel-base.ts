// 系譜（来歴の図）の土台。素データの型と、手順の索引の購読・「他 N 件」の経路・
// モデルの組み立て・「開く」の可否と実行をまとめる。右パネルの系譜と全体グラフの系譜が共有する。

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useT } from "../../i18n";
import { openExternalUrl } from "../../lib/external-link";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { MediaIndex } from "../asset-browser/media-index";
import type { GraphiumIndex } from "../navigation/index-file";
import type { LineageNode } from "./lineage-builder";
import { buildLineageStack } from "./lineage-stack-builder";
import type { StackNode } from "./lineage-stack-model";
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
  /** ノート索引。図の表示で計画の表の行を解決するのに使う（無ければ null） */
  index?: GraphiumIndex | null;
};

type LineagePanelBaseInput = {
  tree: LineageNode | null;
  sources: LineageSources | null;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  onOpenUrl?: (url: string) => void;
  onOpenMemo?: (captureId: string) => void;
};

/**
 * 系譜の土台: 手順の索引の購読・「他 N 件」の経路・モデルの組み立て・
 * 「開く」の可否と実行
 */
export function useLineagePanelBase({
  tree,
  sources,
  onNavigate,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
}: LineagePanelBaseInput) {
  const t = useT();
  const processIndex = useSyncExternalStore(subscribeLatestProcessIndex, getLatestProcessIndex);
  // 手順の索引が未読み込み（null）のままタブを開いたときだけ、最新化を 1 回頼む。
  // 読み込み済みなら、保存時に use-file-manager が索引を更新するので、ノート移動ごとには頼まない
  useEffect(() => {
    if (getLatestProcessIndex() === null) requestLatestProcessIndexRefresh();
  }, []);

  // 「他 N 件」から開いた経路。ノートが変わったら捨てる
  const [focus, setFocus] = useState<{ treeId: string; path: string[] } | null>(null);
  const focusPath = focus && tree && focus.treeId === tree.id ? focus.path : undefined;

  const model = useMemo(() => {
    if (!tree || !sources) return null;
    return buildLineageStack({
      currentId: tree.id,
      tree,
      files: sources.files,
      docs: sources.docs,
      mediaIndex: sources.mediaIndex,
      processIndex,
      focusPath,
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
  }, [tree, sources, processIndex, focusPath, t]);

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

  const onFocusPath = tree ? (path: string[]) => setFocus({ treeId: tree.id, path }) : undefined;

  return { model, processIndex, canOpen, handleOpen, onFocusPath };
}
