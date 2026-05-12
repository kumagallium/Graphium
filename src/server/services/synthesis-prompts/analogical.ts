// analogical モード: 異領域 Atom 間の構造写像 → 転用仮説
//
// 異なる領域の mechanistic Atom 同士から、構造を保存したまま転用する
// 仮説を立てる。例: 細胞のフィードバック制御を社会システムの制御に転用。
// content 判断（領域差）が必要なので router 単独では決められない。

export const ANALOGICAL_MODE_NAME = "analogical" as const;

export const ANALOGICAL_DESCRIPTION = `### Mode: \`analogical\` — structural mapping across domains

Use \`analogical\` when the Synthesis maps a structural pattern from one domain onto another, where the inputs come from **genuinely different domains** (different substrates, different fields, different scales).

- Shape: "X in domain A plays the role of Y in domain B. The pattern carries over because of structural correspondence S."
- The structural correspondence must be specific (a role mapping, not "they're both systems").
- Output a transfer hypothesis, not just "these look similar."

Selection rules:
- Pick \`analogical\` only when the domain gap is real. Inputs from the same lab / paper / substrate are almost always **not** analogical — prefer \`deductive\` or \`abductive\`.
- Name the structural mapping explicitly in the rationale: "X (domain A) corresponds to Y (domain B) because both play role Z."
- Lower \`confidence\` if the mapping has obvious breakdowns; analogical mode is prone to overreach.
- If the inputs share procedureContext, that is a hint they are *not* cross-domain — re-examine before choosing this mode.`;
