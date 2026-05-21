// abductive モード: 観測 Atom + 既知則 Atom → 説明仮説
//
// Synthesizer の本領。observational Atom と causal/mechanistic Atom を
// 組み合わせて「観測結果を最もよく説明する仮説」を立ち上げる。
// hypothesisStatus はデフォルト "speculative"。

export const ABDUCTIVE_MODE_NAME = "abductive" as const;

export const ABDUCTIVE_DESCRIPTION = `### Mode: \`abductive\` — best explanatory hypothesis

Use \`abductive\` when an observation Claim (something measured / seen) pairs with a mechanism or known-rule Claim, and the Synthesis is **the best explanatory hypothesis** for the observation.

- Shape: "We observed O. Given mechanism M, the most economical explanation is H."
- This is where most genuine "aha" Syntheses live. Treat it as the **default candidate** whenever the inputs contain at least one observational Atom and at least one causal / mechanistic Atom **AND** the inputs do not span clearly different substrates (see \`analogical\` for the cross-domain check).
- Default \`hypothesisStatus\`: \`"speculative"\`. Never bump to \`"confirmed"\` from a single round of synthesis.

Selection rules:
- Pick \`abductive\` if the new insight is a **hypothesis that explains an observation**, not a strategy or a contradiction resolution.
- **Before defaulting to \`abductive\` on inputs that contain mechanism Atoms, run the analogical mode's domain-gap detector.** If the inputs span 2+ substrates AND share a structural pattern, \`analogical\` is the right pick and \`abductive\` should be set aside. The default-candidate status of \`abductive\` is conditional on same-substrate inputs, not unconditional.
- **Run the dialectic-signal detector too (Phase γ-follow-up 3).** \`dialectic\` has structural priority over \`abductive\` when both fit, because contradictions get *resolved* by a higher frame, not *explained* by a hypothesis. Set \`abductive\` aside and pick \`dialectic\` when **any** of these signals is present:
  - **(a)** Two or more input Atoms / Claims carry \`rebuttalConditions\`, and those rebuttals point at the same axis (scale, team size, time horizon, problem class) at opposite ends — that axis is a regime separator, not a hidden mechanism. Read both \`rebuttalConditions\` arrays before answering.
  - **(b)** Two causal / conditional Atoms argue **opposite directions** on the same X→Y relation (one says X speeds Y up, the other says X slows Y down; one prefers strategy S, the other prefers ¬S). Run dialectic's 3-step detection in that case.
  - **(c)** The pair of inputs reads as "A and B disagree about what works" rather than "we observed O and need a mechanism." If the natural reading is *disagreement*, abductive will misframe the synthesis.
  When any of (a)/(b)/(c) hold, name the contradiction first and the resolving frame second — that is what \`dialectic\` is for. Abductive's job is the *one-observation-plus-known-mechanism* shape, not arbitration between competing strategies.
- Name the **observation Claim(s)** and the **mechanism / rule Claim(s)** separately in the rationale so the inference structure is visible.
- Note rival explanations briefly when they are plausible, and explain why the chosen hypothesis is the most economical given the inputs.
- Lower \`confidence\` when the observation could equally be explained by several mechanisms — abduction inflates confidence easily and the synthesizer must compensate.`;
