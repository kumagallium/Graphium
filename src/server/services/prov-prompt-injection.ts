// ──────────────────────────────────────────────
// PROV → AI Wiki プロンプト注入ヘルパー
//
// 提案 v4 Phase 2.2 の中核。ノートの PROV 構造サマリ（クライアントで
// summarizeNoteProv() が組み立てたもの）を、LLM プロンプトに添えやすい
// マークダウンに整形する。
//
// 設計方針:
//   - 部分情報でも価値があるので、欠けたフィールドは黙って省く
//   - LLM が procedureContext を埋めやすいよう、構造化された見出しで渡す
//   - 中身が完全に空のときは null を返し、呼び出し側で省略できるようにする
// ──────────────────────────────────────────────

/**
 * クライアントから受け取った PROV サマリの ad-hoc 型。
 * features/prov-extractor の `NoteProvSummary` と同形だが、ネットワーク越しに
 * 渡されるためここでは緩く型付けし、安全な field-by-field アクセスで読む。
 */
type IncomingProvSummary = {
  noteId?: string;
  title?: string;
  activities?: Array<{
    type?: string;
    label?: string;
    inputs?: string[];
    tools?: string[];
    parameters?: Array<{ key?: string; value?: string; raw?: string }>;
    outputs?: string[];
  }>;
  results?: Array<{
    property?: string;
    attributes?: Record<string, string>;
  }>;
  plan?: string;
};

/**
 * PROV サマリを LLM プロンプト用のマークダウン断片に整形する。
 *
 * 中身が空（activities も results も plan も無い）なら null を返す。
 * 呼び出し側で「ある場合だけ user message に prepend する」用途。
 */
export function formatProvSummaryForPrompt(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as IncomingProvSummary;

  const activities = Array.isArray(s.activities) ? s.activities : [];
  const results = Array.isArray(s.results) ? s.results : [];
  const plan = typeof s.plan === "string" && s.plan.trim().length > 0 ? s.plan.trim() : "";

  if (activities.length === 0 && results.length === 0 && plan === "") {
    return null;
  }

  const lines: string[] = [];
  lines.push("## PROV structure of the source note");
  lines.push(
    "Use this to understand the procedural skeleton the note rests on. " +
      "Knowledge in experimental science is procedure-dependent — a claim like " +
      "\"seebeck coefficient is high\" only holds *under* a specific synthesis " +
      "route and parameter range. Carry that skeleton forward when extracting " +
      "Claims / Atoms / Synthesis.",
  );

  if (plan) {
    lines.push("", "### Plan", plan);
  }

  if (activities.length > 0) {
    lines.push("", "### Steps (PROV Activities)");
    activities.forEach((a, idx) => {
      const label = a.label?.trim() || `step ${idx + 1}`;
      lines.push(`- **${label}**`);
      if (a.inputs && a.inputs.length > 0) {
        lines.push(`  - inputs: ${a.inputs.join(", ")}`);
      }
      if (a.tools && a.tools.length > 0) {
        lines.push(`  - tools: ${a.tools.join(", ")}`);
      }
      if (a.parameters && a.parameters.length > 0) {
        const params = a.parameters
          .map((p) => {
            if (p.key && p.value) return `${p.key}=${p.value}`;
            return p.raw ?? p.value ?? "";
          })
          .filter((x) => x.length > 0);
        if (params.length > 0) {
          lines.push(`  - parameters: ${params.join(", ")}`);
        }
      }
      if (a.outputs && a.outputs.length > 0) {
        lines.push(`  - outputs: ${a.outputs.join(", ")}`);
      }
    });
  }

  if (results.length > 0) {
    lines.push("", "### Top-level results (not bound to a specific Activity)");
    for (const r of results) {
      const prop = r.property?.trim();
      if (!prop) continue;
      const attrs = r.attributes && Object.keys(r.attributes).length > 0
        ? ` (${Object.entries(r.attributes).map(([k, v]) => `${k}=${v}`).join(", ")})`
        : "";
      lines.push(`- ${prop}${attrs}`);
    }
  }

  lines.push(
    "",
    "When you emit a Claim or Atom whose validity depends on this procedure, " +
      "fill the `procedureContext` field of that wiki entry (see system prompt " +
      "for the schema). If the claim is purely conceptual and procedure-independent, " +
      "leave `procedureContext` unset.",
  );

  return lines.join("\n");
}

/**
 * Claim の procedureContext を、Atomizer / Synthesizer 用のユーザーメッセージで
 * 各 Claim ブロックの下に簡潔に挿入するための短いマークダウン断片を作る。
 *
 * - 中身が無い procedureContext は null を返す（呼び出し側で空行を出さないように）
 * - 1〜数行の簡潔なフォーマット。Synthesizer は 2-4 件の Claim を扱うため、
 *   各 Claim の procedureContext は冗長にならないようにする。
 */
export function formatProcedureContextForClaimBlock(
  ctx: unknown,
): string | null {
  if (!ctx || typeof ctx !== "object") return null;
  const c = ctx as {
    protocolFingerprint?: string;
    keyParameters?: Array<{ name?: string; value?: string; necessity?: string }>;
    keyTools?: string[];
    validityRange?: string;
  };
  const parts: string[] = [];
  if (typeof c.protocolFingerprint === "string" && c.protocolFingerprint.trim()) {
    parts.push(`protocol: ${c.protocolFingerprint.trim()}`);
  }
  if (Array.isArray(c.keyTools) && c.keyTools.length > 0) {
    parts.push(`tools: ${c.keyTools.filter((x) => typeof x === "string").join(", ")}`);
  }
  if (Array.isArray(c.keyParameters) && c.keyParameters.length > 0) {
    const params = c.keyParameters
      .filter((p) => p && typeof p.name === "string" && typeof p.value === "string")
      .map((p) => `${p.name}=${p.value}${p.necessity ? ` (${p.necessity})` : ""}`)
      .join(", ");
    if (params) parts.push(`params: ${params}`);
  }
  if (typeof c.validityRange === "string" && c.validityRange.trim()) {
    parts.push(`validity: ${c.validityRange.trim()}`);
  }
  if (parts.length === 0) return null;
  return `  procedureContext — ${parts.join(" | ")}`;
}

import type { ProcedureContext } from "../../lib/document-types.js";

/**
 * 複数の source Claim の procedureContext を decide-rule で集約する
 * deterministic な intersection ヘルパー。
 *
 * LLM が procedureContext を omit したときに、サーバー側でこのヘルパーを
 * fallback として呼ぶことで「PROV があるからこそ自動で骨格が降りてくる」
 * 動きを保証する。LLM が自前で出した procedureContext を上書きはしない。
 *
 * 集約規則:
 *   - keyTools: source Claims **全て** に共通して現れるツール（文字列一致）
 *   - keyParameters: name が共通かつ value も一致するもののみ採用。
 *     necessity は最小値（critical < important < incidental の順で弱いほうへ）
 *   - protocolFingerprint / validityRange: 自然言語のため自動マージは行わない（undefined）
 *   - 何も intersect しなかった場合は undefined を返す
 *
 * 提案 v4 Phase 2.3 拡張（PR-B3.1）。
 */
export function intersectClaimProcedureContexts(
  contexts: Array<ProcedureContext | undefined>,
): ProcedureContext | undefined {
  const present = contexts.filter((c): c is ProcedureContext => Boolean(c));
  if (present.length < 2) {
    // 1 件以下では intersection の概念が曖昧。fallback としては動かない。
    return undefined;
  }

  // ── keyTools の intersection ──
  const toolsSets = present.map((c) => new Set(c.keyTools ?? []));
  const firstToolSet = toolsSets[0];
  const sharedTools = [...firstToolSet].filter((t) =>
    toolsSets.every((set) => set.has(t)),
  );

  // ── keyParameters の intersection（name + value 完全一致） ──
  const NECESSITY_RANK: Record<string, number> = {
    critical: 0,
    important: 1,
    incidental: 2,
  };
  const firstParams = present[0].keyParameters ?? [];
  const sharedParams = firstParams
    .map((p) => {
      // 他の全 source に同じ name + value が含まれているか
      const allHave = present.every((c) =>
        (c.keyParameters ?? []).some(
          (q) => q.name === p.name && q.value === p.value,
        ),
      );
      if (!allHave) return null;
      // necessity は最も弱い (rank 値が大きい) ものに揃える — 安全側
      const necessities = present.map((c) => {
        const match = (c.keyParameters ?? []).find(
          (q) => q.name === p.name && q.value === p.value,
        );
        return match?.necessity ?? "important";
      });
      const weakest = necessities.reduce((acc, n) =>
        NECESSITY_RANK[n] > NECESSITY_RANK[acc] ? n : acc,
      );
      return { name: p.name, value: p.value, necessity: weakest as ProcedureContext["keyParameters"] extends Array<infer U> | undefined ? (U extends { necessity: infer N } ? N : never) : never };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // ── derivedFromNotes: union（全 source の note を引き継ぐ） ──
  const noteSet = new Set<string>();
  for (const c of present) {
    for (const n of c.derivedFromNotes ?? []) noteSet.add(n);
  }
  const derivedFromNotes = [...noteSet];

  if (sharedTools.length === 0 && sharedParams.length === 0) {
    return undefined;
  }

  return {
    derivedFromNotes,
    keyTools: sharedTools.length > 0 ? sharedTools : undefined,
    keyParameters: sharedParams.length > 0 ? sharedParams : undefined,
    // protocolFingerprint / validityRange は自動 merge しない
  };
}
