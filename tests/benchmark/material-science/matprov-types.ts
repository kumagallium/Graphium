// MatPROV 形式（PROV-DM JSON-LD 風）の型定義
//
// 形式は MatPROV 論文（NeurIPS 2025 AI4Mat workshop, kumagai 著）の
// synthesis_procedure_extraction.txt と Hugging Face dataset
// `MatPROV-project/MatPROV` のスキーマに準拠する。

/** @value は通常 string、シノニム配列のときは string[] */
export type MatProvValueEntry = { "@value": string | string[]; "@language"?: string; "@type"?: string };

export type MatProvLabel = MatProvValueEntry[];

export type MatProvEntity = {
  "@type": "Entity";
  "@id": string;
  label?: MatProvLabel;
  /** [{ @value: "material" | "tool" }] */
  type?: MatProvValueEntry[];
  /** matprov:purity / matprov:form / matprov:length_thickness など */
  [paramKey: string]: unknown;
};

export type MatProvActivity = {
  "@type": "Activity";
  "@id": string;
  label?: MatProvLabel;
  [paramKey: string]: unknown;
};

export type MatProvUsage = {
  "@type": "Usage";
  activity: string;
  entity: string;
};

export type MatProvGeneration = {
  "@type": "Generation";
  activity: string;
  entity: string;
};

export type MatProvNode = MatProvEntity | MatProvActivity;
export type MatProvEdge = MatProvUsage | MatProvGeneration;
export type MatProvGraphItem = MatProvNode | MatProvEdge;

export type MatProvProcedure = {
  label: string;
  "@graph": MatProvGraphItem[];
};

export type MatProvOutput = MatProvProcedure[];

/** @value の表示用 1 文字列を取り出す（配列ならシノニムの先頭） */
export function readValue(entry: MatProvValueEntry | undefined): string {
  if (!entry) return "";
  const v = entry["@value"];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return "";
}

/** label[0]?.@value を取り出すユーティリティ */
export function readLabel(label: MatProvLabel | undefined): string {
  return readValue(label?.[0]);
}

/** Entity の "material" | "tool" 種別を取り出す */
export function readEntityType(entity: MatProvEntity): "material" | "tool" | null {
  const t = readValue(entity.type?.[0]);
  if (t === "material" || t === "tool") return t;
  return null;
}

/** matprov:foo フィールドの一覧（key と @value）を返す */
export function readParameters(node: MatProvNode): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const k of Object.keys(node)) {
    if (!k.startsWith("matprov:")) continue;
    const arr = (node as Record<string, unknown>)[k];
    if (!Array.isArray(arr)) continue;
    const v = readValue(arr[0] as MatProvValueEntry | undefined);
    if (v) out.push({ key: k.slice("matprov:".length), value: v });
  }
  return out;
}
