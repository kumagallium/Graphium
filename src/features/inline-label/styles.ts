// ──────────────────────────────────────────────
// BlockNote インライン style としてのコアラベル
//
// Phase C (2026-04-29): block-level の material/tool/attribute/output ラベルを
// 廃止し、BlockNote のテキスト style として保存する。各 style の値は
// PROV Entity の同一性キー (entityId) を string で持つ。
//
// ProseMirror mark として永続化されるため、
//   - ブロック編集に追従（mark は自動で split/merge される）
//   - ノート JSON 内で blocks[].content[].styles に格納される
//   - ハイライトの from/to/text 等は BlockNote が管理する
//
// 1 つの mark = 1 ハイライト = 1 PROV Entity のリファレンス。
// 同 entityId を共有する複数 mark が同じ Entity を指すこともある（参照重複の集約）。
// ──────────────────────────────────────────────

import { createStyleSpec } from "@blocknote/core";
import { parseAttributeBinding } from "./attribute-binding";

const BASE_STYLE = "padding: 0 0.1em; border-radius: 2px;";

const COLORS = {
  // Inline 4 種の色（既存のラベルバッジ色と揃える）
  material: { bg: "rgba(75, 122, 82, 0.18)", border: "#4B7A52" },   // Input
  tool: { bg: "rgba(192, 139, 62, 0.18)", border: "#c08b3e" },       // Tool
  attribute: { bg: "rgba(160, 160, 160, 0.18)", border: "#8a8a8a" }, // Parameter
  output: { bg: "rgba(194, 99, 86, 0.18)", border: "#c26356" },      // Output
} as const;

type InlineLabel = keyof typeof COLORS;

function buildSpec(label: InlineLabel) {
  const colors = COLORS[label];
  return createStyleSpec(
    {
      type: `inline${label[0].toUpperCase()}${label.slice(1)}`,
      propSchema: "string",
    },
    {
      render: (rawValue) => {
        const span = document.createElement("span");
        span.setAttribute("data-inline-label", label);
        if (typeof rawValue === "string" && rawValue) {
          // attribute は `entityId@parentEntityId` の複合キーを許可。それ以外は単体 entityId
          if (label === "attribute") {
            const { entityId, parentEntityId } = parseAttributeBinding(rawValue);
            if (entityId) span.setAttribute("data-entity-id", entityId);
            if (parentEntityId) {
              span.setAttribute("data-parent-entity-id", parentEntityId);
            }
          } else {
            span.setAttribute("data-entity-id", rawValue);
          }
        }
        span.style.cssText = [
          BASE_STYLE,
          `background-color: ${colors.bg};`,
          `border-bottom: 1px solid ${colors.border};`,
        ].join(" ");
        return { dom: span, contentDOM: span };
      },
    },
  );
}

const inlineMaterialStyle = buildSpec("material");
const inlineToolStyle = buildSpec("tool");
const inlineAttributeStyle = buildSpec("attribute");
const inlineOutputStyle = buildSpec("output");

/**
 * BlockNoteSchema.create に渡す styleSpecs マップ。
 *   key = style 名（プロパティ名として content[].styles[key] = entityId に格納される）
 */
export const inlineLabelStyleSpecs = {
  inlineMaterial: inlineMaterialStyle,
  inlineTool: inlineToolStyle,
  inlineAttribute: inlineAttributeStyle,
  inlineOutput: inlineOutputStyle,
} as const;

export const LABEL_TO_STYLE: Record<InlineLabel, keyof typeof inlineLabelStyleSpecs> = {
  material: "inlineMaterial",
  tool: "inlineTool",
  attribute: "inlineAttribute",
  output: "inlineOutput",
};
