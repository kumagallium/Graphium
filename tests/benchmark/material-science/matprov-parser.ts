// MatPROV 形式（JSON 配列）出力のパーサ。
//
// LLM が返す MatPROV 形式 raw text を parseMatProvOutput で MatProvOutput に変換する。
// ```json ... ``` の fence は剥がす。トップが単一オブジェクト（[] でない）の場合も
// 1 要素配列として扱う。不正な item は捨てる。

import type {
  MatProvEdge,
  MatProvEntity,
  MatProvActivity,
  MatProvGraphItem,
  MatProvOutput,
  MatProvProcedure,
} from "./matprov-types";

const ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * MatPROV 形式 raw 文字列をパースして MatProvOutput を返す。
 * 失敗時は空配列を返す（呼び出し側がエラー応答に変える）。
 */
export function parseMatProvOutput(raw: string): MatProvOutput {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) text = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("MatPROV 出力のパース失敗:", err);
    return [];
  }

  const procedures = Array.isArray(parsed) ? parsed : [parsed];
  const out: MatProvOutput = [];
  for (const p of procedures) {
    if (!p || typeof p !== "object") continue;
    const obj = p as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    const graphRaw = obj["@graph"];
    if (!Array.isArray(graphRaw)) continue;
    const graph: MatProvGraphItem[] = [];
    for (const item of graphRaw) {
      const sanitized = sanitizeGraphItem(item);
      if (sanitized) graph.push(sanitized);
    }
    if (graph.length === 0) continue;
    const proc: MatProvProcedure = { label, "@graph": graph };
    out.push(proc);
  }
  return out;
}

function sanitizeGraphItem(item: unknown): MatProvGraphItem | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;
  const t = obj["@type"];
  if (t === "Entity") return sanitizeEntity(obj);
  if (t === "Activity") return sanitizeActivity(obj);
  if (t === "Usage" || t === "Generation") return sanitizeEdge(obj, t);
  return null;
}

function sanitizeEntity(obj: Record<string, unknown>): MatProvEntity | null {
  const id = readId(obj["@id"]);
  if (!id) return null;
  const entity: MatProvEntity = { "@type": "Entity", "@id": id };
  // label / type / matprov:*
  const labelOk = passthrough(obj, entity, ["label", "type"]);
  if (!labelOk) {
    // label がない Entity は graph 上で参照されることはあっても表示できない。
    // 落とさず id だけ残す（edge 解決で再利用される可能性があるため）。
  }
  for (const k of Object.keys(obj)) {
    if (k.startsWith("matprov:")) {
      const v = obj[k];
      if (Array.isArray(v)) (entity as Record<string, unknown>)[k] = v;
    }
  }
  return entity;
}

function sanitizeActivity(obj: Record<string, unknown>): MatProvActivity | null {
  const id = readId(obj["@id"]);
  if (!id) return null;
  const activity: MatProvActivity = { "@type": "Activity", "@id": id };
  passthrough(obj, activity, ["label"]);
  for (const k of Object.keys(obj)) {
    if (k.startsWith("matprov:")) {
      const v = obj[k];
      if (Array.isArray(v)) (activity as Record<string, unknown>)[k] = v;
    }
  }
  return activity;
}

function sanitizeEdge(
  obj: Record<string, unknown>,
  type: "Usage" | "Generation",
): MatProvEdge | null {
  const activity = readId(obj.activity);
  const entity = readId(obj.entity);
  if (!activity || !entity) return null;
  return { "@type": type, activity, entity };
}

function passthrough(
  src: Record<string, unknown>,
  dst: Record<string, unknown>,
  keys: string[],
): boolean {
  let any = false;
  for (const k of keys) {
    if (k in src && src[k] !== undefined && src[k] !== null) {
      dst[k] = src[k];
      any = true;
    }
  }
  return any;
}

function readId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return ID_REGEX.test(trimmed) ? trimmed : null;
}
