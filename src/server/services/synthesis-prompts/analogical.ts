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

### Domain-gap detector (REQUIRED — apply this before falling back to abductive)

The most common Synthesizer failure on cross-domain inputs is to default to \`abductive\` because *some* atom looks observational. Don't. Run this 3-step check first:

1. **Tag each input Atom with its substrate.** Use the most concrete category that fits — biology, ecology, chemistry, physics, software / systems, machine learning, hardware, social / organizational, economics, linguistics, materials, etc. The Atom's body and its source-Claim titles usually carry the substrate verbatim.

2. **Count distinct substrates among the inputs.** If 2+ substrates are present AND at least one pair of inputs shares a structural pattern phrased the same way (e.g., "learns normal from anomaly", "greedy local-optimum trap", "threshold-driven self-sustaining growth", "selection through experience rather than hardcoding"), this is a cross-domain analogue. **Prefer \`analogical\` over \`abductive\`** even if one input happens to be observational — the cross-domain signal is more load-bearing than the observational tag.

3. **If only one substrate is present**, drop \`analogical\` and let \`abductive\` / \`deductive\` win. "Two atoms from the same lab finding the same pattern" is induction at the Atom layer, not analogy.

### Substrate cues that almost always signal cross-domain (when paired)

When you see these substrates paired in the same Synthesizer batch, the analogical reading is usually right:

- Immune system  ⇄  intrusion detection / security
- Natural selection / evolution  ⇄  optimization / SGD / ML training
- Neural plasticity  ⇄  caching / memoization
- Predator-prey dynamics  ⇄  market competition
- Cellular feedback loops  ⇄  control theory / thermostats
- Epidemic spread  ⇄  information diffusion / virality
- Foraging behavior  ⇄  search algorithms
- Speciation  ⇄  software forking / dialect formation
- Hormesis / graded dose response  ⇄  graded fault injection
- Apoptosis / programmed cell death  ⇄  circuit breakers / graceful degradation

This list is illustrative, not exhaustive. The principle is: **biology / chemistry / physics paired with software / ML / social / economics is almost always analogical**, because the substrates are non-overlapping.

### Selection rules

- Pick \`analogical\` only when the domain gap is real. Inputs from the same lab / paper / substrate are almost always **not** analogical — prefer \`deductive\` or \`abductive\`.
- Name the structural mapping explicitly in the rationale: "X (domain A) corresponds to Y (domain B) because both play role Z." Then state the **transfer hypothesis** ("therefore, intervention I in domain B should produce effect E by the analogous mechanism").
- Lower \`confidence\` if the mapping has obvious breakdowns; analogical mode is prone to overreach.

### Worked example

- Input Atoms:
  - "Selection through experience rather than hardcoded rules makes a system robust to novel inputs" — sourced from immune-system Claims (biology substrate)
  - "Anomaly detection trained on normal behavior catches unseen attack patterns" — sourced from HIDS Claims (software / security substrate)
- Distinct substrates: 2 (biology ⇄ software). Shared pattern: "robustness via experience-driven selection rather than enumerated rules."
- Mode: \`analogical\`. Mapping: thymic negative selection ⇄ profile learning; novel antigens ⇄ zero-day attacks. Transfer hypothesis: "Software intrusion detection systems that allow continued exposure to novel benign traffic during training will develop tolerance the same way the immune system does."`;
