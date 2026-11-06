// Material-science benchmark の「意味で照合する」採点。
//
// evaluator.ts は正規化した名前の完全一致で数える。名前の粒度（"planetary ball mill" と
// "Fritsch Pulverisette P-5"）や言い回し（"Calcining" と "calcination"）の違いでも外れになり、
// しかも正解（MatPROV）は合成の手順だけなので、抽出が測定・評価まで拾うと適合率が下がる。
// ここでは:
//   1. 予測と正解をノードの一覧（操作・実体・パラメータ）に起こす
//   2. 判定役の LLM に「予測の各ノードは正解のどれと同じか／範囲外（測定・評価）か」の対応表だけを作らせる
//   3. つながり（使用・生成）の正誤は、対応表で予測を正解の ID に置き換えてコードで数える
// 適合率は「素」と「範囲外を除いた」の 2 通りを出す。
//
// 予測のつながりはアプリの PROV と同じ規則で起こす（prov-generator）:
//   - 見出し配下の material / tool span → Usage、output span → Generation
//   - 次の手順の material が前の手順の output と同じ名前なら同じ実体（unification）
//   - derivedFrom だけで前の手順を指し、同名の output が無いときは、アプリは「〜の結果」という
//     仮の実体を作る。名前の無い実体は正解のどれとも対応しないので、ここでも数えない

import { jsonrepair } from "jsonrepair";
import type { ProvIngesterBlock, ProvIngesterOutput } from "../../../src/server/services/prov-ingester";

// ── 予測 ───────────────────────────────────────────────

export type PredActivity = { id: string; label: string; stepId?: string };
export type PredEntity = { id: string; label: string; role: "material" | "tool" | "output"; activity: string };
export type PredParam = { id: string; key: string; value: string; activity: string; entity?: string };
export type PredGraph = {
  activities: PredActivity[];
  entities: PredEntity[];
  params: PredParam[];
  /** [type, activityId, entityId] */
  edges: ["Usage" | "Generation", string, string][];
};

function splitAttr(text: string): { key: string; value: string } {
  const m = text.match(/^([^:：]{1,40})[:：]\s*(.+)$/s);
  return m ? { key: m[1].trim(), value: m[2].trim() } : { key: "", value: text.trim() };
}

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

export function predGraphFromOutput(output: ProvIngesterOutput): PredGraph {
  const g: PredGraph = { activities: [], entities: [], params: [], edges: [] };
  let current: PredActivity | null = null;
  let lastEntity: PredEntity | null = null;
  // 同じ手順・同じ名前・同じ役割の span は 1 実体
  const entityKey = new Map<string, PredEntity>();
  const walk = (blocks: ProvIngesterBlock[]) => {
    for (const b of blocks) {
      if (b.blockType === "heading" && b.role === "procedure" && b.text?.trim()) {
        current = { id: `a${g.activities.length + 1}`, label: b.text.trim(), ...(b.stepId ? { stepId: b.stepId } : {}) };
        g.activities.push(current);
        lastEntity = null;
      }
      for (const sp of b.content ?? []) {
        if (!sp.role || !sp.text?.trim() || !current) continue;
        if (sp.role === "material" || sp.role === "tool" || sp.role === "output") {
          const k = `${current.id}|${sp.role}|${norm(sp.text)}`;
          let e = entityKey.get(k);
          if (!e) {
            e = { id: `e${g.entities.length + 1}`, label: sp.text.trim(), role: sp.role, activity: current.id };
            entityKey.set(k, e);
            g.entities.push(e);
          }
          lastEntity = e;
        } else if (sp.role === "attribute") {
          const { key, value } = splitAttr(sp.text);
          g.params.push({
            id: `p${g.params.length + 1}`,
            key,
            value,
            activity: current.id,
            ...(sp.attachTo !== "activity" && lastEntity ? { entity: lastEntity.id } : {}),
          });
        }
      }
      if (b.children) walk(b.children);
    }
  };
  walk(output.blocks);

  // unification: 前の手順の output と同じ名前の material は、その output と同じ実体
  const outputsByName = new Map<string, PredEntity>();
  for (const e of g.entities) if (e.role === "output") outputsByName.set(norm(e.label), e);
  const canonical = new Map<string, string>();
  for (const e of g.entities) {
    if (e.role !== "material") continue;
    const o = outputsByName.get(norm(e.label));
    if (o && o.activity !== e.activity) canonical.set(e.id, o.id);
  }
  const seen = new Set<string>();
  for (const e of g.entities) {
    const id = canonical.get(e.id) ?? e.id;
    const type = e.role === "output" ? "Generation" : "Usage";
    const k = `${type}|${e.activity}|${id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    g.edges.push([type, e.activity, id]);
  }
  // 吸収された material は実体の一覧から外す（同じ実体を 2 回数えない）
  g.entities = g.entities.filter((e) => !canonical.has(e.id));
  for (const p of g.params) if (p.entity && canonical.has(p.entity)) p.entity = canonical.get(p.entity);
  return g;
}

// ── 正解 ───────────────────────────────────────────────

export type GoldNode = { id: string; kind: "activity" | "material" | "tool"; labels: string[] };
export type GoldParam = { id: string; node: string; key: string; values: string[] };
export type GoldGraph = { nodes: GoldNode[]; params: GoldParam[]; edges: ["Usage" | "Generation", string, string][] };

type MatProvValue = { "@value": string | string[] };
const values = (v: unknown): string[] => {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.flatMap((x: any) => (x && typeof x === "object" && "@value" in x ? ([] as string[]).concat((x as MatProvValue)["@value"]) : typeof x === "string" ? [x] : [])).map(String);
};

export function goldGraphFromMatProv(procedures: any[]): GoldGraph {
  const g: GoldGraph = { nodes: [], params: [], edges: [] };
  procedures.forEach((proc, pi) => {
    const pre = procedures.length > 1 ? `P${pi + 1}.` : "";
    for (const item of proc["@graph"] ?? []) {
      const t = item["@type"];
      if (t === "Activity" || t === "Entity") {
        const id = pre + item["@id"];
        const typ = values(item.type)[0];
        const kind = t === "Activity" ? "activity" : typ === "tool" ? "tool" : "material";
        g.nodes.push({ id, kind, labels: values(item.label) });
        for (const [k, v] of Object.entries(item)) {
          if (!k.startsWith("matprov:")) continue;
          g.params.push({ id: `${id}#${k.slice(8)}`, node: id, key: k.slice(8), values: values(v) });
        }
      } else if (t === "Usage" || t === "Generation") {
        g.edges.push([t, pre + item.activity, pre + item.entity]);
      }
    }
  });
  return g;
}

// ── 判定役への依頼 ──────────────────────────────────────

export const JUDGE_SYSTEM_PROMPT = `You compare a predicted lab-procedure graph with a reference (gold) graph extracted from the same materials-science paper, and you produce ONLY a mapping. You do not score.

The gold graph covers the SYNTHESIS procedure only. The prediction may also contain characterization / measurement steps (XRD, SEM, magnetometry, transport, analysis, calculation); those are out of the gold's scope.

For every predicted ACTIVITY give:
- "gold": the id of the gold activity it denotes (same kind of operation on the same thing in the same place of the procedure; wording, tense and granularity may differ — "Calcining" = "calcination", "SPS" = "spark plasma sintering"), or null.
  If one gold activity is split into several predicted ones (one per condition, or one operation spelled out as sub-steps), map each of them to that gold activity.
- "scope": "synthesis" if it is part of making the material, "characterization" if it measures / analyses / calculates, "other" otherwise.

For every predicted ENTITY (material / tool / output) give:
- "gold": the id of the gold entity it denotes (same substance, intermediate product or instrument; a formula equals its name; an instrument model equals the instrument kind it is; "ball-milled powder" equals "ball-milled sample"), or null. Respect conditions: a product made under a different condition is a different entity.
- "scope": "synthesis" or "characterization" (instruments or data used only for measurement are characterization).

For every predicted PARAMETER give:
- "gold": the id of a gold parameter on the corresponding node with the same quantity AND an equivalent value (units may differ only if the values are equal, e.g. 1 h = 60 min, 1173 K = 900 °C), or null.

Output ONLY a JSON object:
{"activities": {"a1": {"gold": "A3" | null, "scope": "synthesis"}, ...},
 "entities": {"e1": {"gold": "E2" | null, "scope": "synthesis"}, ...},
 "parameters": {"p1": "A3#temperature" | null, ...}}
Include every predicted id exactly once. Use only ids that appear in the lists.`;

export function buildJudgeUserMessage(pred: PredGraph, gold: GoldGraph): string {
  const goldNodes = gold.nodes.map((n) => `${n.id} [${n.kind}] ${n.labels.join(" | ")}`).join("\n");
  const goldParams = gold.params.map((p) => `${p.id} = ${p.values.join(" | ")}`).join("\n");
  const actLabel = new Map(pred.activities.map((a) => [a.id, a.label]));
  const predActs = pred.activities.map((a) => `${a.id} ${a.label}`).join("\n");
  const predEnts = pred.entities.map((e) => `${e.id} [${e.role}] ${e.label}  (in step ${e.activity} ${actLabel.get(e.activity)})`).join("\n");
  const entLabel = new Map(pred.entities.map((e) => [e.id, e.label]));
  const predParams = pred.params
    .map((p) => `${p.id} ${p.key ? `${p.key}: ` : ""}${p.value}  (step ${p.activity} ${actLabel.get(p.activity)}${p.entity ? `, on ${entLabel.get(p.entity) ?? p.entity}` : ""})`)
    .join("\n");
  return `## GOLD nodes\n${goldNodes}\n\n## GOLD parameters (node#key = values)\n${goldParams}\n\n## PREDICTED activities\n${predActs}\n\n## PREDICTED entities\n${predEnts}\n\n## PREDICTED parameters\n${predParams}`;
}

export type JudgeMapping = {
  activities: Record<string, { gold: string | null; scope: string }>;
  entities: Record<string, { gold: string | null; scope: string }>;
  parameters: Record<string, string | null>;
};

export function parseJudgeOutput(raw: string, pred: PredGraph, gold: GoldGraph): JudgeMapping {
  const t = raw.trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  let obj: any = {};
  try {
    obj = JSON.parse(jsonrepair(e > s ? t.slice(s, e + 1) : t.slice(Math.max(0, s))));
  } catch {
    obj = {};
  }
  const nodeIds = new Set(gold.nodes.map((n) => n.id));
  const paramIds = new Set(gold.params.map((p) => p.id));
  const out: JudgeMapping = { activities: {}, entities: {}, parameters: {} };
  for (const a of pred.activities) {
    const v = obj.activities?.[a.id];
    const g = v?.gold && nodeIds.has(v.gold) ? v.gold : null;
    out.activities[a.id] = { gold: g, scope: typeof v?.scope === "string" ? v.scope : "other" };
  }
  for (const en of pred.entities) {
    const v = obj.entities?.[en.id];
    const g = v?.gold && nodeIds.has(v.gold) ? v.gold : null;
    out.entities[en.id] = { gold: g, scope: typeof v?.scope === "string" ? v.scope : "synthesis" };
  }
  for (const p of pred.params) {
    const v = obj.parameters?.[p.id];
    out.parameters[p.id] = typeof v === "string" && paramIds.has(v) ? v : null;
  }
  return out;
}

// ── 数える ─────────────────────────────────────────────

export type PRF = { tp: number; pred: number; predInScope: number; gold: number; goldHit: number };
export type SemanticScore = {
  activities: PRF;
  materials: PRF;
  tools: PRF;
  edges: PRF;
  parameters: PRF;
};

const emptyPRF = (): PRF => ({ tp: 0, pred: 0, predInScope: 0, gold: 0, goldHit: 0 });

export function scoreWithMapping(pred: PredGraph, gold: GoldGraph, m: JudgeMapping): SemanticScore {
  const kindOf = new Map(gold.nodes.map((n) => [n.id, n.kind]));
  const s: SemanticScore = { activities: emptyPRF(), materials: emptyPRF(), tools: emptyPRF(), edges: emptyPRF(), parameters: emptyPRF() };

  // 操作
  const hitActs = new Set<string>();
  // 範囲内 = 範囲外（測定・評価）と判定されていない、または正解に対応した予測
  for (const a of pred.activities) {
    const v = m.activities[a.id];
    const matched = Boolean(v.gold && kindOf.get(v.gold) === "activity");
    s.activities.pred++;
    if (v.scope !== "characterization" || matched) s.activities.predInScope++;
    if (matched) {
      s.activities.tp++;
      hitActs.add(v.gold);
    }
  }
  s.activities.gold = gold.nodes.filter((n) => n.kind === "activity").length;
  s.activities.goldHit = hitActs.size;

  // 実体（material と output は正解の material、tool は tool）。予測と正解で material / tool の
  // 種類が食い違っても（イオンビームを装置とみるか材料とみるか）、同じ実体なら一致として数える。
  // 適合率は予測の種類の側、再現率は正解の種類の側に入れる
  const hit = { material: new Set<string>(), tool: new Set<string>() };
  for (const en of pred.entities) {
    const v = m.entities[en.id];
    const bucket = en.role === "tool" ? s.tools : s.materials;
    const gk = v.gold ? kindOf.get(v.gold) : undefined;
    const matched = gk === "material" || gk === "tool";
    bucket.pred++;
    if (v.scope !== "characterization" || matched) bucket.predInScope++;
    if (matched) {
      bucket.tp++;
      hit[gk as "material" | "tool"].add(v.gold!);
    }
  }
  s.materials.gold = gold.nodes.filter((n) => n.kind === "material").length;
  s.materials.goldHit = hit.material.size;
  s.tools.gold = gold.nodes.filter((n) => n.kind === "tool").length;
  s.tools.goldHit = hit.tool.size;

  // つながり: 予測の (type, act, ent) を正解の ID に置き換えて照合
  const goldEdges = new Set(gold.edges.map(([t, a, e]) => `${t}|${a}|${e}`));
  const hitEdges = new Set<string>();
  for (const [t, a, e] of pred.edges) {
    s.edges.pred++;
    const ga = m.activities[a]?.gold;
    const ge = m.entities[e]?.gold;
    const k = ga && ge ? `${t}|${ga}|${ge}` : "";
    const matched = Boolean(k && goldEdges.has(k));
    if (m.activities[a]?.scope !== "characterization" || matched) s.edges.predInScope++;
    if (matched) {
      s.edges.tp++;
      hitEdges.add(k);
    }
  }
  s.edges.gold = goldEdges.size;
  s.edges.goldHit = hitEdges.size;

  // パラメータ
  const hitParams = new Set<string>();
  for (const p of pred.params) {
    s.parameters.pred++;
    const g = m.parameters[p.id];
    if (m.activities[p.activity]?.scope !== "characterization" || g) s.parameters.predInScope++;
    if (g) {
      s.parameters.tp++;
      hitParams.add(g);
    }
  }
  s.parameters.gold = gold.params.length;
  s.parameters.goldHit = hitParams.size;
  return s;
}

export function addScores(a: SemanticScore, b: SemanticScore): SemanticScore {
  const add = (x: PRF, y: PRF): PRF => ({
    tp: x.tp + y.tp,
    pred: x.pred + y.pred,
    predInScope: x.predInScope + y.predInScope,
    gold: x.gold + y.gold,
    goldHit: x.goldHit + y.goldHit,
  });
  return {
    activities: add(a.activities, b.activities),
    materials: add(a.materials, b.materials),
    tools: add(a.tools, b.tools),
    edges: add(a.edges, b.edges),
    parameters: add(a.parameters, b.parameters),
  };
}

export const emptyScore = (): SemanticScore => ({
  activities: emptyPRF(),
  materials: emptyPRF(),
  tools: emptyPRF(),
  edges: emptyPRF(),
  parameters: emptyPRF(),
});

/** P（素）・P（範囲内）・R・F1（範囲内の P と R） */
export function summarize(x: PRF): { p: number; pIn: number; r: number; f1: number; f1In: number } {
  const p = x.pred ? x.tp / x.pred : 0;
  // 正解に対応した予測は必ず範囲内に数えているので tp <= predInScope
  const pIn = x.predInScope ? x.tp / x.predInScope : 0;
  const r = x.gold ? x.goldHit / x.gold : 0;
  const f = (a: number, b: number) => (a + b ? (2 * a * b) / (a + b) : 0);
  return { p, pIn, r, f1: f(p, r), f1In: f(pIn, r) };
}
