// ──────────────────────────────────────────────
// ActivityGraph を実データに接続する編集ラッパー。
//
// - 描画: provDoc を ActivityGraph 用データに変換して渡す
// - 編集: ドラッグ A(産)→B(使) を informed_by リンクとして書き込む
//   （source=今の手順 B / target=前の手順 A の規約。生成側が entity 経由に desugar する）
// ──────────────────────────────────────────────

import { useMemo } from "react";
import { ActivityGraph } from "./activity-graph";
import { provDocToActivityGraph } from "./activity-graph-adapter";
import { useLinkStore } from "../block-link/store";
import type { ProvJsonLd } from "../prov-generator/generator";

export function ActivityGraphEditor({ doc }: { doc: ProvJsonLd | null }) {
  const linkStore = useLinkStore();
  const { activities, outputs, uses } = useMemo(() => provDocToActivityGraph(doc), [doc]);

  // 「A が産み B が使う」= B wasInformedBy A → addLink(source=B, target=A)
  const createInformedBy = (producer: string, consumer: string) => {
    linkStore.addLink({
      sourceBlockId: consumer,
      targetBlockId: producer,
      type: "informed_by",
      createdBy: "human",
    });
  };

  return (
    <ActivityGraph
      activities={activities}
      outputs={outputs}
      uses={uses}
      onLinkActivities={(from, to) => createInformedBy(from, to)}
      onLinkOutput={(outputId, to) => {
        const owner = outputs.find((o) => o.id === outputId)?.owner;
        if (owner) createInformedBy(owner, to);
      }}
      onRemoveUse={(useId) => {
        const u = uses.find((x) => x.id === useId);
        if (!u) return;
        const owner = outputs.find((o) => o.id === u.outputId)?.owner;
        if (!owner) return;
        // 対応する informed_by リンク（source=consumer / target=owner）を削除する
        //（best-effort: ラベル由来の used は対応リンクが無いので何もしない）
        const link = linkStore.links.find(
          (l) =>
            l.type === "informed_by" &&
            l.sourceBlockId === u.consumer &&
            l.targetBlockId === owner,
        );
        if (link) linkStore.removeLink(link.id);
      }}
    />
  );
}
