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
- Name the **observation Claim(s)** and the **mechanism / rule Claim(s)** separately in the rationale so the inference structure is visible.
- Note rival explanations briefly when they are plausible, and explain why the chosen hypothesis is the most economical given the inputs.
- Lower \`confidence\` when the observation could equally be explained by several mechanisms — abduction inflates confidence easily and the synthesizer must compensate.`;
