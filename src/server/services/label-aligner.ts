// 手順抽出の結果の名寄せ（段 2: 同じ概念）。
//
// クライアントが表記ゆれ（段 1）で寄らなかった新しい名前と、書庫で使われている名前の一覧を
// 種類ごとに送ってくる。AI には「新しい名前が既存のどれかと同じモノ・同じ操作なら、その既存の
// 名前を選ぶ」ことだけをさせる。答えは一覧に実在する名前しか通さない（作文させない）。
//
// 呼び出し 1 回は名前の一覧だけなので小さい（論文本文は渡さない）。

import { jsonrepair } from "jsonrepair";

export type AlignKind = "step" | "material" | "tool" | "output" | "attributeKey";

export type AlignRequest = {
  /** 段 1 で寄らなかった新しい名前（種類ごと） */
  labels: Partial<Record<AlignKind, string[]>>;
  /** 書庫で使われている名前（種類ごと・頻出順） */
  candidates: Partial<Record<AlignKind, string[]>>;
};

export type AlignResult = Partial<Record<AlignKind, Record<string, string>>>;

const KINDS: AlignKind[] = ["step", "material", "tool", "output", "attributeKey"];

/** 種類ごとに AI へ渡す既存の名前の上限（prompt を書庫の規模と無関係に保つ） */
const CANDIDATE_LIMIT = 300;
/** 種類ごとの新しい名前の上限（1 本の論文でこれを超えることはまず無い） */
const LABEL_LIMIT = 120;

const KIND_TITLES: Record<AlignKind, string> = {
  step: "Step (operation) names",
  material: "Material names",
  tool: "Tool / instrument names",
  output: "Output (product) names",
  attributeKey: "Parameter keys",
};

export const LABEL_ALIGNER_SYSTEM_PROMPT = `You reconcile names in a lab-notebook knowledge graph.

A procedure was just extracted from a paper. Some of its names are NEW. The workspace already uses a list of EXISTING names. For each NEW name, decide whether it denotes exactly the same thing as one EXISTING name of the same kind. If so, map it to that existing name, copied verbatim. Otherwise leave it out.

What counts as the same:
- Steps: the same kind of operation, worded differently or in another tense/form ("calcining" = "Calcination", "ball-milling" = "Ball milling", "SPS" = "Spark plasma sintering"). Different operations are NOT the same even if related ("sintering" ≠ "calcination", "annealing" ≠ "sintering", "mixing" ≠ "ball milling").
- Materials / outputs: the same substance — a formula and its name ("BaCO3" = "barium carbonate"), an abbreviation ("Ar" = "argon"), or the same substance with a form word added ("Fe2O3 powder" = "Fe2O3"). A different composition, doping level, phase or sample is NOT the same ("BaFe12O19" ≠ "BaFe11.6Co0.2Ni0.2O19", "TiO2 anatase" ≠ "TiO2 rutile").
- Tools: the same kind of instrument ("tube furnace" = "Tube furnace", "XRD" = "X-ray diffractometer"). A more specific instrument is NOT the same as a generic one unless the paper clearly means the generic one ("planetary ball mill" ≠ "mortar").
- Parameter keys: the same quantity ("temp" = "temperature", "duration" = "time", "rotation speed" = "rpm").
- Never map across kinds. Never invent a name that is not in the EXISTING list. When unsure, leave it out — a missing merge is cheap, a wrong merge corrupts the graph.

Output ONLY a JSON object, no prose:
{"step": {"<new name>": "<existing name>"}, "material": {...}, "tool": {...}, "output": {...}, "attributeKey": {...}}
Omit kinds with no mappings. An empty object {} is a valid answer.`;

function hasCjk(s: string): boolean {
  return /[぀-ヿ一-鿿가-힯]/.test(s);
}

function clip(list: string[] | undefined, limit: number): string[] {
  return (list ?? []).filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, limit);
}

/** AI に投げるべき名前があるか（新しい名前と既存の名前が同じ種類に 1 つ以上ずつ） */
export function hasAlignWork(req: AlignRequest): boolean {
  return KINDS.some((k) => clip(req.labels[k], LABEL_LIMIT).length > 0 && clip(req.candidates[k], CANDIDATE_LIMIT).length > 0);
}

export function buildLabelAlignerUserMessage(req: AlignRequest): string {
  const sections: string[] = [];
  for (const kind of KINDS) {
    const labels = clip(req.labels[kind], LABEL_LIMIT);
    const candidates = clip(req.candidates[kind], CANDIDATE_LIMIT);
    if (labels.length === 0 || candidates.length === 0) continue;
    sections.push(
      `## ${KIND_TITLES[kind]} (key: "${kind}")\nNEW: ${JSON.stringify(labels)}\nEXISTING: ${JSON.stringify(candidates)}`,
    );
  }
  return sections.join("\n\n");
}

/**
 * AI の答えを検証して寄せ方の表にする。
 * - 元の名前は送った新しい名前に、寄せ先は送った既存の名前に、それぞれ実在するものだけ通す
 * - 自分自身への寄せは落とす
 */
export function parseLabelAlignerOutput(raw: string, req: AlignRequest): AlignResult {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0) return {};
  // 出力が途中で切れて閉じ括弧が無いときは、末尾まで渡して jsonrepair に閉じさせる
  const body = end > start ? text.slice(start, end + 1) : text.slice(start);
  let obj: unknown;
  try {
    obj = JSON.parse(jsonrepair(body));
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const out: AlignResult = {};
  for (const kind of KINDS) {
    const m = (obj as Record<string, unknown>)[kind];
    if (!m || typeof m !== "object") continue;
    const labels = new Set(clip(req.labels[kind], LABEL_LIMIT));
    const candidates = new Set(clip(req.candidates[kind], CANDIDATE_LIMIT));
    for (const [from, to] of Object.entries(m as Record<string, unknown>)) {
      if (typeof to !== "string") continue;
      if (!labels.has(from) || !candidates.has(to) || from === to) continue;
      // 手順名は見出しの言語に従う規則がある（日本語のノートは日本語の見出し）。
      // 言語をまたいで寄せると見出しの言語が崩れるので、文字種が違う寄せは通さない
      if (kind === "step" && hasCjk(from) !== hasCjk(to)) continue;
      (out[kind] ??= {})[from] = to;
    }
  }
  return out;
}
