// dialectic モード: 対立する Atom ペア → 上位枠組み
//
// 同じ効果に対して逆向きの主張をする causal Atom のペアを、両方を含む
// 上位フレームで止揚する。**本物の矛盾**が必要で、強調差や粒度差は対象外。
// 逆向き性は content 判断が要るため、router 単独では決められない。

export const DIALECTIC_MODE_NAME = "dialectic" as const;

export const DIALECTIC_DESCRIPTION = `### Mode: \`dialectic\` — opposite directions resolved by a higher frame

Use \`dialectic\` when two Claims argue **opposite directions** of the same effect, and the Synthesis resolves them by introducing a higher frame (condition, scale, regime) that contains both.

- Shape: "Claim A says X → Y. Claim B says X → ¬Y. Both hold once we recognize the regime R that separates them."
- **Requires a real contradiction**, not just emphasis differences or different granularity.
- The Synthesis must name the regime / condition / parameter that separates the two cases — without it, this is just contradiction noise.

Selection rules:
- Pick \`dialectic\` only when you can state the contradiction in one sentence and the resolving condition in another.
- Name the contradiction explicitly in the rationale **before** stating the resolution.
- If the contradiction can be resolved by simply checking units, definitions, or a quoted condition in one of the Claims, **drop the candidate** — that is a clarification, not a Synthesis.
- When inputs disagree on a procedureContext parameter (e.g., temperature value), this is often the seed of a dialectic synthesis; widen \`validityRange\` in \`procedureContext\` to span the disagreement.`;
