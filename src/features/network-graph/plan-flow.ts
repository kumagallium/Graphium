// ──────────────────────────────────────────────
// 工程フローのグラフ構築（純関数）
//
// 計画ノート（「計画」フォルダに入っているノート）のインデックステーブル
// （note-link 列を持つ表）の行 = 工程ノートを、StepFlowView に流す
// FlowGraphData へ組み立てる。docs/internal/note-chain-plan.md §2.3。
//
// 表の行→ノートは page.tableMeta[blockId].noteLinks（キー = 1 列目セルの
// 表示テキスト）。ノート作成後はセルが "@名前" に書き換わり、noteLinks には
// "名前" と "@名前" の両キーが残りうる（src/features/index-table/icon-layer.tsx
// handleCreateNote / create-note-from-row.ts createNoteFromRow）。
//
// 工程ノードの出力 = そのノートの ProcessIndex 上のグラフで
//   (a) 末端 output（used の始点になっていない output）
//   (b) 他の工程ノートの crossNoteLinks から参照されている output（途中でも）
// の和集合。工程ノートが自分も計画ノート（入れ子）なら、自分の工程チェーンを
// 再帰的に辿って末端出力を持ち上げる（視覚上は 1 ノードのまま）。
// ──────────────────────────────────────────────

import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import { findIncomingReferences } from "../navigation/index-file";
import type {
  ProcessIndex,
  ProcessIndexEntry,
  CrossNoteOutputRef,
} from "./process-index";
import { resolveCrossNoteOutput } from "./process-index";
import type {
  ActivityParam,
  FlowEdge,
  FlowEntity,
  FlowGraphData,
  FlowStep,
} from "./activity-graph-adapter";
import type { BlockLink } from "../../lib/block-link-types";
import type { GraphiumDocument, TableMeta } from "../../lib/document-types";
import { readCellText, collectTableBlocks } from "../table-meta/table-cells";
import { hasColumnType, findColumnNameByType } from "../table-meta/types";
import { isPlanNote } from "../note-context/reserved-folders";
import { t } from "../../i18n";

// ── 表の行 ──

export type OperationRowState = "unlinked" | "duplicateName" | "trashed" | "archived";

export type OperationRow = {
  rowIndex: number;
  tableBlockId: string;
  /** 1 列目セルの表示テキスト（"@名前" 形式のこともある） */
  name: string;
  noteId: string | null;
  /** 2 列目以降。ヘッダ名があれば "ヘッダ: 値"、空セルは出さない（planned-input 列は含まない） */
  attrs: ActivityParam[];
  state?: OperationRowState;
  /** ColumnType "planned-input" の列セルを parsePlannedInputs したもの。列が無ければ [] */
  plannedFrom: string[];
};

// ── 予定の線（入力元セル） ──

/** 入力元セルで名前を区切る既定の区切り文字（書き出し用） */
export const PLANNED_INPUT_SEPARATOR = "、";

/**
 * 入力元セルの文字列を行名の配列に分解する。
 * 区切りは「、」「,」「，」「;」「\n」のいずれか。各名前は trim し、先頭 "@" を外し、
 * 大文字小文字を区別せず重複を除く（先に出た表記を残す）。
 */
export function parsePlannedInputs(cell: string): string[] {
  const parts = cell.split(/[、,，;\n]+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of parts) {
    let name = raw.trim();
    if (!name) continue;
    if (name.startsWith("@")) name = name.slice(1).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/** 行名の配列を入力元セルの文字列に書き出す */
export function formatPlannedInputs(names: string[]): string {
  return names.join(PLANNED_INPUT_SEPARATOR);
}

/** 表示名を正規化する（同名判定・noteLinks フォールバック用）。trim・小文字・先頭 "@" を除く */
function normalizeOperationName(name: string): string {
  const trimmed = name.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}

/** noteLinks から行名でノート ID を引く。"名前" ⇄ "@名前" のどちらのキーでも解決する */
function resolveRowNoteId(noteLinks: Record<string, string> | undefined, name: string): string | null {
  if (!noteLinks) return null;
  if (noteLinks[name]) return noteLinks[name];
  if (name.startsWith("@")) {
    return noteLinks[name.slice(1)] ?? null;
  }
  return noteLinks[`@${name}`] ?? null;
}

/**
 * 「+ 工程を追加」で足す新しい行のデフォルト名を決める。
 * n = 既存の行数 + 1 から始め、同名（正規化して比較）が既にあれば n を進める。
 * 表がまだ 1 つも無いときは existingNames に [] を渡す（n = 1 から）。
 */
export function nextDefaultOperationName(existingNames: string[]): string {
  const normalized = new Set(existingNames.map(normalizeOperationName));
  let n = existingNames.length + 1;
  while (normalized.has(normalizeOperationName(t("planFlow.defaultOperationName", { n: String(n) })))) {
    n++;
  }
  return t("planFlow.defaultOperationName", { n: String(n) });
}

/**
 * 計画ノートの本文（ブロック列 + tableMeta）から工程行を集める（複数表可、出現順・行順）。
 * ヘッダ行は除く。1 列目が空の行はスキップする。
 *
 * ライブエディタの editor.document（BlockNote の生ブロック）+
 * useTableMetaStore().getSnapshot() の組にもそのまま使える形に切り出した
 * （collectOperationRows は保存済み doc からこれを呼ぶ薄いラッパー）。
 */
export function collectOperationRowsFromBlocks(
  blocks: any[],
  tableMeta: Record<string, TableMeta> | undefined,
  index?: GraphiumIndex | null,
): OperationRow[] {
  const tableBlocks = collectTableBlocks(blocks ?? []);
  const rows: OperationRow[] = [];
  const seenNames = new Set<string>();

  for (const [blockId, block] of tableBlocks) {
    const meta: TableMeta | undefined = tableMeta?.[blockId];
    if (!hasColumnType(meta, "note-link")) continue;

    const tableRows: any[] = block?.content?.rows ?? [];
    if (tableRows.length === 0) continue;
    const headerRow = tableRows[0];

    // "planned-input" 列（既定名「入力元」）の列番号をヘッダから探す。無ければ -1（plannedFrom は常に []）
    const plannedInputColumnName = findColumnNameByType(meta, "planned-input");
    let plannedInputColIndex = -1;
    if (plannedInputColumnName && headerRow) {
      const headerCells: any[] = headerRow.cells ?? [];
      for (let c = 0; c < headerCells.length; c++) {
        if (readCellText(headerCells[c]) === plannedInputColumnName) {
          plannedInputColIndex = c;
          break;
        }
      }
    }

    for (let i = 1; i < tableRows.length; i++) {
      const row = tableRows[i];
      const cells: any[] = row?.cells ?? [];
      const rawName = readCellText(cells[0]);
      if (!rawName) continue;

      const normalized = normalizeOperationName(rawName);
      let noteId: string | null = null;
      let state: OperationRowState | undefined;

      if (seenNames.has(normalized)) {
        state = "duplicateName";
      } else {
        seenNames.add(normalized);
        noteId = resolveRowNoteId(meta?.noteLinks, rawName);
        if (noteId && index) {
          const entry = index.notes.find((n) => n.noteId === noteId);
          if (entry?.deletedAt) state = "trashed";
          else if (entry?.archivedAt) state = "archived";
        }
        if (!noteId) state = "unlinked";
      }

      const attrs: ActivityParam[] = [];
      let plannedFrom: string[] = [];
      for (let c = 1; c < cells.length; c++) {
        if (c === plannedInputColIndex) {
          plannedFrom = parsePlannedInputs(readCellText(cells[c]));
          continue;
        }
        const value = readCellText(cells[c]);
        if (!value) continue;
        const headerName = headerRow ? readCellText(headerRow.cells?.[c]) : "";
        attrs.push({ label: headerName ? `${headerName}: ${value}` : value });
      }

      rows.push({ rowIndex: i, tableBlockId: blockId, name: rawName, noteId, attrs, state, plannedFrom });
    }
  }

  return rows;
}

/**
 * 計画ノートの本文から工程行を集める（先頭ページの表のみ）。
 * 保存済み doc（page.blocks + page.tableMeta）向けの薄いラッパー。
 */
export function collectOperationRows(
  doc: GraphiumDocument,
  index?: GraphiumIndex | null,
): OperationRow[] {
  const page = doc.pages?.[0];
  if (!page) return [];
  return collectOperationRowsFromBlocks(page.blocks ?? [], page.tableMeta, index);
}

/**
 * 入力元セルの 1 名前を工程行に解決する。先頭 "@" を外し trim・小文字で行名と照合する。
 * 同名の行が複数あれば先に出た行を採る（duplicateName の扱いと揃える）。解決できなければ null
 */
export function resolvePlannedRow(rows: OperationRow[], name: string): OperationRow | null {
  const target = normalizeOperationName(name);
  for (const row of rows) {
    if (normalizeOperationName(row.name) === target) return row;
  }
  return null;
}

/**
 * fromName → toName という予定の線を足すと循環になるか判定する（行名ベース、純関数）。
 * rows が既に持つ plannedFrom を「入力元 → 行」の辺として、to から from に到達できれば
 * 循環になる。fromName と toName が同じ行（自己参照）も常に true。
 */
export function wouldCreatePlannedCycle(
  rows: OperationRow[],
  fromName: string,
  toName: string,
): boolean {
  const from = normalizeOperationName(fromName);
  const to = normalizeOperationName(toName);
  if (from === to) return true;

  const adjacency = new Map<string, string[]>();
  for (const row of rows) {
    const rowKey = normalizeOperationName(row.name);
    for (const inputName of row.plannedFrom) {
      const inputKey = normalizeOperationName(inputName);
      const list = adjacency.get(inputKey);
      if (list) list.push(rowKey);
      else adjacency.set(inputKey, [rowKey]);
    }
  }

  const visited = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

// ── index から取れる工程集合 ──

/**
 * 計画ノートの outgoingLinks から工程ノート id を出現順・dedupe で返す。
 *
 * outgoingLinks には表由来（layer "knowledge"）と doc.noteLinks 由来（layer "prov"）が
 * 同じ target で重複して入る（index-file.ts buildIndexEntry。表由来はさらに旧キー・
 * 新キー分の二重書きもありうる）。ここでは layer を区別せず targetNoteId で dedupe する
 * （「どちらの層か」は行の対応関係を持たない index からは分からないため）。
 */
export function collectOperationNoteIds(index: GraphiumIndex, planNoteId: string): string[] {
  const entry = index.notes.find((n) => n.noteId === planNoteId);
  if (!entry) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const link of entry.outgoingLinks) {
    if (seen.has(link.targetNoteId)) continue;
    seen.add(link.targetNoteId);
    result.push(link.targetNoteId);
  }
  return result;
}

/**
 * 指定ノートを工程に持つ計画ノートを列挙する（findIncomingReferences ∩ 計画ノート）。
 * アーカイブ済み・ゴミ箱の計画ノートは除外する。modifiedAt 降順。
 */
export function findPlanNotesOf(index: GraphiumIndex | null, noteId: string): NoteIndexEntry[] {
  if (!index) return [];
  return findIncomingReferences(index, noteId)
    .filter((n) => isPlanNote(n.noteContexts) && !n.archivedAt && !n.deletedAt)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/**
 * targetNoteId を参照している cross-note リンクを全件走査で逆引きする。
 * ProcessIndexEntry.crossNoteLinks は発信リンクのキャッシュのみなので、逆方向は
 * ここで毎回導出する（読み取り専用、process-index-design.md P-1〜P-3 に抵触しない）。
 */
export function collectCrossNoteReferencesTo(
  processIndex: ProcessIndex | null,
  targetNoteId: string,
): { fromNoteId: string; link: BlockLink }[] {
  if (!processIndex) return [];
  const result: { fromNoteId: string; link: BlockLink }[] = [];
  for (const process of processIndex.processes) {
    for (const link of process.crossNoteLinks ?? []) {
      if (link.type !== "informed_by") continue;
      if (link.targetNoteId !== targetNoteId) continue;
      result.push({ fromNoteId: process.noteId, link });
    }
  }
  return result;
}

// ── 工程フローの組み立て ──

export const PLAN_FLOW_MAX_DEPTH = 8;

export type PlanFlowResult = {
  graph: FlowGraphData;
  truncated: boolean;
  brokenCount: number;
  /** 入力元セルに書かれたが行名として解決できなかった名前（存在しない行名など） */
  unresolvedPlanned: { rowName: string; name: string }[];
};

/** 行の FlowStep id（steps 配列の id と同じ規則。行が未作成なら表の位置で仮の id にする） */
function stepIdOfRow(row: OperationRow): string {
  return row.noteId ? `note:${row.noteId}` : `row:${row.tableBlockId}:${row.rowIndex}`;
}

/** entity の同一性キー（process-index.ts の outputIdentity と同じ規則） */
function outputIdentityOf(entity: FlowEntity): string {
  return entity.rowIdentity ?? entity.entityId ?? entity.id;
}

/** グラフ内で kind "used" の始点になっていない output = 末端 */
function terminalOutputs(graph: FlowGraphData): FlowEntity[] {
  const usedSources = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "used") usedSources.add(edge.source);
  }
  return graph.entities.filter((e) => e.kind === "output" && !usedSources.has(e.id));
}

function stripLeadingAt(name: string): string {
  return name.startsWith("@") ? name.slice(1) : name;
}

export function buildPlanFlowGraph(input: {
  rows: OperationRow[];
  index: GraphiumIndex | null;
  processIndex: ProcessIndex | null;
}): PlanFlowResult {
  const { rows, index, processIndex } = input;

  const steps: FlowStep[] = rows.map((row) => ({
    id: stepIdOfRow(row),
    name: stripLeadingAt(row.name),
    params: row.attrs,
    noteRef: {
      noteId: row.noteId,
      tableBlockId: row.tableBlockId,
      rowIndex: row.rowIndex,
      state: row.state,
    },
  }));

  const entities: FlowEntity[] = [];
  const entityIds = new Set<string>();
  const edges: FlowEdge[] = [];
  const edgeIds = new Set<string>();
  let brokenCount = 0;
  let truncated = false;

  // 深さ制御・循環防止は「経路上の祖先集合」で行う（rows 間で共有しない）。
  // ダイヤモンド（2 つの工程行から入れ子経由で同じ深いノートへ到達する）では
  // 両方の工程に output を出したいので、visited を呼び出し全体で共有すると
  // 片方が黙って欠落する。祖先集合は expand() の再帰チェーンごとに複製して渡す。
  //
  // (深いノート, topOwner) の組ごとに 1 回だけ展開する（同じ組を複数の経路から
  // 辿っても、entity/edge 側は id で dedupe されるため実害は無いが、無駄な再帰を防ぐ）。
  const processedPairs = new Set<string>();
  // 各「深いノート」が、どの可視ノード（工程ノート由来 step）へ出力をぶら下げるか。
  // ダイヤモンドでは 1 つの深いノートが複数の topOwner を持ちうるので Set にする。
  const ownersByDeepNote = new Map<string, Set<string>>();
  // (深いノート, topOwner) の組。ProcessIndex に投影されている（＝計画ノートではない）もの
  const leafPairs: { deepNoteId: string; topOwner: string }[] = [];

  function processEntryOf(noteId: string): ProcessIndexEntry | undefined {
    return processIndex?.processes.find((p) => p.noteId === noteId);
  }

  function noteEntryOf(noteId: string): NoteIndexEntry | undefined {
    return index?.notes.find((n) => n.noteId === noteId);
  }

  // 深いノートの木を辿り、末端（非計画ノート）を leafPairs に集める。
  // topOwnerNoteId = 上の層から見える可視 step の id 用ノート id。
  // ancestors = この再帰チェーン上に既に登場した深いノート id（真の循環検出用）。
  function expand(
    deepNoteId: string,
    topOwnerNoteId: string,
    depth: number,
    ancestors: Set<string>,
  ): void {
    if (ancestors.has(deepNoteId)) return; // 経路上の祖先＝真の循環。truncated にはしない

    const pairKey = `${deepNoteId}::${topOwnerNoteId}`;
    if (processedPairs.has(pairKey)) return; // 同じ組は既に展開済み
    processedPairs.add(pairKey);

    if (depth > PLAN_FLOW_MAX_DEPTH) {
      truncated = true;
      return;
    }

    const entry = noteEntryOf(deepNoteId);
    const isPlan = index ? isPlanNote(entry?.noteContexts) : false;

    if (isPlan && index) {
      const childIds = collectOperationNoteIds(index, deepNoteId);
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(deepNoteId);
      for (const childId of childIds) {
        expand(childId, topOwnerNoteId, depth + 1, nextAncestors);
      }
      return;
    }

    if (processEntryOf(deepNoteId)) {
      leafPairs.push({ deepNoteId, topOwner: topOwnerNoteId });
      let owners = ownersByDeepNote.get(deepNoteId);
      if (!owners) {
        owners = new Set<string>();
        ownersByDeepNote.set(deepNoteId, owners);
      }
      owners.add(topOwnerNoteId);
    }
    // ProcessIndex に無い（未投影・step 無し）深いノートは何も出さない
  }

  for (const row of rows) {
    // ゴミ箱・アーカイブ済み・未作成・同名衝突の行は工程チェーンを辿らない
    if (!row.noteId || row.state) continue;
    // 祖先集合は行（= トップレベルの工程）ごとに新規に作る（rows 間で共有しない）
    expand(row.noteId, row.noteId, 0, new Set<string>());
  }

  // (deepNoteId, topOwner, identity) → 可視化した FlowEntity の id
  const deepEntityIndex = new Map<string, string>();

  function ensureEntity(entity: FlowEntity): void {
    if (entityIds.has(entity.id)) return;
    entityIds.add(entity.id);
    entities.push(entity);
  }

  function ensureEdge(edge: FlowEdge): void {
    if (edgeIds.has(edge.id)) return;
    edgeIds.add(edge.id);
    edges.push(edge);
  }

  // Step 1: 各末端（非計画）工程ノートの output のうち末端 output を可視化する。
  // 途中 output（他ノートから参照されているだけのもの）は Step 2 の解決時に
  // 見つかり次第、遅延して追加する。
  for (const { deepNoteId, topOwner } of leafPairs) {
    const process = processEntryOf(deepNoteId)!;
    const terminals = terminalOutputs(process.graph);
    for (const entity of terminals) {
      const identity = outputIdentityOf(entity);
      const visibleId = `note:${topOwner}#${entity.id}`;
      // entityId / tableRef は元ノート側の編集経路を指すため引き継がない（工程フローの
      // entity は表示専用。D4: v1 は表で編集、フロー側は読み取りだけ）
      ensureEntity({ id: visibleId, label: entity.label, kind: "output", attrs: entity.attrs });
      ensureEdge({
        id: `generates:${visibleId}`,
        kind: "generates",
        source: `note:${topOwner}`,
        target: visibleId,
      });
      deepEntityIndex.set(`${deepNoteId}::${topOwner}::${identity}`, visibleId);
    }
  }

  // Step 2: 参照側工程ノートの crossNoteLinks を used エッジへ変換する。
  // 対象は「計画に属する工程ノート集合（入れ子含む）」に限る（計画外参照は出さない）。
  for (const { deepNoteId, topOwner: consumerTopOwner } of leafPairs) {
    const process = processEntryOf(deepNoteId)!;
    for (const link of process.crossNoteLinks ?? []) {
      if (link.type !== "informed_by") continue;
      const targetNoteId = link.targetNoteId;
      const stepId = link.targetBlockId;
      const entityIdentity = link.targetEntityId;
      if (!targetNoteId || !entityIdentity) continue;
      const producerOwners = ownersByDeepNote.get(targetNoteId);
      if (!producerOwners) continue; // 計画外（このグラフに無い）参照は出さない

      const ref: CrossNoteOutputRef = {
        noteId: targetNoteId,
        stepId,
        entityIdentity,
        sourceModifiedAt: link.targetSourceModifiedAt,
        identityStable: link.targetEntityStable,
        outputIndex: link.targetEntityIndex,
        outputCount: link.targetEntityCount,
      };
      const resolved = resolveCrossNoteOutput(processIndex, ref);

      if (!resolved) {
        brokenCount++;
        // ダイヤモンドで producer が複数オーナーを持っていても broken 表示は代表 1 つでよい
        const producerTopOwner = producerOwners.values().next().value!;
        const brokenId = `note:${producerTopOwner}#broken:${link.id}`;
        ensureEntity({
          id: brokenId,
          label: link.targetEntityLabel ?? link.targetStepTitle ?? entityIdentity,
          kind: "output",
          attrs: [],
        });
        ensureEdge({
          id: `used:${brokenId}->note:${consumerTopOwner}`,
          kind: "used",
          source: brokenId,
          target: `note:${consumerTopOwner}`,
          broken: true,
        });
        continue;
      }

      // producer が複数オーナー（ダイヤモンド）を持つ場合、そのすべてのオーナー配下に
      // entity を出す（entity id は owner ごとに別ノードになる設計）
      for (const producerTopOwner of producerOwners) {
        // 解決できたが末端出力ではなかった（＝途中 output）場合、ここで初めて可視化する
        const key = `${targetNoteId}::${producerTopOwner}::${resolved.entityIdentity}`;
        let visibleId = deepEntityIndex.get(key);
        if (!visibleId) {
          const targetProcess = processEntryOf(targetNoteId);
          const sourceEntity = targetProcess?.graph.entities.find(
            (e) => outputIdentityOf(e) === resolved.entityIdentity,
          );
          visibleId = `note:${producerTopOwner}#${sourceEntity?.id ?? resolved.entityIdentity}`;
          ensureEntity({
            id: visibleId,
            label: resolved.label,
            kind: "output",
            attrs: (resolved.attrs ?? []).map((a) =>
              a.key ? { label: `${a.key}: ${a.value}` } : { label: a.value },
            ),
          });
          ensureEdge({
            id: `generates:${visibleId}`,
            kind: "generates",
            source: `note:${producerTopOwner}`,
            target: visibleId,
          });
          deepEntityIndex.set(key, visibleId);
        }

        ensureEdge({
          id: `used:${visibleId}->note:${consumerTopOwner}`,
          kind: "used",
          source: visibleId,
          target: `note:${consumerTopOwner}`,
        });
      }
    }
  }

  // ── 予定の線（planned-input 列）──
  // rows.plannedFrom を行名解決し、(fromStepId, toStepId) の予定ペアを集める。
  // 解決できない名前は unresolvedPlanned に積んで無視する。
  const unresolvedPlanned: { rowName: string; name: string }[] = [];
  const plannedPairs: { fromStepId: string; toStepId: string }[] = [];
  const plannedPairKeys = new Set<string>();

  for (const row of rows) {
    if (row.plannedFrom.length === 0) continue;
    const toStepId = stepIdOfRow(row);
    for (const inputName of row.plannedFrom) {
      const fromRow = resolvePlannedRow(rows, inputName);
      if (!fromRow) {
        unresolvedPlanned.push({ rowName: stripLeadingAt(row.name), name: inputName });
        continue;
      }
      const fromStepId = stepIdOfRow(fromRow);
      const key = `${fromStepId}->${toStepId}`;
      if (plannedPairKeys.has(key)) continue;
      plannedPairKeys.add(key);
      plannedPairs.push({ fromStepId, toStepId });
    }
  }

  // 計画に予定の線が 1 本もなければ、実績の used エッジに plan フラグを一切付けない
  const hasAnyPlanned = plannedPairs.length > 0;
  const matchedPlannedKeys = new Set<string>();

  if (hasAnyPlanned) {
    // entity id → それを generates した step id（実績の突き合わせ用）
    const producerByEntity = new Map<string, string>();
    for (const edge of edges) {
      if (edge.kind === "generates") producerByEntity.set(edge.target, edge.source);
    }
    for (const edge of edges) {
      if (edge.kind !== "used") continue;
      const producerStepId = producerByEntity.get(edge.source);
      if (!producerStepId) continue; // broken 等、生産元が特定できない used は突き合わせない
      const key = `${producerStepId}->${edge.target}`;
      if (plannedPairKeys.has(key)) {
        edge.plan = "asPlanned";
        matchedPlannedKeys.add(key);
      } else {
        edge.plan = "unplanned";
      }
    }
  }

  // 実績（asPlanned で突き合わせ済み）が無い予定ペアだけ、予定の線として描く
  for (const { fromStepId, toStepId } of plannedPairs) {
    const key = `${fromStepId}->${toStepId}`;
    if (matchedPlannedKeys.has(key)) continue;
    ensureEdge({
      id: `planned:${fromStepId}:${toStepId}`,
      kind: "planned",
      source: fromStepId,
      target: toStepId,
    });
  }

  // ── 表示するアウトプットを「実際に他の工程へ渡った物」に絞る ──
  // どの工程にも使われていないアウトプット（計画の最終成果物を含む）は出さない。
  // 出したままだと、ポートを掴めるのに引くと生成元の工程からの予定線ができる、という
  // ずれが生まれる。規則は 1 つにして、最後の工程の成果物も例外にしない（2026-09-16 合意）。
  // 「計画どおり / 計画外」の突き合わせは上で used の生成元を工程まで遡って済ませてあるので、
  // ここで generates だけの出力を落としても判定は変わらない
  const passedOn = new Set(edges.filter((e) => e.kind === "used").map((e) => e.source));
  const shownEntities = entities.filter((e) => passedOn.has(e.id));
  const shownIds = new Set(shownEntities.map((e) => e.id));
  const shownEdges = edges.filter((e) => e.kind !== "generates" || shownIds.has(e.target));

  return {
    graph: { steps, entities: shownEntities, edges: shownEdges },
    truncated,
    brokenCount,
    unresolvedPlanned,
  };
}
