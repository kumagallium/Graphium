// Step ブロック — 手順（Activity）を children を持つコンテナとして第一級化する
//
// 設計: docs/internal/step-container-block-design-2026-07.md
//
// - タイトルは block の content に持たせる（props ではない）。
//   generator が deriveActivityName(getBlockText(block)) で読むため。
// - children（本文・表・画像・コード）は BlockNote が nested blockGroup として描画する。
//   並べ替え・出し入れは標準のドラッグハンドルに委ねる。
// - 枠線とヘッダー地色は app.css（.bn-block:has(> .react-renderer.node-step)）にある。
//
// ヘッダーの「計画」トグルについて:
//   計画 / 結果は step の子に付けるラベルで表す（モード帯）。当初はドラッグハンドルの
//   「ラベル ▸」から付ける想定だったが、step の中の子はハンドルへマウスを寄せる途中で
//   ホバー対象が step に切り替わってしまい、子のメニューに到達できないと実測で分かった
//   （step の外の段落では起きない。コンテナにネストしたブロック固有の挙動）。
//   そのためカード自身にトグルを置く。

import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps } from "@blocknote/core";
import { ListChecks } from "lucide-react";
import { useLabelStore } from "../../features/context-label";
import { getDisplayLabelName } from "../../i18n";

/** step の子のうち、計画マーカーが付いているものを返す */
function findPlanMarker(
  step: any,
  labels: Map<string, string>,
): string | null {
  const children = Array.isArray(step?.children) ? step.children : [];
  for (const child of children) {
    if (child?.id && labels.get(child.id) === "plan") return child.id;
  }
  return null;
}

export const StepBlock = createReactBlockSpec(
  {
    type: "step" as const,
    propSchema: {
      // 配置は BlockNote 標準の既定プロパティを流用
      textAlignment: defaultProps.textAlignment,
      // 表示バリアント（構造メタ）。タイトルはここに入れない
      variant: { default: "step" as const },
    },
    content: "inline" as const,
  },
  {
    render: (props) => {
      const labelStore = useLabelStore();
      // props.block は children の変化に追随しないことがあるので、常に編集中の
      // 実体から読む（トグルの見た目と挙動がずれるのを避ける）。
      const readStep = () =>
        (props.editor as any).getBlock?.(props.block.id) ?? props.block;
      const planActive = findPlanMarker(readStep(), labelStore.labels) !== null;

      // 計画帯の開始・解除。帯は「マーカーが付いた子から次の区切りまで」なので、
      // 開始するときは step の先頭に空のブロックを 1 つ作ってそこに印を付ける。
      const togglePlan = () => {
        const editor = props.editor as any;
        const step = readStep();
        const markerId = findPlanMarker(step, labelStore.labels);
        if (markerId) {
          labelStore.setLabel(markerId, null);
          return;
        }
        const focus = (id: string) => {
          setTimeout(() => {
            try {
              editor.setTextCursorPosition(id, "end");
              editor.focus();
            } catch {
              /* no-op */
            }
          }, 0);
        };

        const first = step.children?.[0];
        if (first?.id) {
          const inserted = editor.insertBlocks([{ type: "paragraph" }], first.id, "before");
          const newId = inserted?.[0]?.id;
          if (!newId) return;
          labelStore.setLabel(newId, "plan");
          // 帯は次の区切りまで続くので、そのままだと既に書いてある記録まで
          // 計画に飲み込まれる。元の先頭を結果マーカーにして帯をそこで閉じる。
          if (!labelStore.getLabel(first.id)) {
            labelStore.setLabel(first.id, "result");
          }
          focus(newId);
          return;
        }
        // まだ子がいない step: 子を 1 つ作ってから印を付ける
        editor.updateBlock(props.block, { children: [{ type: "paragraph" }] });
        setTimeout(() => {
          const child = editor.getBlock(props.block.id)?.children?.[0];
          if (child?.id) {
            labelStore.setLabel(child.id, "plan");
            focus(child.id);
          }
        }, 0);
      };

      const planLabel = getDisplayLabelName("plan");

      return (
        <div
          data-test="step-block"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            fontWeight: 600,
            width: "100%",
          }}
        >
          {/* ステップアイコン（編集不可） */}
          <span
            contentEditable={false}
            style={{
              flex: "0 0 auto",
              display: "inline-flex",
              marginTop: 2,
              color: "var(--color-primary)",
            }}
          >
            <ListChecks size={18} strokeWidth={2} />
          </span>
          {/* ステップ名（インライン編集領域＝タイトルは content） */}
          <div
            ref={props.contentRef}
            style={{ flex: 1, minWidth: 0, lineHeight: "1.6" }}
          />
          {/* 計画帯のトグル。結果は既定なのでボタンを置かない
              （マークしないことが「やった記録」の意味） */}
          <button
            type="button"
            contentEditable={false}
            onClick={togglePlan}
            title={planLabel}
            aria-pressed={planActive}
            data-test="step-plan-toggle"
            style={{
              flex: "0 0 auto",
              marginTop: 1,
              padding: "0 8px",
              height: 20,
              borderRadius: 10,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: "18px",
              border: `1px solid ${planActive ? "var(--color-info)" : "var(--color-border)"}`,
              background: planActive ? "var(--color-info)" : "transparent",
              color: planActive ? "#fff" : "var(--color-text-tertiary)",
            }}
          >
            {planLabel}
          </button>
        </div>
      );
    },
  }
);
