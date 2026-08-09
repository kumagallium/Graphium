// step への入出力 span の書き込みと、step の出力列挙。
//
// 「出力を受けて次の手順を書く」導線（前手順ピッカーの出力選択・
// グラフの Entity→step 接続）は全部ここを通る: 受け側 step の本文に
// 同名の入力 span を合成し、テキスト一致の unification が PROV 上で
// 出力と入力を 1 つの Entity に merge する。

import { makeEntityId } from "../../features/inline-label/shortcuts";
import { PARENT_ACTIVITY_MARKER } from "../../features/inline-label/attribute-binding";
import { parseStructuredTable } from "../../features/prov-generator/generator";

export type StepIoKind = "material" | "tool" | "output" | "attribute";

const STYLE_KEY: Record<StepIoKind, string> = {
  material: "inlineMaterial",
  tool: "inlineTool",
  output: "inlineOutput",
  attribute: "inlineAttribute",
};

function findBlockById(blocks: any[], blockId: string): any | null {
  for (const b of blocks ?? []) {
    if (!b || typeof b !== "object") continue;
    if (b.id === blockId) return b;
    if (Array.isArray(b.children)) {
      const hit = findBlockById(b.children, blockId);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * step の本文末尾に、指定 kind の span だけを持つ専用行を合成する。
 * 空の初期行があればそこへ書く（空行を残さない）。パラメータは
 * Activity 直結（`@activity`）で束縛する。
 * @returns 生成した entityId（失敗時 null）
 */
export function appendEntitySpanToStep(
  editor: any,
  stepBlockId: string,
  kind: StepIoKind,
  text: string,
): string | null {
  const trimmed = text.trim();
  if (!editor || !trimmed) return null;
  const step = findBlockById(editor.document ?? [], stepBlockId);
  if (!step || step.type !== "step") return null;
  const entityId = makeEntityId(kind);
  const styleValue = kind === "attribute" ? `${entityId}@${PARENT_ACTIVITY_MARKER}` : entityId;
  const content = [{ type: "text", text: trimmed, styles: { [STYLE_KEY[kind]]: styleValue } }];
  const children: any[] = step.children ?? [];
  const last = children[children.length - 1];
  const lastIsEmptyPara =
    children.length === 1 &&
    last?.type === "paragraph" &&
    !(last.content ?? []).some((c: any) => typeof c?.text === "string" && c.text.trim() !== "");
  try {
    if (lastIsEmptyPara) {
      editor.updateBlock(last.id, { content });
    } else if (last) {
      editor.insertBlocks([{ type: "paragraph", content }], last.id, "after");
    } else {
      editor.updateBlock(stepBlockId, { children: [{ type: "paragraph", content }] });
    }
  } catch {
    return null;
  }
  return entityId;
}

/**
 * step の出力ラベルを文書から列挙する（前手順ピッカーの出力候補用）。
 * - 子孫の inlineOutput span（entityId 単位で集約）
 * - output ラベル付きブロック（テーブルは行ごと、その他はブロックテキスト）
 */
export function collectStepOutputs(
  doc: any[],
  labels: Map<string, string> | undefined,
  stepBlockId: string,
): string[] {
  const step = findBlockById(doc, stepBlockId);
  if (!step) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const v = label.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  const inlineById = new Map<string, string>();

  const visitContent = (content: any[]) => {
    for (const c of content ?? []) {
      if (c?.type === "text" && typeof c.styles?.inlineOutput === "string" && c.styles.inlineOutput) {
        inlineById.set(
          c.styles.inlineOutput,
          (inlineById.get(c.styles.inlineOutput) ?? "") + (c.text ?? ""),
        );
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        visitContent(c.content);
      }
    }
  };

  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (!b || typeof b !== "object") continue;
      if (Array.isArray(b.content)) visitContent(b.content);
      if (labels?.get(b.id) === "output") {
        if (b.type === "table") {
          const parsed = parseStructuredTable(b);
          if (parsed) for (const row of parsed.rows) push(row.name);
        } else {
          const text = (b.content ?? [])
            .map((c: any) => (c?.type === "text" ? c.text : ""))
            .join("");
          push(text);
        }
      }
      if (Array.isArray(b.children)) visit(b.children);
    }
  };
  visit(step.children ?? []);
  for (const label of inlineById.values()) push(label);
  return out;
}

/** step の子孫に、指定テキストの入力（material / tool）span が既にあるか */
export function stepHasInputText(doc: any[], stepBlockId: string, text: string): boolean {
  const step = findBlockById(doc, stepBlockId);
  if (!step) return false;
  const target = text.trim();
  let found = false;
  const byId = new Map<string, string>();
  const visitContent = (content: any[]) => {
    for (const c of content ?? []) {
      if (c?.type === "text") {
        for (const key of ["inlineMaterial", "inlineTool"]) {
          const v = c.styles?.[key];
          if (typeof v === "string" && v) byId.set(v, (byId.get(v) ?? "") + (c.text ?? ""));
        }
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        visitContent(c.content);
      }
    }
  };
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (Array.isArray(b?.content)) visitContent(b.content);
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(step.children ?? []);
  for (const label of byId.values()) {
    if (label.trim() === target) {
      found = true;
      break;
    }
  }
  return found;
}

/**
 * step 配下から、指定ラベル（material / tool / output）の付いたテーブルを探す。
 * グラフからの追加を「表に行を足す」形にするときの受け皿を見つけるのに使う。
 */
export function findLabeledTableInStep(
  doc: any[],
  labels: Map<string, string> | undefined,
  stepBlockId: string,
  label: "material" | "tool" | "output",
): string | null {
  const step = findBlockById(doc, stepBlockId);
  if (!step || !labels) return null;
  let found: string | null = null;
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (found) return;
      if (b?.type === "table" && b.id && labels.get(b.id) === label) {
        found = b.id;
        return;
      }
      // 入れ子 step の中のテーブルは、その step のものなので降りない
      if (Array.isArray(b?.children) && b.type !== "step") visit(b.children);
    }
  };
  visit(step.children ?? []);
  return found;
}
