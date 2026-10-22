// 来歴タブの本体。buildLineageTree の結果と docs 一式から来歴スタックビューのモデルを組み立てて表示する。

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  onShowNeighbors,
}: {
  tree: LineageNode | null;
  sources: LineageSources | null;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  /** URL ソースをアプリ内（素材サイドピークのリーダー）で開く。未指定なら外部ブラウザ。 */
  onOpenUrl?: (url: string) => void;
  /** memo: ソースをメモギャラリーの該当詳細で開く。未指定ならボタンを出さない。 */
  onOpenMemo?: (captureId: string) => void;
  /** 来歴が自分 1 枚だけのとき、近傍グラフへ切り替える。未指定なら誘いを出さない */
  onShowNeighbors?: () => void;
}) {
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

  // 派生元も派生先も無い（起点＝自分で、箱が 1 つも無い）。来歴が既定タブなので、
  // 空の画面で止めずにリンクのつながり（近傍）へ誘う
  const isEmpty =
    model.initialPath.length === 1 && (model.nodes[model.rootId]?.groups.length ?? 0) === 0;

  return (
    <div className="h-full overflow-auto p-3">
      {isEmpty && onShowNeighbors && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>{t("lineageStack.emptyHint")}</span>
          <button
            type="button"
            onClick={onShowNeighbors}
            className="ml-auto whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted/50 cursor-pointer"
          >
            {t("lineageStack.showNeighbors")}
          </button>
        </div>
      )}
      <LineageStackView
        model={model}
        onOpen={handleOpen}
        canOpen={canOpen}
        onFocusPath={tree ? (path) => setFocus({ treeId: tree.id, path }) : undefined}
      />
    </div>
  );
}
