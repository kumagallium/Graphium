// ──────────────────────────────────────────────
// 手順フローグラフを実データに接続する編集ラッパー。
//
// - 描画: provDoc を手順フロー用データ（手順 + 手順依存）に変換して渡す
// - 編集: ドラッグ A(産)→B(使) を informed_by リンクとして書き込む
//   （source=今の手順 B / target=前の手順 A の規約。生成側が PROV 側で output 経由に desugar）
// ──────────────────────────────────────────────

import { useMemo } from "react";
import { ActivityGraph } from "./activity-graph";
import { provDocToStepGraph } from "./activity-graph-adapter";
import { useLinkStore } from "../block-link/store";
import type { ProvJsonLd } from "../prov-generator/generator";

export function ActivityGraphEditor({ doc }: { doc: ProvJsonLd | null }) {
  const linkStore = useLinkStore();
  const { activities, steps } = useMemo(() => provDocToStepGraph(doc), [doc]);

  return (
    <ActivityGraph
      activities={activities}
      steps={steps}
      onConnectSteps={(producer, consumer) => {
        // 「A が産み B が使う」= B wasInformedBy A → addLink(source=B, target=A)
        linkStore.addLink({
          sourceBlockId: consumer,
          targetBlockId: producer,
          type: "informed_by",
          createdBy: "human",
        });
      }}
      onRemoveStep={(stepId) => {
        const step = steps.find((s) => s.id === stepId);
        if (!step) return;
        // 対応する informed_by リンク（source=consumer / target=producer）を削除する
        //（best-effort: ラベル一致などリンクを伴わない手順依存は対応リンクが無いので何もしない）
        const link = linkStore.links.find(
          (l) =>
            l.type === "informed_by" &&
            l.sourceBlockId === step.to &&
            l.targetBlockId === step.from,
        );
        if (link) linkStore.removeLink(link.id);
      }}
    />
  );
}
