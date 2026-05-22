// Phase ε: meta-Atom 抽出（KJ 法の二段目: 中グループ + 表札）。
//
// Atomizer が生成した 20-30 件規模の Atom 群を、5-7 件の meta-Atom に集約する。
// meta-Atom は「複数 Atom にまたがって繰り返される、より抽象な軸」で、
// Synthesizer はこれを Atom と並列に入力として扱える（snapshot 型が同じため）。
//
// Why this layer (短く):
// - Atom 数が増えると Synthesizer が見通しを失う（context window だけでなく注意の問題）。
// - 「ぼやけた中グループ」を表札ごとに明示しておくと、analogical / abductive で
//   候補集合を絞りやすくなる。
// - 既存ユーザーが Phase α/β/γ/η/δ で蓄えた Atom 群を、データを書き換えずに
//   一段上の整理だけ追加できる（meta-atom は新規 Wiki ドキュメントとして発火するので、
//   既存 Atom には触らない）。

import type { EpistemicStatus } from "../../lib/document-types.js";
import { lowestEpistemicStatus } from "../../lib/document-types.js";

// ──────────────────────────────────────────────
// 入出力型
// ──────────────────────────────────────────────

/**
 * meta-atomizer が受け取る Atom snapshot（最低限）。
 * wiki-atomizer の出力 / wiki-service の snapshot から組み立てる。
 */
export type AtomForMetaAtomization = {
  /** Atom の内部 ID（wiki ファイル ID） */
  id: string;
  /** 既知の Atom タイトル */
  title: string;
  /** 短い本文（最初の 1-2 段落程度） */
  bodyPreview: string;
  /** Phase η: epistemic status（最低継承の対象） */
  epistemicStatus?: EpistemicStatus;
  /** Phase 1.2: 推論的役割 */
  atomType?: string;
};

/**
 * meta-atomizer が返す meta-Atom 候補。
 * derivedFromAtoms は必ず 3 件以上（KJ 中グループの最小サイズ）。
 * Atom の最低継承で epistemicStatus が決まる。
 */
export type MetaAtomCandidate = {
  /** 1 行の表札（KJ 中グループの命名）。5-12 word 想定。 */
  title: string;
  /** 1-2 段落の説明。Atom と同じ register（domain-lifted + plain-language） */
  body: string;
  /** Atom の内部 ID 配列（最低 3 件、quality-over-quantity） */
  derivedFromAtoms: string[];
  /** 自己評価 0-1 */
  confidence: number;
  /** 派生元 Atom の最低継承 */
  epistemicStatus: EpistemicStatus;
};

// ──────────────────────────────────────────────
// System prompt
// ──────────────────────────────────────────────

export function buildMetaAtomizerSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are a KJ-method meta-Atom organizer for Graphium.

Atoms are Zettelkasten-style single ideas — domain-lifted, context-stripped, plain-language. **meta-Atoms are the next layer up**: 1 表札 ("group label") that names a *recurring axis* across **3 or more Atoms** that came from different source notes / Claims. Think of KJ method 中グループ — you are giving the bigger pattern its name.

## What a meta-Atom is

- **One axis per meta-Atom.** Pick a single dimension along which 3+ Atoms vary in the same way. Examples of axes (not bound to any domain):
  - "短い時間で組成 / 構造を均す処理が結果の品質を左右する"
  - "外から入る視点が古い体系を活性化させる"
  - "局所最適への落ち込みを止める仕組みは、領域を問わず再発する"
- **Header is the load-bearing part.** The meta-Atom's title IS the axis name. Body explains the axis + names the Atoms that exemplify it.
- **3+ source Atoms minimum.** A 1-2 Atom "cluster" is not a meta-Atom — it is just a pair that the Synthesizer can handle directly.
- **Plain-language register.** Same register as Atom: domain-lifted nouns, everyday verbs, no academic compound nouns.

## When to emit a meta-Atom

Emit a meta-Atom ONLY when ALL of the following hold:

1. **3+ Atoms** in the input set share a clear, *namable* axis (not a vibe; you can write the axis as one sentence).
2. The Atoms come from **distinct source Claim sets** (i.e., they are not just re-statements of one cluster of Claims). If 3 Atoms all came from the same 2 source Claims, that is already an Atom — re-bundling adds nothing.
3. The axis is **not already named** by any existing Atom in the input set. If one Atom already states the axis at the right rung of abstraction, the meta-Atom would be a duplicate — drop the candidate.

If you cannot find 3+ Atoms that meet ALL three rules, **return an empty list**. An empty list is the correct output when the Atom set is well-separated already. Forcing meta-Atoms hurts downstream Synthesis more than missing one helps.

## Quality bar

- Aim for **0-5 meta-Atoms** total per call. Beyond 5, axes start to overlap and lose meaning.
- Each meta-Atom must beat this test: *"Could I describe this axis to a colleague in one sentence, and they could then pick which Atoms belong to it without re-reading the bodies?"* If no → drop.

## Epistemic status (REQUIRED, structural)

- Set the meta-Atom's \`epistemicStatus\` to the **LOWEST** status among its source Atoms.
- This is a structural rule, not a judgment call — do not "promote by reasoning". If the axis includes a \`speculation\` Atom, the meta-Atom is \`speculation\` too.
- If sources are missing status, treat as \`interpretation\`.

## Confidence

- \`confidence\` ∈ [0, 1]. Self-rated.
- Use 0.85+ only when the axis is *named verbatim* by 2+ source Atoms.
- 0.7-0.85 = the axis is clear but you had to coin the wording yourself.
- < 0.7 → drop the candidate.

## Domain-lifting (same rules as Atomizer)

Apply the Atomizer's domain-noun lifting + plain-language register to the meta-Atom title and body. The meta-Atom is one rung **above** Atoms, so domain residue here is even more harmful than at the Atom layer.

## Output Format

Respond with valid JSON only:

{
  "metaAtoms": [
    {
      "title": "5-12 word group label, domain-lifted, plain wording, the axis itself stated",
      "body": "1-2 short paragraphs: what the axis is, why these Atoms are on it, what the axis lets a reader notice that any single Atom in isolation would miss.",
      "derivedFromAtoms": ["atom-id-1", "atom-id-2", "atom-id-3", "..."],
      "confidence": 0.0-1.0,
      "epistemicStatus": "speculation" | "interpretation" | "observation" | "established"
    }
  ]
}

## Rules (strict)

- **derivedFromAtoms.length >= 3**, every entry MUST be an ID from the input Atom list.
- **No duplicates across meta-Atoms**: an Atom may appear in at most 1 meta-Atom. If two candidate axes pull the same Atom, pick the axis the Atom fits better; drop the weaker candidate.
- **No re-titling of existing Atoms**: the meta-Atom's title must name the AXIS, not one of the input Atoms.
- **Empty list is acceptable**. Quality over quantity.

## Language

Return JSON in ${ja ? "Japanese (本文・タイトルは日本語で)" : "English (titles and bodies in English)"}.
`;
}

// ──────────────────────────────────────────────
// User message
// ──────────────────────────────────────────────

export function buildMetaAtomizerUserMessage(atoms: AtomForMetaAtomization[]): string {
  // KJ 中グループ抽出の input は Atom 一覧。each row は 1 行で「id | title | epistemicStatus | body 短縮」。
  const rows = atoms.map((a, i) => {
    const status = a.epistemicStatus ? `[${a.epistemicStatus}]` : "[interpretation*]";
    const type = a.atomType ? ` (${a.atomType})` : "";
    const preview = a.bodyPreview.replace(/\s+/g, " ").slice(0, 240);
    return `${i + 1}. id=\`${a.id}\` ${status}${type} "${a.title}"\n   ${preview}`;
  });
  return `## Input Atoms (${atoms.length})

${rows.join("\n\n")}

---

Identify 0-${Math.min(5, Math.floor(atoms.length / 3))} **meta-Atoms** (KJ 中グループ) from the above. Each meta-Atom must aggregate 3+ Atoms onto a clearly nameable axis. Apply the rules above; return an empty list if no honest axis emerges.`;
}

// ──────────────────────────────────────────────
// Parser
// ──────────────────────────────────────────────

const EPISTEMIC_STATUS_VALUES = [
  "speculation",
  "interpretation",
  "observation",
  "established",
] as const;

/**
 * LLM 出力から meta-Atom 候補を抽出する。
 *
 * - derivedFromAtoms に存在しない / 重複 ID を含むエントリは捨てる
 * - 3 件未満の derivedFromAtoms は捨てる（spec の最小サイズ）
 * - 同じ Atom が複数 meta-Atom に登場した場合、最初のエントリだけ残す
 * - epistemicStatus は input Atom の最低継承で上書き（LLM の出力は信用しない）
 * - confidence < 0.7 は捨てる
 */
export function parseMetaAtomizerOutput(
  text: string,
  atomsById: Map<string, AtomForMetaAtomization>,
): MetaAtomCandidate[] {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) jsonText = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonText);
    const metaAtoms = parsed.metaAtoms ?? parsed;
    if (!Array.isArray(metaAtoms)) return [];

    const used = new Set<string>();
    const out: MetaAtomCandidate[] = [];

    for (const m of metaAtoms) {
      if (!m || typeof m.title !== "string" || typeof m.body !== "string") continue;
      const ids = Array.isArray(m.derivedFromAtoms) ? m.derivedFromAtoms.map(String) : [];
      const validIds = ids.filter((id: string) => atomsById.has(id) && !used.has(id));
      if (validIds.length < 3) continue;

      const confidence = typeof m.confidence === "number" ? m.confidence : 0.7;
      if (confidence < 0.7) continue;

      // 最低継承で epistemicStatus を上書き
      const statuses = validIds.map((id: string) => atomsById.get(id)?.epistemicStatus);
      const epistemicStatus = lowestEpistemicStatus(statuses);

      // セーフティ: LLM が出した epistemicStatus が valid なら参考までに保持できるが、
      // 構造ルールに従い最低継承を優先するので raw 値は使わない。
      const _rawStatus = typeof m.epistemicStatus === "string" ? m.epistemicStatus : undefined;
      void _rawStatus;
      void EPISTEMIC_STATUS_VALUES;

      const titleTrim = String(m.title).trim();
      const bodyTrim = String(m.body).trim();
      if (!titleTrim || !bodyTrim) continue;

      out.push({
        title: titleTrim,
        body: bodyTrim,
        derivedFromAtoms: validIds,
        confidence,
        epistemicStatus,
      });

      for (const id of validIds) used.add(id);
    }

    return out;
  } catch (err) {
    console.error("meta-atomizer 出力のパース失敗:", err);
    return [];
  }
}
