// deductive モード: 独立 Atom 群 → 組み合わせ戦略
//
// 「Given A and B and C, the natural move is D.」 という形の推論。
// 入力 Claim/Atom が論理的に独立しているとき、それらを並べて新しい戦略・
// 設計判断を導く。最も permissive な mode で、他 mode の条件を満たさない場合の
// フォールバック先でもある（synthesis-router の default）。

export const DEDUCTIVE_MODE_NAME = "deductive" as const;

export const DEDUCTIVE_DESCRIPTION = `### Mode: \`deductive\` — combination strategy

Use \`deductive\` when independent Claims combine into a strategy that follows logically from them.

- Shape: "Given A and B and C, the natural move is D."
- The inputs do not contradict and do not span a domain gap; they are pieces that fit together.
- The Synthesis explains *why the combination is the natural next step*, not just that A, B, C exist.
- Default \`hypothesisStatus\`: \`"speculative"\` unless the source Claims themselves show validation of the combined strategy.

Selection rules:
- Pick \`deductive\` if the candidate is a strategy / design choice derived from independent facts.
- Do **not** pick \`deductive\` if the inputs argue opposite directions (use \`dialectic\`), span a domain gap (use \`analogical\`), or pair an observation with a mechanism (use \`abductive\`).
- If the candidate is "A and B both say the same thing, so probably true" — that is **not** a Synthesis, it's a restatement. Drop it.
- Name the contribution of each input Claim in the rationale, so the reader can audit the deduction.`;
