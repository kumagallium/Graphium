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

### 3-step contradiction detection (Phase γ-follow-up 3)

Before picking another mode, **run this procedure explicitly** when two inputs look like they might disagree. The goal is to separate a real dialectic from a coincidence of vocabulary.

1. **Direction of Claim A.** Read Atom A and write one sentence: "Under condition C_A, X pushes Y in direction D_A." If you cannot fill in D_A (positive / negative / increases / decreases / prefers / avoids), Atom A is not making a directional claim — fall back to another mode.
2. **Direction of Claim B.** Do the same for Atom B: "Under condition C_B, X pushes Y in direction D_B." If both A and B share the same X and Y but D_A and D_B point opposite ways (one says "speeds up", the other "slows down"; one says "improves clarity", the other "blocks learning"), you have a candidate dialectic.
3. **Regime separator.** Ask: *what differs between C_A and C_B?* — team size, scale, time horizon, maturity, problem class, etc. If the rebuttalConditions of A and B name the **same axis** but at opposite ends, that axis IS the regime separator and \`dialectic\` is the right pick. If the axes are unrelated, do **not** force a dialectic — the two Claims are about different situations and \`deductive\` or \`abductive\` may apply instead.

If steps 1–3 all succeed, write the Synthesis as: *"A holds in regime R_A; B holds in regime R_B; the higher frame is R, parameterized by the shared axis."* Cite each Atom's rebuttalConditions (when present) as evidence of where its validity ends.

If only step 1 or step 2 succeeds, this is **not** a dialectic — drop the candidate and let another mode handle the pair.

### Using Toulmin Rebuttals as regime separators (Phase γ)

When the input Atoms carry \`rebuttalConditions\` (Toulmin Rebuttal — conditions under which the underlying Claims break down), these are **first-class candidates for the regime separator**. If two Atoms each carry rebuttals that point at the *same axis* (e.g., temperature, scale, time horizon) but at opposite ends of it, that is a structural signal of a real dialectic — the rebuttal of one is the operating regime of the other.

Procedure when both Atoms have rebuttalConditions:
1. Read each Atom's rebuttalConditions before writing the Synthesis. Look for a shared dimension (a parameter, scale, condition family) on which the two rebuttals lie.
2. If found, name that dimension as the regime separator. Cite each rebuttal as evidence of where each Atom's validity ends.
3. If the two rebuttals are about unrelated axes, do **not** force a dialectic — fall back to another mode.

When only one (or neither) Atom carries rebuttalConditions, the regime separator must come from the body of the Claims themselves, the same as before.`;
