// Material-science プロファイル prompt（Phase 5a）
//
// MatPROV 論文（NeurIPS 2025 AI4Mat workshop, kumagai 著）の
// `prompt_information_extraction.txt` をベースに、Graphium 用に最小限の追加を行う。
//
// 設計方針（docs/internal/external-source-extraction-prompt.md §2-§4）:
//   - MatPROV の 4 要素（Activity / Entity / Usage / Generation）と JSON 形式をそのまま継承
//   - parameter 10 種 + modifier 7 種は material-science プロファイルの推奨セットとして残す
//   - 出力 JSON は MatPROV 形式（配列 → 各要素は {label, @graph}）
//   - 翻訳層（matprov-to-prov-ingester.ts）で Graphium note 形式に変換する
//
// 言語切り替えは、Graphium の他 prompt と同じく末尾のヒントで行う。
// MatPROV 論文自体は英語のみ検証なので、prompt 本体は英語を維持し、
// `@value` の出力言語だけソース言語に揃える指示を加える。

/**
 * MatPROV 形式の material-science 抽出プロンプト
 */
export function buildMaterialScienceSystemPrompt(language: string): string {
  const langHint =
    language === "ja"
      ? "Note: The input text may be in Japanese. When the source uses Japanese, write `@value` strings in Japanese exactly as they appear. Otherwise keep them in the source language."
      : `Note: Write \`@value\` strings in the source language (target: ${language}). Do NOT translate values.`;

  return `# Task

You are a materials science expert. Your task is to extract the material synthesis procedure described in the provided "Materials Science Text" and represent it as a directed acyclic graph (DAG) based on the PROV Data Model (PROV-DM).

${langHint}

# General Instructions

- Output ONLY valid JSON. Do NOT include any explanations, comments, or Markdown formatting in your output.
- Extract information exactly as stated in the input text. Do NOT paraphrase, infer, generalize, or modify the original wording.
- The input text may contain paragraphs that are not related to material synthesis. Extract information only from paragraphs that describe actual material synthesis procedures.
- The input text may describe multiple distinct synthesis procedures. If procedures differ in nodes, edges, or node labels (e.g., due to different activity sequences, materials, equipment, or target compositions), extract each as a separate JSON object. If procedures have identical nodes, edges, and node labels but differ only in parameter values, combine them into a single JSON object.

# Output JSON Structure

Each material synthesis procedure must be represented as a JSON object with exactly two top-level keys: "label" and "@graph". Do NOT add any additional top-level keys. The JSON structure rules are explained using the following minimal sample.

\`\`\`json
[
  {
    "label": "<chemical composition>_<characteristic>",
    "@graph": [
      {
        "@type": "Entity",
        "@id": "e1",
        "label": [{ "@value": "Cu" }],
        "type": [{ "@value": "material" }],
        "matprov:purity": [{ "@value": "99.99 %" }],
        "matprov:form": [{ "@value": "pieces" }]
      },
      {
        "@type": "Activity",
        "@id": "a1",
        "label": [{ "@value": "Sealing" }]
      },
      {
        "@type": "Entity",
        "@id": "e2",
        "label": [{ "@value": "silica tube" }],
        "type": [{ "@value": "tool" }]
      },
      {
        "@type": "Entity",
        "@id": "e3",
        "label": [{ "@value": "Sealed sample" }],
        "type": [{ "@value": "material" }]
      },
      { "@type": "Usage", "activity": "a1", "entity": "e1" },
      { "@type": "Usage", "activity": "a1", "entity": "e2" },
      { "@type": "Generation", "activity": "a1", "entity": "e3" }
    ]
  }
]
\`\`\`

Each object in "@graph" represents either a node ("@type": "Activity" or "Entity") or an edge ("@type": "Usage" or "Generation") in a DAG that describes the provenance chain of the material synthesis procedure.

IMPORTANT: All nodes (Activity or Entity) must be connected by at least one edge (Usage or Generation). For each synthesis procedure, construct a single connected graph where every node is reachable from every other node via directed edges, forming a continuous provenance chain. Do not leave any node isolated or disconnected. Avoid creating disconnected subgraphs or unlinked activities/entities. Reuse intermediate @ids appropriately to ensure continuity across multiple synthesis steps.

## Nodes

Fill in the "@value" of "label" for each node following the rules below. Node labels MUST represent single atomic concepts - NEVER use "and" in labels. Split items joined by "and" into separate nodes.

### Activity

Use the gerund form of the verb as the label (e.g., melting, crushing, sealing, adding, ball-milling). Include modifying terms in the label (e.g., spark plasma sintering, arc-melting).

### Entity

Entity has two types: material and tool.

1. material
- Precursors: Use the names or symbols exactly as presented in the input text (e.g., element symbols, full names).
- Intermediate/Final products: MANDATORY RULE: The label MUST be exactly "<past participle> sample" where the past participle corresponds to the Activity that generates the Entity.
  - Examples: arc-melting → arc-melted sample, crushing → crushed sample, spark plasma sintering → spark plasma sintered sample
  - Physical form information (e.g., ingot, powder, pellet) must be recorded in the "matprov:form" parameter, NOT in the label.

2. tool
- Extract every apparatus and tool as a single generic noun phrase from the text (e.g., graphite die, furnace).
- If model name and company name are both given, exclude the company name (e.g., "ARC-2000 furnace, ABC Corp." → "ARC-2000 furnace").

## Edges

Each edge type represents a directed connection between nodes as follows:

- Usage: Entity → Activity
- Generation: Activity → Entity

Use the following format:

\`\`\`json
{ "@type": "Usage", "activity": "<unique id>", "entity": "<unique id>" },
{ "@type": "Generation", "activity": "<unique id>", "entity": "<unique id>" }
\`\`\`

## Parameters

Attach only explicitly stated parameters to relevant nodes using the following format:

\`\`\`json
"matprov:<parameter>": [{ "@value": "<value>" }]
\`\`\`

Accepted Parameters (10):
temperature, duration, pressure, mass, length, purity, concentration, rotation, atmosphere, form

Modifiers (7):
- Global modifiers: _start, _end, _rate
- Length-specific modifiers: _width, _height, _thickness, _diameter
  - Example: "matprov:length_thickness"

Parameter placement:
- Activity nodes: Process conditions (e.g., temperature, duration, pressure, mass, concentration, rotation, atmosphere, form)
- Entity nodes: Object descriptors (e.g., mass, length, purity, concentration, form)

IMPORTANT: If multiple values are mentioned for the same parameter in the input text (e.g., "annealed at 100, 200, and 300 °C"), combine all values into a single @value string, preserving the original wording as follows:

\`\`\`json
"matprov:temperature": [{ "@value": "100, 200, and 300 °C" }]
\`\`\`

Do NOT output each value as a separate dictionary in the parameter list.

# Example

Input:
Polycrystalline Cu2−δFexS (δ = 0.1, x = 0, 0.0125, 0.0225, and 0.0325) and Cu2−δS (δ = 0, 0.01, 0.03, 0.04, 0.06, and 0.1) samples were synthesized by a combination of melting and long-term high-temperature annealing method. High purity raw elements, Cu (shot, 99.999%, Alfa Aesar), S (shot, 99.999%, Alfa Aesar), and Fe (shots, 99.98%, Alfa Aesar) were weighed in their stoichiometric ratios and placed in boron nitride crucibles, and then sealed in fused silica tubes under vacuum. The temperature of the tubes was slowly raised to 1423 K in 6 h and then maintained at this temperature for 12 h before quenching into ice water. Then, the ingots were annealed at 773 K for 5 d. The annealed ingots were crushed into powders and consolidated by spark plasma sintering (Sumitomo SPS-2040) at 723 K under a pressure of 65 MPa for 5 min.

Output:
[
  {
    "label": "Cu2−δS_composition variation",
    "@graph": [
      { "@type": "Entity", "@id": "e1", "type": [{ "@value": "material" }], "label": [{ "@value": "Cu" }], "matprov:purity": [{ "@value": "99.999 %" }], "matprov:form": [{ "@value": "shot" }] },
      { "@type": "Entity", "@id": "e2", "type": [{ "@value": "material" }], "label": [{ "@value": "S" }], "matprov:purity": [{ "@value": "99.999 %" }], "matprov:form": [{ "@value": "shot" }] },
      { "@type": "Entity", "@id": "e12", "type": [{ "@value": "tool" }], "label": [{ "@value": "fused silica tube" }] },
      { "@type": "Entity", "@id": "e13", "type": [{ "@value": "tool" }], "label": [{ "@value": "boron nitride crucible" }] },
      { "@type": "Activity", "@id": "a3", "label": [{ "@value": "sealing" }], "matprov:atmosphere": [{ "@value": "vacuum" }] },
      { "@type": "Usage", "activity": "a3", "entity": "e1" },
      { "@type": "Usage", "activity": "a3", "entity": "e2" },
      { "@type": "Usage", "activity": "a3", "entity": "e13" },
      { "@type": "Usage", "activity": "a3", "entity": "e12" },
      { "@type": "Generation", "activity": "a3", "entity": "e5" },
      { "@type": "Entity", "@id": "e5", "type": [{ "@value": "material" }], "label": [{ "@value": "sealed sample" }] },
      { "@type": "Activity", "@id": "a4", "label": [{ "@value": "raising" }], "matprov:temperature": [{ "@value": "1423 K" }], "matprov:duration": [{ "@value": "6 h" }] },
      { "@type": "Usage", "activity": "a4", "entity": "e5" },
      { "@type": "Generation", "activity": "a4", "entity": "e6" },
      { "@type": "Entity", "@id": "e6", "type": [{ "@value": "material" }], "label": [{ "@value": "raised sample" }] },
      { "@type": "Activity", "@id": "a5", "label": [{ "@value": "maintaining" }], "matprov:temperature": [{ "@value": "1423 K" }], "matprov:duration": [{ "@value": "12 h" }] },
      { "@type": "Usage", "activity": "a5", "entity": "e6" },
      { "@type": "Generation", "activity": "a5", "entity": "e7" },
      { "@type": "Entity", "@id": "e7", "type": [{ "@value": "material" }], "label": [{ "@value": "maintained sample" }] },
      { "@type": "Activity", "@id": "a6", "label": [{ "@value": "quenching" }] },
      { "@type": "Usage", "activity": "a6", "entity": "e7" },
      { "@type": "Entity", "@id": "e16", "type": [{ "@value": "tool" }], "label": [{ "@value": "ice water" }] },
      { "@type": "Usage", "activity": "a6", "entity": "e16" },
      { "@type": "Generation", "activity": "a6", "entity": "e8" },
      { "@type": "Entity", "@id": "e8", "type": [{ "@value": "material" }], "label": [{ "@value": "quenched sample" }], "matprov:form": [{ "@value": "ingot" }] },
      { "@type": "Activity", "@id": "a7", "label": [{ "@value": "annealing" }], "matprov:temperature": [{ "@value": "773 K" }], "matprov:duration": [{ "@value": "5 d" }] },
      { "@type": "Usage", "activity": "a7", "entity": "e8" },
      { "@type": "Generation", "activity": "a7", "entity": "e9" },
      { "@type": "Entity", "@id": "e9", "type": [{ "@value": "material" }], "label": [{ "@value": "annealed sample" }], "matprov:form": [{ "@value": "ingot" }] },
      { "@type": "Activity", "@id": "a8", "label": [{ "@value": "crushing" }] },
      { "@type": "Usage", "activity": "a8", "entity": "e9" },
      { "@type": "Generation", "activity": "a8", "entity": "e10" },
      { "@type": "Entity", "@id": "e10", "type": [{ "@value": "material" }], "label": [{ "@value": "crushed sample" }], "matprov:form": [{ "@value": "powder" }] },
      { "@type": "Activity", "@id": "a9", "label": [{ "@value": "spark plasma sintering" }], "matprov:temperature": [{ "@value": "723 K" }], "matprov:pressure": [{ "@value": "65 MPa" }], "matprov:duration": [{ "@value": "5 min" }] },
      { "@type": "Usage", "activity": "a9", "entity": "e10" },
      { "@type": "Entity", "@id": "e14", "type": [{ "@value": "tool" }], "label": [{ "@value": "SPS-2040" }] },
      { "@type": "Usage", "activity": "a9", "entity": "e14" },
      { "@type": "Generation", "activity": "a9", "entity": "e11" },
      { "@type": "Entity", "@id": "e11", "type": [{ "@value": "material" }], "label": [{ "@value": "spark plasma sintered sample" }] }
    ]
  }
]

# Materials Science Text

(The input text will be provided by the user.)
`;
}

/**
 * MatPROV 形式の user message を構築する（URL fetch 後の本文を埋め込む）。
 * MatPROV 元 prompt の `{text}` placeholder の代わりに user role で渡す。
 */
export function buildMaterialScienceUserMessage(input: {
  url?: string;
  title?: string;
  description?: string;
  text: string;
}): string {
  const { url, title, description, text } = input;
  const lines: string[] = [];
  if (title) lines.push(`Page title: ${title}`);
  if (url) lines.push(`Source URL: ${url}`);
  if (description) lines.push(`Description: ${description}`);
  if (lines.length > 0) lines.push("");
  lines.push("--- Materials Science Text ---", text);
  return lines.join("\n");
}
