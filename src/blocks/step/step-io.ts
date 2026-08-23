// step への入出力 span の書き込みと、step の出力列挙。
//
// 「出力を受けて次の手順を書く」導線（前手順ピッカーの出力選択・
// グラフの Entity→step 接続）は全部ここを通る: 受け側 step の本文に
// 同名の入力 span を合成し、テキスト一致の unification が PROV 上で
// 出力と入力を 1 つの Entity に merge する。

import { makeEntityId } from "../../features/inline-label/styles";
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
  requestedEntityId?: string,
): string | null {
  const trimmed = text.trim();
  if (!editor || !trimmed) return null;
  const step = findBlockById(editor.document ?? [], stepBlockId);
  if (!step || step.type !== "step") return null;
  const entityId = requestedEntityId || makeEntityId(kind);
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

const INPUT_STYLE_KEYS = ["inlineMaterial", "inlineTool"] as const;

function inputStyleMatches(content: any, entityId: string): boolean {
  if (content?.type !== "text") return false;
  return INPUT_STYLE_KEYS.some((key) => content.styles?.[key] === entityId);
}

/**
 * 指定 step 内の material / tool span を entityId で探し、テキストを更新する。
 * 分割された span はブロック内の先頭 piece へ統合する。
 * @returns 更新したブロック数
 */
export function updateStepInputEntityText(
  editor: any,
  stepBlockId: string,
  entityId: string,
  text: string,
): number {
  const trimmed = text.trim();
  if (!editor || !entityId || !trimmed) return 0;
  const step = findBlockById(editor.document ?? [], stepBlockId);
  if (!step || step.type !== "step") return 0;
  const updates: Array<{ id: string; content: any[] }> = [];

  const rewrite = (content: any[]): { content: any[]; matched: boolean; changed: boolean } => {
    let matched = false;
    let changed = false;
    let replaced = false;
    const next: any[] = [];
    for (const item of content ?? []) {
      if (inputStyleMatches(item, entityId)) {
        matched = true;
        if (!replaced) {
          next.push(item.text === trimmed ? item : { ...item, text: trimmed });
          changed ||= item.text !== trimmed;
          replaced = true;
        } else {
          changed = true;
        }
      } else if (item?.type === "link" && Array.isArray(item.content)) {
        const inner = rewrite(item.content);
        next.push(inner.changed ? { ...item, content: inner.content } : item);
        matched ||= inner.matched;
        changed ||= inner.changed;
      } else {
        next.push(item);
      }
    }
    return { content: next, matched, changed };
  };

  const visit = (blocks: any[]) => {
    for (const block of blocks ?? []) {
      if (Array.isArray(block?.content)) {
        const result = rewrite(block.content);
        if (result.matched && result.changed && block.id) {
          updates.push({ id: block.id, content: result.content });
        }
      }
      // 入れ子 step は別 Activity なので、指定 step の入力としては触らない
      if (block?.type !== "step" && Array.isArray(block?.children)) visit(block.children);
    }
  };
  visit(step.children ?? []);

  let updated = 0;
  for (const item of updates) {
    try {
      editor.updateBlock(item.id, { content: item.content });
      updated += 1;
    } catch {
      // 編集中に対象ブロックが消えた場合は更新件数に含めない
    }
  }
  return updated;
}

/**
 * 指定 step に専用行として追加された material / tool span を削除する。
 * 他のテキストや inline content が混在する行は対象 span だけを削除する。
 * step の唯一の子は空段落に戻し、編集可能な本文を残す。
 */
export function removeDedicatedStepInputEntity(
  editor: any,
  stepBlockId: string,
  entityId: string,
): number {
  if (!editor || !entityId) return 0;
  const step = findBlockById(editor.document ?? [], stepBlockId);
  if (!step || step.type !== "step") return 0;
  const removeIds: string[] = [];
  const updates: Array<{ id: string; content: any[] }> = [];

  const rewrite = (
    content: any[],
  ): { content: any[]; matched: boolean; hasMeaningfulRemainder: boolean } => {
    let matched = false;
    let hasMeaningfulRemainder = false;
    const next: any[] = [];
    for (const item of content ?? []) {
      if (inputStyleMatches(item, entityId)) {
        matched = true;
        continue;
      }
      if (item?.type === "link" && Array.isArray(item.content)) {
        const inner = rewrite(item.content);
        if (!inner.matched) {
          next.push(item);
          hasMeaningfulRemainder ||= inner.hasMeaningfulRemainder;
          continue;
        }
        matched ||= inner.matched;
        if (inner.content.length > 0) {
          next.push({ ...item, content: inner.content });
          hasMeaningfulRemainder ||= inner.hasMeaningfulRemainder;
        }
        continue;
      }
      next.push(item);
      hasMeaningfulRemainder ||=
        item?.type !== "text" || (item.text ?? "").trim() !== "";
    }
    return { content: next, matched, hasMeaningfulRemainder };
  };

  const visit = (blocks: any[]) => {
    for (const block of blocks ?? []) {
      if (
        block?.id &&
        block.type === "paragraph" &&
        (block.children ?? []).length === 0 &&
        Array.isArray(block.content)
      ) {
        const result = rewrite(block.content);
        if (result.matched) {
          if (!result.hasMeaningfulRemainder) {
            if ((step.children ?? []).length === 1 && step.children[0]?.id === block.id) {
              updates.push({ id: block.id, content: [] });
            } else {
              removeIds.push(block.id);
            }
          } else {
            updates.push({ id: block.id, content: result.content });
          }
        }
      }
      if (block?.type !== "step" && Array.isArray(block?.children)) visit(block.children);
    }
  };
  visit(step.children ?? []);
  let changed = 0;
  for (const update of updates) {
    try {
      editor.updateBlock(update.id, { content: update.content });
      changed += 1;
    } catch {
      // 編集中に対象段落が消えた場合、その段落は変更件数に含めない
    }
  }
  if (removeIds.length > 0) {
    try {
      editor.removeBlocks(removeIds);
      changed += removeIds.length;
    } catch {
      // 編集中に対象段落が消えた場合、更新できた段落分だけを返す
    }
  }
  return changed;
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
 * step 配下から、指定ラベルの付いたテーブルを探す。
 * グラフや履歴からの追加を「表に書く」形にするときの受け皿を見つけるのに使う。
 * material / tool / output は行が育つ表、attribute は列が育つパラメータ表。
 */
export function findLabeledTableInStep(
  doc: any[],
  labels: Map<string, string> | undefined,
  stepBlockId: string,
  label: "material" | "tool" | "output" | "attribute",
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

// ── 外部参照アウトプットの表行受け取り ──
//
// 別ノートの output を受けるときは、本文 span ではなく [インプット] 表の行に
// する（D-1 案 / 2026-08-23 合意）。グラフからの追加と同じ「試料表が育つ」
// 書き込み口（appendEntityRowToTable）に乗せ、行は tableRowIdentity で
// 追跡する。属性は持ってこない — 条件は参照元を開いて見る。

import { appendEntityRowToTable, removeTableRowAt, setTableCellAt } from "../../features/network-graph/table-row-edit";
import {
  TABLE_ROW_IDENTITY_STYLE,
  extractTableCellText,
  syncTableRowIdentitiesToEditor,
} from "../../lib/table-row-identity";

function rowIdentityOfCell(cell: any): string | null {
  const content = Array.isArray(cell) ? cell : cell?.content;
  const walk = (inlines: any[]): string | null => {
    for (const inline of inlines ?? []) {
      const value = inline?.styles?.[TABLE_ROW_IDENTITY_STYLE];
      if (typeof value === "string" && value) return value;
      if (inline?.type === "link" && Array.isArray(inline.content)) {
        const nested = walk(inline.content);
        if (nested) return nested;
      }
    }
    return null;
  };
  return walk(content ?? []);
}

/** rowIdentity から所属テーブルと行名を引く（見つからなければ null） */
export function findRowByIdentity(
  doc: any[],
  rowIdentity: string,
): { tableBlockId: string; rowName: string; rowIndex: number } | null {
  if (!rowIdentity) return null;
  let found: { tableBlockId: string; rowName: string; rowIndex: number } | null = null;
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (found) return;
      if (b?.type === "table" && Array.isArray(b.content?.rows)) {
        const rows: any[] = b.content.rows;
        for (let i = 1; i < rows.length; i += 1) {
          if (rowIdentityOfCell(rows[i]?.cells?.[0]) === rowIdentity) {
            found = {
              tableBlockId: b.id,
              rowName: extractTableCellText(rows[i].cells[0]),
              rowIndex: i - 1,
            };
            return;
          }
        }
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(doc ?? []);
  return found;
}

/**
 * 外部参照の受け取り: step の [インプット] 表に行を足し、その行の
 * tableRowIdentity を返す（表が無ければ作る。ラベル付与は呼び出し側）。
 *
 * @returns rowIdentity（リンクの sourceEntityId として保存する）。失敗時 null
 */
export function appendExternalInputRowToStep(
  editor: any,
  stepBlockId: string,
  label: string,
  findLabeledTableId: (stepBlockId: string) => string | null,
  headerName: string,
): { rowIdentity: string; tableBlockId: string; created: boolean } | null {
  const trimmed = label.trim();
  if (!editor || !trimmed) return null;
  const result = appendEntityRowToTable(editor, stepBlockId, trimmed, findLabeledTableId, headerName);
  if (!result) return null;
  // 追加した行（と、まだ未採番の既存行）へ identity を振る。
  // 保存時の normalizeTableRowIdentities と同じ規則なので保存でも維持される
  syncTableRowIdentitiesToEditor(editor);
  const table = findBlockById(editor.document ?? [], result.tableBlockId);
  const rows: any[] = table?.content?.rows ?? [];
  for (const row of rows.slice(1)) {
    if (extractTableCellText(row?.cells?.[0]) !== trimmed) continue;
    const identity = rowIdentityOfCell(row.cells[0]);
    if (identity) return { rowIdentity: identity, ...result };
  }
  return null;
}

/** 外部参照の行の名前を追随更新する（rowIdentity で行を特定。同名行があっても誤爆しない） */
export function updateExternalInputRowText(
  editor: any,
  rowIdentity: string,
  text: string,
): boolean {
  const trimmed = text.trim();
  if (!editor || !trimmed) return false;
  const hit = findRowByIdentity(editor.document ?? [], rowIdentity);
  if (!hit || hit.rowName === trimmed) return false;
  return setTableCellAt(editor, hit.tableBlockId, hit.rowIndex, 0, trimmed);
}

/** 外部参照の行を削除する（rowIdentity で行を特定。同名行があっても誤爆しない） */
export function removeExternalInputRow(editor: any, rowIdentity: string): boolean {
  if (!editor) return false;
  const hit = findRowByIdentity(editor.document ?? [], rowIdentity);
  if (!hit) return false;
  return removeTableRowAt(editor, hit.tableBlockId, hit.rowIndex);
}

/**
 * 外部参照行の名前テキストに @メンションと同じリンク色を付ける。
 * blue = リンク生存、red = リンク切れ。textColor は BlockNote 標準スタイル
 * なので旧ビルドでも throw しない（@ノートリンクと同じ表現に揃える）。
 */
export function setExternalInputRowLinkColor(
  editor: any,
  rowIdentity: string,
  color: "blue" | "red",
): boolean {
  if (!editor) return false;
  const hit = findRowByIdentity(editor.document ?? [], rowIdentity);
  if (!hit) return false;
  const table = findBlockById(editor.document ?? [], hit.tableBlockId);
  const rows: any[] = table?.content?.rows ?? [];
  const row = rows[hit.rowIndex + 1];
  if (!row) return false;
  const cell = row.cells?.[0];
  const content = Array.isArray(cell) ? cell : cell?.content;
  if (!Array.isArray(content)) return false;
  let changed = false;
  const next = content.map((inline: any) => {
    if (inline?.type !== "text") return inline;
    if (inline.styles?.textColor === color) return inline;
    changed = true;
    return { ...inline, styles: { ...(inline.styles ?? {}), textColor: color } };
  });
  if (!changed) return false;
  const nextCell = Array.isArray(cell) ? next : { ...cell, content: next };
  const nextRows = rows.map((r, i) =>
    i === hit.rowIndex + 1 ? { ...r, cells: [nextCell, ...r.cells.slice(1)] } : r,
  );
  try {
    editor.updateBlock(hit.tableBlockId, { content: { ...table.content, rows: nextRows } });
    return true;
  } catch {
    return false;
  }
}
