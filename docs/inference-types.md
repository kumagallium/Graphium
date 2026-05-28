# Inference types in Graphium

Graphium's Knowledge layer tags every extracted note with a small set of metadata fields that capture **what kind of reasoning produced this claim**. This document organizes those fields and explains the layer each one lives at. Read it as learning material, or open it whenever a badge in the UI is unfamiliar.

The design root is the hourglass model: **Notes → Claims → Insights → Ideas**. On-disk identifiers stay as `claim` / `atom` / `synthesis` so existing data keeps working, but everywhere a user sees a label, this doc and the UI agree on the new names. Each layer carries a different concentration of context, and the inference types are attached at the layer they actually belong to.

Ideas are authored through the Cmd-K Composer flow — the user selects the Insights they want to weave, builds a citation note, and invokes the LLM with that as the search-space constraint. `synthesisMode` (deductive / abductive / analogical / dialectic) labels the kind of move the Idea makes; the four modes are explained below.

---

## Overview

| Layer (UI) | Layer (internal) | Operation | Inference type field |
|---|---|---|---|
| Notes → Claims | `claim` | extraction | `claimRole` (finding / decision / anomaly / question / setup / interpretation / issue) |
| Claims → Insights | `atom` | **abstraction (includes induction)** | `atomType` (causal / mechanistic / conditional / …) |
| Insights → Ideas | `synthesis` | **integration of heterogeneous elements** | `synthesisMode` (deductive / abductive / analogical / dialectic) |

Note: **induction is not an Idea mode in this system.** It lives at the Claims → Insights transition. See "Why induction is not an Idea mode" below.

---

## The four Idea modes (`synthesisMode`)

The Synthesizer takes Insights (or Claims) and produces **a new connection across heterogeneous elements**. Lifting a general rule out of many similar cases (= induction) is the Atomizer's job, not the Synthesizer's.

### `deductive`

- Shape: independent Claims/Insights → a strategy or combination that follows logically from them.
- Example: "A demonstrates X", "B demonstrates Y", "C demonstrates Z" → "Combining A, B, and C yields a new approach W."
- Lineage: classical deduction. If the premises hold, the conclusion holds.
- Failure mode: any premise being wrong collapses the conclusion. When tagging an Idea as `deductive`, scrutinize premise confidence.

### `abductive`

- Shape: an observation Claim/Insight (something measured) + a mechanism/known-rule Claim/Insight → the best explanatory hypothesis for the observation.
- Example: "An anomalous sign reversal was observed in Al5Co2" + "Two-band conduction can produce this kind of phenomenon" → "Al5Co2's near-Fermi DOS may have a two-band structure" (hypothesis).
- Lineage: C. S. Peirce. "Inference to the best explanation." **Most "aha"-style Ideas are abductive.**
- Failure mode: many explanations could fit any observation. Confidence is intrinsically `speculative` until verified separately.

### `analogical`

- Shape: discover a **structural mapping** between Claims/Insights in different domains, then transfer one pattern to the other.
- Example: "Background storage maintenance gradually restores fragmentation in reference structures" (software) ↔ "Biological tissue turnover gradually clears waste products" (biology) → a transfer hypothesis across both.
- Lineage: Aristotle on analogy; Gentner's structure-mapping theory.
- Failure mode: surface similarity easily induces wrong mappings. State explicitly in the rationale which element corresponds to which.

### `dialectic`

- Shape: two Claims/Insights making **opposite claims** about the same effect → a higher frame that contains both.
- Example: "Raising pH slows reduction" + "Raising pH speeds reduction" → "Rate-limiting step switches from hydroxide desorption to electron transfer around pH 11."
- Lineage: Hegelian dialectic. Thesis–antithesis–synthesis.
- Failure mode: requires a real contradiction, not just an emphasis difference. Do not over-apply.

---

## Why induction is not an Idea mode

The early design (first version of proposal v4) placed an `inductive` mode on the synthesis layer: "Three or more Claims show the same pattern, lift it into a general rule."

But reading the Atomizer's own definition carefully:

> Insight (`atom`): a thin substrate that factors out a single, context-stripped idea recurring across multiple Claims.

That **is** induction. The Atomizer is already a discovery layer that takes N similar Claims and produces M abstractions across them. So an inductive Idea and the Atomizer's output were doing the same job under different names.

PR-B4 cleans this up:

- Ideas are restricted to four modes (deductive / abductive / analogical / dialectic) — the modes that genuinely integrate **heterogeneous** elements.
- Induction is reframed as the core operation of the Insights layer.
- The Atomizer prompt explicitly names **two routes to an Insight**: induction-from-many (the cases earn the rule by repetition) and lift-from-few (a couple of Claims that are already near-principles, lifted by domain abstraction).
- The UI surfaces "derived from N Claims" on each Insight, so induction is visible as evidence.

Design implication:

- **Claims layer**: individual facts with context.
- **Insights layer (the hourglass waist)**: where context is stripped *and* repeated cases are generalized. Induction lives here.
- **Ideas layer**: where heterogeneous Insights are woven into new connections.

Induction and the four Idea modes (deduction / abduction / analogy / dialectic) are no longer peers on the same axis — they live at different layers and do different work.

> A note on terminology: the internal field names (`atomType`, `synthesisMode`) keep the original `atom` / `synthesis` vocabulary because they predate the UI rename and serve as stable identifiers for stored data. When you read code or PROV-JSON-LD exports, expect those words to appear. When you read this doc or the UI, expect *Insights* / *Ideas*.

---

## Reading the metadata

The badges on each Wiki note's banner correspond directly to the vocabulary on this page.

- **Claims** badge: value of `claimRole` (Finding / Decision / …)
- **Insights** badge: value of `atomType` (Causal / Mechanistic / …)
- **Ideas** badge: value of `synthesisMode` (Deductive / Abductive / Analogical / Dialectic)

A note without a badge is one the LLM could not infer a type for or judged inapplicable. There is no manual-tagging UI yet (we may add one if a real need surfaces).

---

## See also

- Hourglass model: [`docs/CONCEPT.md`](./CONCEPT.md)
- Data model: [`docs/DATA_MODEL.md`](./DATA_MODEL.md) §3.5 "Semantic types (Phase 1)"
