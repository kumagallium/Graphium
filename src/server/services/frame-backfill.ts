// 判断・規則の構造（frame）補完
// 既存の知見に対し、出典の本文から逐語引用だけで frame を埋める（本文ブロックは触らない）。
// 抽出指示と検証は /ingest と共通（buildFrameInstructions / parse*Frame）。

import type {
  ClaimLevel,
  ClaimRole,
  EpistemicStatus,
  StatementForm,
} from "../../lib/document-types.js";
import { STATEMENT_FORM_VALUES } from "../../lib/document-types.js";
import {
  buildFrameInstructions,
  parseDecisionFrame,
  parseObservationFrame,
  parseRuleFrame,
  type IngesterDecisionFrame,
  type IngesterObservationFrame,
  type IngesterRuleFrame,
} from "./wiki-ingester.js";

/** 出典 1 件あたりに LLM へ渡す最大文字数（超えた分は切り詰めて truncatedSources に報告する） */
export const FRAME_SOURCE_MAX_CHARS = 40_000;

export type FrameBackfillSource = { id: string; title: string; content: string };

export type FrameBackfillClaim = {
  id: string;
  title: string;
  body: string;
  claimRole?: ClaimRole[];
  level?: ClaimLevel;
  epistemicStatus?: EpistemicStatus;
  siblingTitles: { title: string; id: string }[];
};

export type BackfilledFrame = {
  id: string;
  statementForm?: StatementForm;
  decisionFrame?: IngesterDecisionFrame;
  ruleFrame?: IngesterRuleFrame;
  observationFrame?: IngesterObservationFrame;
};

/** 出典ごとに上限で切り詰める。切った出典 id を返す（黙って落とさない） */
export function truncateSources(
  sources: FrameBackfillSource[],
): { sources: FrameBackfillSource[]; truncatedSources: string[] } {
  const truncatedSources: string[] = [];
  const out = sources.map((s) => {
    if (s.content.length <= FRAME_SOURCE_MAX_CHARS) return s;
    truncatedSources.push(s.id);
    return { ...s, content: s.content.slice(0, FRAME_SOURCE_MAX_CHARS) };
  });
  return { sources: out, truncatedSources };
}

export function buildFrameBackfillSystemPrompt(): string {
  return `You are given source notes and a list of existing Claims that were derived from them.
For each Claim, fill in its frame (statementForm / decisionFrame / ruleFrame / observationFrame) using ONLY verbatim quotes from the Sources.
If a frame does not apply to a Claim, omit that key. Do NOT invent anything that the Sources do not state. Anything that is not found verbatim in the Sources is discarded by a checker.
Do not rewrite or reinterpret the Claim itself. Only the frame is needed.
For \`triggerTitles\` and \`rationaleRuleTitles\`, use only titles listed as that Claim's sibling titles.

${buildFrameInstructions()}

## Output format

Return JSON only:

\`\`\`json
{
  "frames": [
    {
      "id": "<claim id from the request>",
      "statementForm": "instance | general",
      "decisionFrame": { "triggerTitles": [], "action": "", "rationale": null },
      "ruleFrame": { "conditions": [], "consequences": [], "mechanism": "" },
      "observationFrame": { "featureOfInterest": "", "results": [] }
    }
  ]
}
\`\`\`

Omit any key that does not apply. Use the Claim ids exactly as given.`;
}

export function buildFrameBackfillUserMessage(
  sources: FrameBackfillSource[],
  claims: FrameBackfillClaim[],
): string {
  const src = sources
    .map((s) => `### Source (id: ${s.id})\nTitle: ${s.title}\n\n${s.content}`)
    .join("\n\n---\n\n");
  const cl = claims
    .map((c) => {
      const lines = [
        `### Claim (id: ${c.id})`,
        `Title: ${c.title}`,
        `Body: ${c.body}`,
      ];
      if (c.claimRole && c.claimRole.length > 0) lines.push(`claimRole: ${c.claimRole.join(", ")}`);
      if (c.level) lines.push(`level: ${c.level}`);
      if (c.epistemicStatus) lines.push(`epistemicStatus: ${c.epistemicStatus}`);
      lines.push(
        c.siblingTitles.length > 0
          ? `Sibling titles:\n${c.siblingTitles.map((s) => `- ${s.title}`).join("\n")}`
          : "Sibling titles: (none)",
      );
      return lines.join("\n");
    })
    .join("\n\n");
  return `## Sources\n\n${src}\n\n## Claims\n\n${cl}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * LLM 出力を検証して frame に変換する。
 * - request に無い id は捨てる（同一 id は最初の 1 件のみ）
 * - 引用は sourceTexts（切り詰め後の出典本文）に逐語で出現するものだけ残す
 * - 壊れた JSON は frames 空・droppedFrames 0
 */
export function parseFrameBackfillOutput(
  text: string,
  claims: FrameBackfillClaim[],
  sourceTexts: string[],
): { frames: BackfilledFrame[]; droppedFrames: number } {
  let parsed: unknown;
  try {
    let jsonText = text.trim();
    const m = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (m) jsonText = m[1];
    parsed = JSON.parse(jsonText);
  } catch {
    return { frames: [], droppedFrames: 0 };
  }
  const rawFrames = isRecord(parsed) && Array.isArray(parsed.frames) ? parsed.frames : [];
  const byId = new Map(claims.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const frames: BackfilledFrame[] = [];
  let droppedFrames = 0;
  for (const raw of rawFrames) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    const claim = byId.get(raw.id);
    if (!claim || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const statementForm: StatementForm | undefined =
      typeof raw.statementForm === "string" &&
      (STATEMENT_FORM_VALUES as string[]).includes(raw.statementForm)
        ? (raw.statementForm as StatementForm)
        : undefined;
    const d = parseDecisionFrame(raw.decisionFrame, claim.claimRole, sourceTexts);
    const r = parseRuleFrame(raw.ruleFrame, statementForm, sourceTexts);
    const o = parseObservationFrame(raw.observationFrame, statementForm, claim.epistemicStatus, sourceTexts);
    droppedFrames += d.dropped + r.dropped + o.dropped;
    const out: BackfilledFrame = { id: claim.id };
    if (statementForm) out.statementForm = statementForm;
    if (d.frame) out.decisionFrame = d.frame;
    if (r.frame) out.ruleFrame = r.frame;
    if (o.frame) out.observationFrame = o.frame;
    frames.push(out);
  }
  return { frames, droppedFrames };
}
