# Inference types in Graphium

Graphium's Knowledge layer tags every extracted note with a small set of metadata fields that capture **what kind of reasoning produced this claim**. This document organizes those fields and explains the layer each one lives at. Read it as learning material, or open it whenever a badge in the UI is unfamiliar.

The design root is the hourglass model: `Notes → Claim → Atom → Synthesis` (UI labels: *Claims → Insights → Ideas*; on-disk identifiers stay as `claim` / `atom` / `synthesis` to preserve existing data). Each layer carries a different concentration of context, and the inference types are attached at the layer they actually belong to.

---

## Overview

| Layer | Operation | Inference type field |
|---|---|---|
| Notes → Claim | extraction | `claimRole` (finding / decision / anomaly / question / setup / interpretation / issue) |
| Claim → Atom | **abstraction (includes induction)** | `atomType` (causal / mechanistic / conditional / …) |
| Atom → Synthesis | **integration of heterogeneous elements** | `synthesisMode` (deductive / abductive / analogical / dialectic) |

Note: **induction is not a Synthesis mode in this system.** It lives at the Claim → Atom transition. See "Why induction is not a Synthesis mode" below.

---

## The four Synthesis modes

The Synthesizer takes Atoms (or Claims) and produces **a new connection across heterogeneous elements**. Lifting a general rule out of many similar cases (= induction) is the Atomizer's job, not the Synthesizer's.

### `deductive`

- Shape: independent Claims/Atoms → a strategy or combination that follows logically from them.
- Example: "A demonstrates X", "B demonstrates Y", "C demonstrates Z" → "Combining A, B, and C yields a new approach W."
- Lineage: classical deduction. If the premises hold, the conclusion holds.
- Failure mode: any premise being wrong collapses the conclusion. When tagging a Synthesis as `deductive`, scrutinize premise confidence.

### `abductive`

- Shape: an observation Claim/Atom (something measured) + a mechanism/known-rule Claim/Atom → the best explanatory hypothesis for the observation.
- Example: "An anomalous sign reversal was observed in Al5Co2" + "Two-band conduction can produce this kind of phenomenon" → "Al5Co2's near-Fermi DOS may have a two-band structure" (hypothesis).
- Lineage: C. S. Peirce. "Inference to the best explanation." **Most "aha"-style Syntheses are abductive.**
- Failure mode: many explanations could fit any observation. Confidence is intrinsically `speculative` until verified separately.

### `analogical`

- Shape: discover a **structural mapping** between Claims/Atoms in different domains, then transfer one pattern to the other.
- Example: "Background storage maintenance gradually restores fragmentation in reference structures" (software) ↔ "Biological tissue turnover gradually clears waste products" (biology) → a transfer hypothesis across both.
- Lineage: Aristotle on analogy; Gentner's structure-mapping theory.
- Failure mode: surface similarity easily induces wrong mappings. State explicitly in the rationale which element corresponds to which.

### `dialectic`

- Shape: two Claims/Atoms making **opposite claims** about the same effect → a higher frame that contains both.
- Example: "Raising pH slows reduction" + "Raising pH speeds reduction" → "Rate-limiting step switches from hydroxide desorption to electron transfer around pH 11."
- Lineage: Hegelian dialectic. Thesis–antithesis–synthesis.
- Failure mode: requires a real contradiction, not just an emphasis difference. Do not over-apply.

---

## Why induction is not a Synthesis mode

The early design (first version of proposal v4) placed an `inductive` mode on Synthesis: "Three or more Claims show the same pattern, lift it into a general rule."

But reading the Atomizer's own definition carefully:

> Atom: a thin substrate that factors out a single, context-stripped idea recurring across multiple Claims.

That **is** induction. The Atomizer is already a discovery layer that takes N similar Claims and produces M abstractions across them. So Synthesis-inductive and the Atomizer were doing the same job under different names.

PR-B4 cleans this up:

- Synthesis is restricted to four modes (deductive / abductive / analogical / dialectic) — the modes that genuinely integrate **heterogeneous** elements.
- Induction is reframed as the core operation of the Atom layer.
- The Atomizer prompt explicitly names **two routes to an Atom**: induction-from-many (the cases earn the rule by repetition) and lift-from-few (a couple of Claims that are already near-principles, lifted by domain abstraction).
- The UI surfaces "derived from N Claims" on each Atom, so induction is visible as evidence.

Design implication:

- **Claim layer**: individual facts with context.
- **Atom layer (the hourglass waist)**: where context is stripped *and* repeated cases are generalized. Induction lives here.
- **Synthesis layer**: where heterogeneous Atoms are woven into new connections.

Induction and the four Synthesis modes (deduction / abduction / analogy / dialectic) are no longer peers on the same axis — they live at different layers and do different work.

---

## Reading the metadata

The badges on each Wiki note's banner correspond directly to the vocabulary on this page.

- **Claim** badge: value of `claimRole` (Finding / Decision / …)
- **Atom** badge: value of `atomType` (Causal / Mechanistic / …)
- **Synthesis** badge: value of `synthesisMode` (Deductive / Abductive / Analogical / Dialectic)

A note without a badge is one the LLM could not infer a type for or judged inapplicable. There is no manual-tagging UI yet (we may add one if a real need surfaces).

---

## See also

- Hourglass model: [`docs/CONCEPT.md`](./CONCEPT.md)
- Data model: [`docs/DATA_MODEL.md`](./DATA_MODEL.md) §3.5 "Semantic types (Phase 1)"
