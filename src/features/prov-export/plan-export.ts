// ──────────────────────────────────────────────
// 計画（Plan）の PROV-JSON-LD 書き出し
//
// 計画ノート（「計画」フォルダのノート）の表の行 = 工程ノートを、P-Plan の
// Plan / Step / Variable と、各工程ノートの手順グラフ（Activity / Entity）を
// 1 つの @graph に並置して書き出す。
//
// - 純関数。DOM / React / Node 固有 API に依存しない（MCP サーバーの Node からも呼ぶ）。
// - ノートごとの部分は note-export.ts の buildNoteProvGraph を再利用する（idPrefix はそのノート）。
// - 予定の線（入力元セル）は p-plan:Variable / isPreceededBy で、
//   実績の受け渡し（graphium:crossNoteLinks）は供給側ノートの出力ノードへの Usage / Derivation で出す。
// - 「計画どおり / 計画外 / 予定だけ」は独自語で出さない。読み手が Usage と
//   correspondsToStep / hasInputVar から判定する（手順は docs/ARCHITECTURE.md）。
// - collectOperationRows は先頭ページの表だけを読む（plan-flow.ts と同じ）。
// - バレル（prov-generator/index.ts）経由でなく個別ファイルから import する。
// ──────────────────────────────────────────────

import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import { isSystemActivity, type ProvJsonLd, type CrossNoteLinkRef } from "../prov-generator/generator";
import { isPlanNote } from "../note-context/reserved-folders";
import {
  collectOperationRows,
  normalizeOperationName,
  resolvePlannedRow,
  PLAN_FLOW_MAX_DEPTH,
  type OperationRow,
} from "../network-graph/plan-flow";
import {
  convertDocumentProvenance,
  toW3CLabel,
  type W3CProvDocument,
  type W3CProvNode,
  type WikiEntityInfo,
} from "./export-jsonld";
import {
  buildNoteProvGraph,
  buildProvExportContext,
  dedupeStubs,
  noteIriOf,
  type NoteProvExportInput,
  type NoteProvExtras,
} from "./note-export";

// 孤立サロゲートを含む文字列で encodeURIComponent が URIError を投げないよう、先に整形する
const enc = (s: string): string => encodeURIComponent((s as string & { toWellFormed?: () => string }).toWellFormed?.() ?? s);
const ref = (id: string): { "@id": string } => ({ "@id": id });

// ── 入力の型 ──

export type PlanProvExportInput = {
  planNoteId: string;
  index: GraphiumIndex;
  /** 計画ノート＋工程ノート（入れ子も）。無いものは外部扱い */
  docs: Map<string, GraphiumDocument>;
  notes: Map<
    string,
    {
      provDoc: ProvJsonLd;
      title: string;
      page: GraphiumPage;
      extras?: NoteProvExtras;
      wikiEntities?: WikiEntityInfo[];
    }
  >;
  options?: NoteProvExportInput["options"];
};

// ── 内部の型 ──

/**
 * 入れ子の再帰の深さ上限（plan-flow と同じ）。
 * plan-flow はルートの行ノートを深さ 0 とし、深さ > 8 で打ち切る。
 * 行ノートの深さは、その行を持つ visit.depth（ルート計画 = 0）と同値。
 */
const MAX_DEPTH = PLAN_FLOW_MAX_DEPTH;

type PlanVisit = {
  planId: string;
  depth: number;
  rows: OperationRow[];
  parentPlanId?: string;
  /** この計画ノートが親計画の行（MultiStep）として現れたときの Step */
  viaStepIri?: string;
  /** 行の正規化名 → Step の IRI（duplicateName の行は含まない） */
  stepIris: Map<string, string>;
  /** 予定の線 "<normA>\u0000<normB>" → Variable の IRI */
  vars: Map<string, string>;
  /** normA → 予定の消費先（normB）の集合 */
  consumers: Map<string, Set<string>>;
};

type RowRef = { visit: PlanVisit; row: OperationRow; stepIri: string };

type EmittedNote = {
  noteId: string;
  provDoc: ProvJsonLd;
  nodes: W3CProvNode[];
  byIri: Map<string, W3CProvNode>;
};

/** idPrefix から blank node 用のキーを作る（export-jsonld.ts の prefixKeyOf と同じ規則。非 export のため複製） */
function prefixKeyOf(idPrefix: string): string {
  return idPrefix
    .replace(/^graphium:/, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stripLeadingAt(name: string): string {
  return name.startsWith("@") ? name.slice(1) : name;
}

const PLAN_TYPES = ["Entity", "prov:Plan", "p-plan:Plan"];

/** 追記用: プロパティが配列でなければ作って push する */
function pushRef(node: W3CProvNode, key: string, iri: string): void {
  const list: { "@id": string }[] = Array.isArray(node[key]) ? node[key] : [];
  if (!list.some((r) => r["@id"] === iri)) list.push(ref(iri));
  node[key] = list;
}

/** @type に語を足す（文字列でも配列でも） */
function addType(node: W3CProvNode, type: string): void {
  const cur = node["@type"] as unknown;
  const list: string[] = Array.isArray(cur) ? [...cur] : [cur as string];
  if (!list.includes(type)) list.push(type);
  node["@type"] = list as any;
}

/** 出力ノードか（prov:wasGeneratedBy を持つ / result_ 始まり / inline_output_ 始まり） */
function isOutputNode(n: { "@id": string; "prov:wasGeneratedBy"?: unknown }): boolean {
  if (Array.isArray(n["prov:wasGeneratedBy"]) && n["prov:wasGeneratedBy"].length > 0) return true;
  return n["@id"].startsWith("result_") || n["@id"].startsWith("inline_output_");
}

/**
 * 供給側ノートの provDoc から、他ノートが参照した出力ノードを探す。
 * graphium:tableRowId 一致 → inline_output_<id> 厳密一致 → @id 一致 の順。
 */
function findOutputNode(provDoc: ProvJsonLd, entityId: string): string | undefined {
  const entities = provDoc["@graph"].filter((n) => n["@type"] === "prov:Entity" && isOutputNode(n));
  const stages: ((n: (typeof entities)[number]) => boolean)[] = [
    (n) => n["graphium:tableRowId"] === entityId,
    (n) => n["@id"] === `inline_output_${entityId}`,
    (n) => n["@id"] === entityId,
  ];
  for (const match of stages) {
    const hit = entities.find(match);
    if (hit) return hit["@id"];
  }
  return undefined;
}

/** 内容が完全に同じで @id も同じノードを 1 つにする（フォルダ・素材・人の Agent などが複数ノートで重なる） */
function dedupeIdentical(nodes: W3CProvNode[]): W3CProvNode[] {
  const seen = new Map<string, Set<string>>();
  const out: W3CProvNode[] = [];
  for (const n of nodes) {
    const id = n["@id"];
    if (typeof id !== "string") {
      out.push(n);
      continue;
    }
    const body = JSON.stringify(n);
    const bodies = seen.get(id);
    if (bodies) {
      if (bodies.has(body)) continue;
      bodies.add(body);
    } else {
      seen.set(id, new Set([body]));
    }
    out.push(n);
  }
  return out;
}

// ── 本体 ──

/**
 * 計画ノートの PROV-JSON-LD（W3C 形式）を組み立てる。
 * Plan / Step / Variable・工程ノートの手順グラフ・実績の受け渡し・編集履歴 Bundle・警告を含む。
 */
export function buildPlanProvJsonLd(input: PlanProvExportInput): W3CProvDocument {
  const { planNoteId, index, docs, notes } = input;
  const entryOf = (id: string) => index.notes.find((n) => n.noteId === id);
  const isPlan = (id: string) => isPlanNote(entryOf(id)?.noteContexts);

  // ── 警告 ──
  const warningNodes: W3CProvNode[] = [];
  const warnCounters = new Map<string, number>();
  function warn(
    planId: string,
    type: string,
    fields: { step?: string; name?: string; note?: string } = {},
  ): void {
    const n = (warnCounters.get(planId) ?? 0) + 1;
    warnCounters.set(planId, n);
    const node: W3CProvNode = {
      "@type": "graphium:Warning",
      "@id": `${noteIriOf(planId)}/warning/${n}`,
      "graphium:warningType": type,
    };
    if (fields.step) node["graphium:step"] = ref(fields.step);
    if (fields.name) node["graphium:name"] = fields.name;
    if (fields.note) node["graphium:note"] = ref(fields.note);
    warningNodes.push(node);
  }

  // ── フェーズ A: 計画の木を歩いて、行と出現回数を集める ──
  const visits: PlanVisit[] = [];
  const visitedPlans = new Set<string>();
  /** 行に現れるノート ID → 出現（state が無い行だけ） */
  const occurrences = new Map<string, RowRef[]>();
  /** 行が入れ子計画として再帰されたノート ID（MultiStep） */
  const recursedPlans = new Set<string>();
  const depthLimited: { visit: PlanVisit; row: OperationRow; stepIri: string }[] = [];
  /** 入れ子計画に分解された Step の IRI → 子計画のノート ID（再帰した行と、既に別の親が取った子計画を指す行） */
  const decomposedSteps = new Map<string, string>();
  /** 子計画のノート ID → 親計画のノート ID（最初の親を先頭に、ダイヤモンドの 2 つ目以降が続く） */
  const subPlanParents = new Map<string, string[]>();

  function walk(planId: string, depth: number, ancestors: Set<string>, parent?: { planId: string; stepIri: string }): void {
    const doc = docs.get(planId);
    visitedPlans.add(planId);
    const rows = doc ? collectOperationRows(doc, index) : [];
    const visit: PlanVisit = {
      planId,
      depth,
      rows,
      parentPlanId: parent?.planId,
      viaStepIri: parent?.stepIri,
      stepIris: new Map(),
      vars: new Map(),
      consumers: new Map(),
    };
    visits.push(visit);
    const nextAncestors = new Set(ancestors).add(planId);

    // Step の IRI を先に確定する（duplicateName の行は Step を持たない）
    for (const row of rows) {
      if (row.state === "duplicateName") continue;
      const norm = normalizeOperationName(row.name);
      visit.stepIris.set(norm, `${noteIriOf(planId)}/step/${enc(norm)}`);
    }

    for (const row of rows) {
      if (row.state || !row.noteId) continue;
      const stepIri = visit.stepIris.get(normalizeOperationName(row.name))!;
      const list = occurrences.get(row.noteId) ?? [];
      list.push({ visit, row, stepIri });
      occurrences.set(row.noteId, list);
    }

    // 入れ子: 行のノートが計画ノートのとき、循環・重複・深さ上限に当たらなければ再帰する。
    // 木は最初の親の下にだけ出す（2 つ目の親の Step は MultiStep にして同じ子 Plan を指す）。
    for (const row of rows) {
      if (row.state || !row.noteId || !isPlan(row.noteId)) continue;
      const stepIri = visit.stepIris.get(normalizeOperationName(row.name))!;
      const noteIri = noteIriOf(row.noteId);
      if (!docs.has(row.noteId)) {
        warn(planId, "plan-doc-missing", { step: stepIri, note: noteIri });
        continue;
      }
      if (nextAncestors.has(row.noteId)) {
        warn(planId, "nested-cycle", { step: stepIri, note: noteIri });
        continue;
      }
      if (visitedPlans.has(row.noteId)) {
        decomposedSteps.set(stepIri, row.noteId);
        const parents = subPlanParents.get(row.noteId) ?? [];
        if (!parents.includes(planId)) parents.push(planId);
        subPlanParents.set(row.noteId, parents);
        warn(planId, "nested-shared", { step: stepIri, note: noteIri });
        continue;
      }
      // plan-flow と同じ数え方: ルートの行ノート = 0、depth > 8 で打ち切り
      if (depth > MAX_DEPTH) {
        depthLimited.push({ visit, row, stepIri });
        continue;
      }
      recursedPlans.add(row.noteId);
      decomposedSteps.set(stepIri, row.noteId);
      subPlanParents.set(row.noteId, [planId]);
      walk(row.noteId, depth + 1, nextAncestors, { planId, stepIri });
    }
  }
  walk(planNoteId, 0, new Set());

  // ── フェーズ B: ノートの内容グラフを並べる（ノート ID ごとに 1 回）──
  const emitted = new Map<string, EmittedNote>();
  const noteNodes: W3CProvNode[] = [];
  const bundleNodes: W3CProvNode[] = [];

  function emitNote(noteId: string): EmittedNote | undefined {
    const done = emitted.get(noteId);
    if (done) return done;
    const entry = notes.get(noteId);
    if (!entry) return undefined;
    // 他ノート参照の関係は plan-export が実績の受け渡しとして自前で組むので crossNoteLinks は渡さない
    const nodes = buildNoteProvGraph({
      provDoc: entry.provDoc,
      title: entry.title,
      noteId,
      page: entry.page,
      wikiEntities: entry.wikiEntities,
      extras: entry.extras,
      options: input.options,
    });

    // 編集履歴 Bundle は noteId キーで並置する（題名は一意でないため）。
    // buildNoteProvGraph が題名キーで作った Bundle を外し、ノート Entity の結びも付け替える。
    const titleBundleIri = `graphium:documentProvenance/${enc(entry.title)}`;
    const kept = nodes.filter((n) => !(n["@type"] === "prov:Bundle" && n["@id"] === titleBundleIri));
    const noteNode = kept.find((n) => n["@id"] === noteIriOf(noteId));
    const bundle = entry.provDoc["graphium:documentProvenance"];
    if (bundle) {
      const bundleIri = `graphium:documentProvenance/${enc(noteId)}`;
      bundleNodes.push({
        "@type": "prov:Bundle",
        "@id": bundleIri,
        "@graph": convertDocumentProvenance(bundle, bundleIri),
      } as any);
      if (noteNode) noteNode["graphium:provenanceBundle"] = ref(bundleIri);
    } else if (noteNode) {
      delete noteNode["graphium:provenanceBundle"];
    }

    const byIri = new Map<string, W3CProvNode>();
    for (const n of kept) if (typeof n["@id"] === "string") byIri.set(n["@id"], n);
    const result: EmittedNote = { noteId, provDoc: entry.provDoc, nodes: kept, byIri };
    emitted.set(noteId, result);
    return result;
  }

  // ── 計画ごとに Plan / Step / Variable を出す ──
  const structureNodes: W3CProvNode[] = [];

  for (const visit of visits) {
    const planIri = noteIriOf(visit.planId);
    const doc = docs.get(visit.planId);

    // Plan（ノート Entity と同一）。ノート Entity の属性はそのまま、型だけ足す
    const planEmit = emitNote(visit.planId);
    let planNode: W3CProvNode | undefined = planEmit?.byIri.get(planIri);
    if (planNode) {
      planNode["@type"] = [...PLAN_TYPES] as any;
    } else {
      planNode = {
        "@type": [...PLAN_TYPES] as any,
        "@id": planIri,
        label: toW3CLabel(entryOf(visit.planId)?.title || doc?.title || visit.planId),
      };
      structureNodes.push(planNode);
    }
    const parentIds = subPlanParents.get(visit.planId) ?? [];
    if (parentIds.length === 1) planNode["p-plan:isSubPlanOfPlan"] = ref(noteIriOf(parentIds[0]));
    else if (parentIds.length > 1) planNode["p-plan:isSubPlanOfPlan"] = parentIds.map((id) => ref(noteIriOf(id))) as any;
    if (planEmit) noteNodes.push(...planEmit.nodes);

    // Step
    const stepNodes = new Map<string, W3CProvNode>();
    for (const row of visit.rows) {
      const norm = normalizeOperationName(row.name);
      if (row.state === "duplicateName") {
        warn(visit.planId, "duplicate-row", { name: row.name });
        continue;
      }
      const stepIri = visit.stepIris.get(norm)!;
      // 入れ子計画に分解された行（再帰した行・既に別の親が取った子計画を指す行）だけ MultiStep
      const isMulti = decomposedSteps.has(stepIri);
      const step: W3CProvNode = {
        "@type": (isMulti ? ["p-plan:Step", "p-plan:MultiStep"] : "p-plan:Step") as any,
        "@id": stepIri,
        label: toW3CLabel(stripLeadingAt(row.name)),
        "p-plan:isStepOfPlan": ref(planIri),
      };
      if (isMulti) step["p-plan:isDecomposedAsPlan"] = ref(noteIriOf(row.noteId!));

      if (row.noteId) {
        const noteIri = noteIriOf(row.noteId);
        if (row.state === "trashed" || row.state === "archived") {
          // ごみ箱・アーカイブ: Step のみ。ノートの実体は出さず、参照だけ残す
          step["rdfs:seeAlso"] = ref(noteIri);
          // 参照先が宙に浮かないよう外部スタブを宣言する（本体があれば dedupeStubs が落とす）
          structureNodes.push({
            "@type": "Entity",
            "@id": noteIri,
            label: toW3CLabel(entryOf(row.noteId)?.title || stripLeadingAt(row.name)),
            "graphium:external": true,
          });
          warn(visit.planId, "row-note-unavailable", { step: stepIri, note: noteIri });
        } else if (!row.state) {
          step["rdfs:seeAlso"] = ref(noteIri);
        }
      }
      step["graphium:tableBlockId"] = row.tableBlockId;
      if (row.tableCaption) step["graphium:tableCaption"] = row.tableCaption;
      step["graphium:rowIndex"] = row.rowIndex;
      const conditions = (row.cells ?? []).map((c) => ({
        ...(c.header ? { "rdfs:label": c.header } : {}),
        "rdf:value": c.value,
      }));
      if (conditions.length > 0) step["graphium:condition"] = conditions;

      stepNodes.set(norm, step);
      structureNodes.push(step);
    }

    // 工程ノートの内容グラフ。ノートが取れなければ外部スタブを宣言して seeAlso が宙に浮かないようにする
    for (const row of visit.rows) {
      if (row.state || !row.noteId) continue;
      if (recursedPlans.has(row.noteId) && visits.some((v) => v.planId === row.noteId)) continue; // 入れ子計画は自分の visit で出す
      const em = emitNote(row.noteId);
      if (em) {
        if (!noteNodes.includes(em.nodes[0])) noteNodes.push(...em.nodes);
      } else {
        structureNodes.push({
          "@type": "Entity",
          "@id": noteIriOf(row.noteId),
          label: toW3CLabel(entryOf(row.noteId)?.title || stripLeadingAt(row.name)),
          "graphium:external": true,
        });
      }
    }

    // 予定の線
    const edgeKeys = new Set<string>();
    const adjacency = new Map<string, Set<string>>();
    for (const rowB of visit.rows) {
      if (rowB.state === "duplicateName") continue;
      const normB = normalizeOperationName(rowB.name);
      const stepB = stepNodes.get(normB);
      if (!stepB) continue;
      for (const name of rowB.plannedFrom) {
        const rowA = resolvePlannedRow(visit.rows, name);
        if (!rowA) {
          warn(visit.planId, "unresolved-planned", { step: stepB["@id"], name });
          continue;
        }
        const normA = normalizeOperationName(rowA.name);
        if (normA === normB) continue; // 自己参照は捨てる
        const key = `${normA}\u0000${normB}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        const stepA = stepNodes.get(normA);
        if (!stepA) continue;

        const varIri = `${planIri}/var/${enc(normA)}/${enc(normB)}`;
        const variable: W3CProvNode = {
          "@type": "p-plan:Variable",
          "@id": varIri,
          "p-plan:isVariableOfPlan": ref(planIri),
          "p-plan:isOutputVarOf": ref(stepA["@id"]),
          "p-plan:isInputVarOf": ref(stepB["@id"]),
        };
        const lineName = rowB.inputLabels?.[normA]?.trim();
        if (lineName) variable.label = toW3CLabel(lineName);
        structureNodes.push(variable);
        pushRef(stepA, "p-plan:hasOutputVar", varIri);
        pushRef(stepB, "p-plan:hasInputVar", varIri);
        pushRef(stepB, "p-plan:isPreceededBy", stepA["@id"]);

        visit.vars.set(key, varIri);
        const cons = visit.consumers.get(normA) ?? new Set<string>();
        cons.add(normB);
        visit.consumers.set(normA, cons);
        const adj = adjacency.get(normA) ?? new Set<string>();
        adj.add(normB);
        adjacency.set(normA, adj);
      }
    }

    // 循環: 自分自身に戻って来られる Step ごとに 1 件（辺はそのまま出してある）
    for (const [norm, step] of stepNodes) {
      const seen = new Set<string>();
      const stack = [...(adjacency.get(norm) ?? [])];
      let onCycle = false;
      while (stack.length > 0 && !onCycle) {
        const cur = stack.pop()!;
        if (cur === norm) {
          onCycle = true;
          break;
        }
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const next of adjacency.get(cur) ?? []) stack.push(next);
      }
      if (onCycle) warn(visit.planId, "planned-cycle", { step: step["@id"] });
    }
  }

  // 深さ上限で再帰しなかった入れ子計画
  for (const d of depthLimited) {
    warn(d.visit.planId, "depth-limit", { step: d.stepIri, note: noteIriOf(d.row.noteId!) });
  }

  // 同じノートが複数の行に現れた
  for (const [noteId, list] of occurrences) {
    if (list.length < 2) continue;
    for (const occ of list) warn(occ.visit.planId, "ambiguous-step", { step: occ.stepIri, note: noteIriOf(noteId) });
  }

  // ── 実行と計画の対応（p-plan:correspondsToStep）──
  // 行がちょうど 1 つに決まる工程ノートの、stage 子でも system でもない Activity だけ
  for (const [noteId, list] of occurrences) {
    if (list.length !== 1 || noteId === planNoteId) continue;
    const em = emitted.get(noteId);
    if (!em) continue;
    const { stepIri } = list[0];
    const prefix = `${noteIriOf(noteId)}/`;
    for (const raw of em.provDoc["@graph"]) {
      if (raw["@type"] !== "prov:Activity") continue;
      if (raw["graphium:activityKind"] === "stage") continue;
      if (isSystemActivity(raw)) continue;
      const node = em.byIri.get(`${prefix}${raw["@id"]}`);
      if (!node) continue;
      node["@type"] = ["Activity", "p-plan:Activity"] as any;
      node["p-plan:correspondsToStep"] = ref(stepIri);
    }
  }

  // ── 実績の受け渡し（各工程ノートの graphium:crossNoteLinks）──
  const relationNodes: W3CProvNode[] = [];
  const declaredStubs = new Map<string, W3CProvNode>();
  const seenRelations = new Set<string>();

  for (const em of emitted.values()) {
    const refs: CrossNoteLinkRef[] = em.provDoc["graphium:crossNoteLinks"] ?? [];
    if (refs.length === 0) continue;
    const noteIdB = em.noteId;
    const prefixB = `${noteIriOf(noteIdB)}/`;
    const relKey = prefixKeyOf(prefixB);
    const rawIdsB = new Set(em.provDoc["@graph"].map((n) => n["@id"]));
    // B の行（先頭の出現）。Variable の対応に使う
    const occList = occurrences.get(noteIdB) ?? [];
    const occB = occList[0];
    // 線の名前は B の行が 1 つに決まるときだけ引く（複数の行に現れるなら行を選べない）
    const labelOcc = occList.length === 1 ? occList[0] : undefined;

    for (const link of refs) {
      if (link.type !== "informed_by") continue;

      // 線の名前（実績）: A行.name と B行.name から B.inputLabels[normalize(A.name)]
      let lineName: string | undefined;
      let rowA: OperationRow | undefined;
      /** rowA が B と同じ計画にいるか（別の計画の行なら Variable には結ばない） */
      let rowAInOwnPlan = false;
      if (labelOcc) {
        // B の計画 → 親計画の連鎖の順に A の行を探す（A が trashed でも名前は引ける）
        let v: PlanVisit | undefined = labelOcc.visit;
        while (v && !rowA) {
          rowA = v.rows.find((r) => r.noteId === link.targetNoteId);
          if (rowA) rowAInOwnPlan = v === labelOcc.visit;
          const parentId: string | undefined = v.parentPlanId;
          v = parentId ? visits.find((x) => x.planId === parentId) : undefined;
        }
        if (rowA) {
          lineName = labelOcc.row.inputLabels?.[normalizeOperationName(rowA.name)]?.trim() || undefined;
        } else if (labelOcc.row.inputLabels && Object.keys(labelOcc.row.inputLabels).length > 0) {
          warn(labelOcc.visit.planId, "edge-label-dropped", { step: labelOcc.stepIri });
        }
      }

      // 受け側
      const activityId =
        link.activityId && rawIdsB.has(link.activityId)
          ? link.activityId
          : rawIdsB.has(`activity_${link.sourceBlockId}`)
            ? `activity_${link.sourceBlockId}`
            : undefined;
      const localEntityId = link.localEntityId && rawIdsB.has(link.localEntityId) ? link.localEntityId : undefined;

      // 供給側（A）: 出力ノードを 3 段で探す。targetEntityStable === false は解決しない
      const emA = emitted.get(link.targetNoteId);
      const outputId =
        emA && link.targetEntityStable !== false ? findOutputNode(emA.provDoc, link.targetEntityId) : undefined;
      const entityIriA = outputId ? `${noteIriOf(link.targetNoteId)}/${outputId}` : undefined;
      const nodeA = entityIriA ? emA!.byIri.get(entityIriA) : undefined;

      let emittedAny = false;
      const push = (rel: W3CProvNode): boolean => {
        if (seenRelations.has(rel["@id"])) return true;
        seenRelations.add(rel["@id"]);
        relationNodes.push(rel);
        return true;
      };

      if (nodeA && entityIriA) {
        // 見つかった: Usage（Activity があれば）と Derivation（ローカルノードがあれば）
        let usageLabeled = false;
        if (activityId) {
          const rel: W3CProvNode = {
            "@type": "Usage",
            "@id": `_:${relKey}_cross_note_usage_${enc(activityId)}_${enc(entityIriA)}`,
            activity: `${prefixB}${activityId}`,
            entity: entityIriA,
          };
          if (lineName) {
            rel.label = toW3CLabel(lineName);
            usageLabeled = true;
          }
          emittedAny = push(rel);
        }
        if (localEntityId) {
          const rel: W3CProvNode = {
            "@type": "Derivation",
            "@id": `_:${relKey}_cross_note_derivation_${enc(localEntityId)}_${enc(entityIriA)}`,
            generatedEntity: `${prefixB}${localEntityId}`,
            usedEntity: entityIriA,
            "graphium:linkType": "cross_note_output",
          };
          if (lineName && !usageLabeled) rel.label = toW3CLabel(lineName);
          emittedAny = push(rel);
        }
        if (emittedAny) {
          addType(nodeA, "p-plan:Entity");
          // 予定の Variable があり、A の予定の消費先が B だけなら対応を付ける（functional 制約）
          if (occB && rowA && rowAInOwnPlan) {
            const normA = normalizeOperationName(rowA.name);
            const normB = normalizeOperationName(occB.row.name);
            const varIri = occB.visit.vars.get(`${normA}\u0000${normB}`);
            const cons = occB.visit.consumers.get(normA);
            if (varIri && cons && cons.size === 1 && !nodeA["p-plan:correspondsToVariable"]) {
              nodeA["p-plan:correspondsToVariable"] = ref(varIri);
            }
          }
        }
      } else {
        // 見つからない: 外部スタブ + 関係（B 側 id は前置）
        const stubId = `graphium:note/${enc(link.targetNoteId)}/output/${enc(link.targetEntityId)}`;
        let rel: W3CProvNode | undefined;
        if (localEntityId) {
          rel = {
            "@type": "Derivation",
            "@id": `_:${relKey}_cross_note_derivation_${enc(localEntityId)}_${enc(stubId)}`,
            generatedEntity: `${prefixB}${localEntityId}`,
            usedEntity: stubId,
            "graphium:linkType": "cross_note_output",
          };
        } else if (activityId) {
          rel = {
            "@type": "Usage",
            "@id": `_:${relKey}_cross_note_usage_${enc(activityId)}_${enc(stubId)}`,
            activity: `${prefixB}${activityId}`,
            entity: stubId,
          };
        }
        if (rel) {
          if (lineName) rel.label = toW3CLabel(lineName);
          emittedAny = push(rel);
          if (!declaredStubs.has(stubId)) {
            const stub: W3CProvNode = {
              "@type": "Entity",
              "@id": stubId,
              label: toW3CLabel(link.targetEntityLabel ?? link.targetEntityId),
              "graphium:external": true,
              "graphium:sourceNoteId": link.targetNoteId,
              "graphium:sourceStepId": link.targetBlockId,
            };
            if (link.targetNoteTitle) stub["graphium:sourceNoteTitle"] = link.targetNoteTitle;
            if (link.targetStepTitle) stub["graphium:sourceStepTitle"] = link.targetStepTitle;
            declaredStubs.set(stubId, stub);
          }
        }
      }

      if (lineName && !emittedAny && occB) {
        warn(occB.visit.planId, "edge-label-dropped", { step: occB.stepIri, name: lineName });
      }
    }
  }

  // ── 組み立て ──
  const graph = dedupeIdentical([
    ...structureNodes,
    ...noteNodes,
    ...declaredStubs.values(),
    ...relationNodes,
    ...warningNodes,
    ...bundleNodes,
  ]);

  return {
    "@context": buildProvExportContext(),
    "@graph": dedupeStubs(graph),
  };
}
