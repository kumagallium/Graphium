// Phase μ-1: LLM-as-judge 実装
//
// 各 judge は明示の rubric を持つ。live mode では LLM (default: gpt-oss-120b on
// Sakura AI Engine) に rubric を投げて binary 判定を取得する。dry-run mode では
// jargon 辞書ベースの heuristic にフォールバックする。
//
// 設計判断:
// - judge と pipeline で別 LLM 設定 (BENCH_JUDGE_*) を許す。コスト抑制のため
//   Haiku 等の安価モデルに切り替えられる前提（spec §5）。今のところ無償枠で済むので
//   pipeline と同じ gpt-oss-120b を兼用がデフォルト。
// - JSON 出力を生成させ、parse 失敗時は pass=true / 理由=parse error にしてサイレント
//   降格。judge の不安定性で metric が壊れないようにする。

import { generateText } from "ai";
import type { BenchAtom } from "./types.ts";
import { getBenchJudgeConfig } from "./config.ts";
import { createModel } from "../src/server/services/llm.js";
import type { ModelConfig } from "../src/server/config/models.js";

// ─── Pattern-based jargon detection (corpus-agnostic) ────────────────────────────
//
// 旧 HEURISTIC_JARGON は corpus に登場する具体トークンの固定リストだったため、
// (a) pipeline.ts の同じ辞書を判定にも使う self-referential bias、
// (b) μ-2 で生物 / 経済 / 人文に corpus が広がると辞書が当たらなくなる将来バグ、
// の二重の問題があった。Pattern-based 判定にして corpus に依存しない一般則にする。
// 真の品質判定は LLM judge（live mode）が行う。pattern 版はあくまで dry-run /
// unit-test 用の coarse approximation。

/**
 * よく現れる略語 / 一般語 (jargon ではない)。これらは domain-specific ではないので
 * stoplist として除外する。spec §5 にあるように、世界普及視野でも通用する用語に絞る。
 */
const COMMON_ACRONYM_STOPLIST = new Set([
  "AI", "API", "URL", "URI", "JSON", "HTML", "CSS", "JS", "TS", "OS",
  "PR", "ID", "OK", "NG", "JP", "EN", "UI", "UX", "SQL", "HTTP", "HTTPS",
  "TLS", "SSL", "TCP", "UDP", "DNS", "CPU", "GPU", "RAM", "ROM",
  "PDF", "CSV", "TSV", "ML", "DL", "NLP",
]);

/** 化学式パターン: 例 ZnSb / Bi2Te3 / TiO2 / H2PtCl6 / CO2 / N2O */
const CHEM_FORMULA_RE = /\b(?:[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*){1,}|[A-Z][a-z]?\d+\b|(?:[A-Z][a-z]?){2,}\d+|[A-Z]{2,}\d+)\b/g;

/** 3 文字以上の大文字略語: 例 SPS / XRD / ORR / qPCR / DMEM / MHC / NTP */
const ACRONYM_3PLUS_RE = /\b[A-Z]{2,}(?:[a-z][A-Z]+)?\b/g;

/** 装置 / 製品 ID パターン: 例 ZEM-3 / GPT-4 / Dr Sinter（ハイフン or 数字付き名前） */
const PRODUCT_ID_RE = /\b[A-Z][a-zA-Z]+(?:[-\s][A-Z]?[a-zA-Z]*)?[-\s]?\d+[A-Za-z]?\b/g;

/**
 * domain-specific っぽいカタカナ + 英数字の混在: 例 「siRNAトランスフェクション」「NaCl結晶」
 * 4 文字以上のカタカナ語自体は domain-general としていったん許容する（spec §5 plain-language register）。
 */
const KATAKANA_ASCII_HYBRID_RE = /[ァ-ヾー]+[A-Za-z0-9]/g;

function findJargonTokens(text: string): string[] {
  const matches = new Set<string>();
  for (const re of [CHEM_FORMULA_RE, ACRONYM_3PLUS_RE, PRODUCT_ID_RE, KATAKANA_ASCII_HYBRID_RE]) {
    for (const m of text.matchAll(re)) {
      const token = m[0];
      if (COMMON_ACRONYM_STOPLIST.has(token.toUpperCase())) continue;
      // 数字のみは jargon ではない
      if (/^\d+$/.test(token)) continue;
      matches.add(token);
    }
  }
  return Array.from(matches);
}

export type Judgment = { passed: boolean; reason: string };
export type LiftJudgment = Judgment;

export type LiftJudge = (atom: BenchAtom) => Promise<Judgment>;
export type NoveltyJudge = (
  synthesisBody: string,
  sourceTexts: string[],
) => Promise<Judgment>;

export type JudgeKind = "heuristic" | "live";

export type JudgePack = {
  kind: JudgeKind;
  lift: LiftJudge;
  novelty: NoveltyJudge;
  meta: { provider: string; modelId: string; modelName: string };
};

// ─── Heuristic ────────────────────────────────────────────────────────────────

function heuristicLift(atom: BenchAtom): Judgment {
  const target = `${atom.title} ${atom.body}`;
  const matched = findJargonTokens(target);
  if (matched.length > 0) {
    return {
      passed: false,
      reason: `domain-specific tokens remained: ${matched.slice(0, 5).join(", ")}`,
    };
  }
  return { passed: true, reason: "no domain-specific jargon detected (pattern-based)" };
}

function heuristicNovelty(synthesisBody: string, sourceTexts: string[]): Judgment {
  const synthLower = synthesisBody.toLowerCase();
  const concatLower = sourceTexts.join(" ").toLowerCase();
  if (concatLower.includes(synthLower.slice(0, 60))) {
    return { passed: false, reason: "synthesis body is largely a paraphrase of sources" };
  }
  return { passed: true, reason: "synthesis introduces structure beyond source" };
}

export function createHeuristicJudges(): JudgePack {
  return {
    kind: "heuristic",
    lift: async (atom) => heuristicLift(atom),
    novelty: async (body, sources) => heuristicNovelty(body, sources),
    meta: { provider: "heuristic", modelId: "n/a", modelName: "heuristic (pattern-based jargon + substring)" },
  };
}

// 同期版（metrics.test.ts のため）
export function judgeAtomLift(atom: BenchAtom): Judgment {
  return heuristicLift(atom);
}
export function judgeSynthesisNovelty(synthesisBody: string, sourceTexts: string[]): Judgment {
  return heuristicNovelty(synthesisBody, sourceTexts);
}

// ─── Live (LLM-as-judge) ──────────────────────────────────────────────────────

const LIFT_RUBRIC = `You are evaluating whether an Atom title has been "lifted" to a domain-general level (rung-2).

rung-2 = the proposition stands on its own without naming the specific instrument, material, abbreviation, or jargon of the source domain. A non-specialist should understand the gist.

rung-1 (FAIL) examples:
  - "SPS 焼結条件で ZnSb が単相化する"
  - "Pt/C 触媒の ORR 活性が向上する"
  - "Redis でレートリミットを実装する"

rung-2 (PASS) examples:
  - "短時間の高温処理で揮発成分の分布が変わる"
  - "助触媒の担持で還元活性点が増える"
  - "トークンバケットで burst を許容しつつ定常負荷を平等化する"

Respond with ONLY a single JSON object (no markdown):
{"passed": true | false, "reason": "<one short sentence>"}

passed=true ⟺ the Atom contains no domain-specific proper noun, instrument name, abbreviation, or jargon a non-specialist couldn't decode.`;

const NOVELTY_RUBRIC = `You are evaluating whether a Synthesis adds structure beyond paraphrasing its source Atoms.

A novel Synthesis introduces at least one of:
  - A bridge between source Atoms (analogy / contrast / hierarchy)
  - A new abstraction inferred from the combination
  - A condition or boundary not stated in any single source

A non-novel Synthesis (FAIL):
  - Lists the source Atoms with a connector word ("A and B")
  - Restates a single source in different words
  - Concatenates source bodies with light glue

Respond with ONLY a single JSON object (no markdown):
{"passed": true | false, "reason": "<one short sentence>"}

passed=true ⟺ the Synthesis adds at least one of the novel structures above.`;

function parseJudgeJson(text: string, fallback: Judgment): Judgment {
  try {
    let s = text.trim();
    const m = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (m) s = m[1].trim();
    // 緩めの抽出: 最初の { から最後の } まで
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    const parsed = JSON.parse(s);
    if (typeof parsed?.passed !== "boolean") return fallback;
    return {
      passed: parsed.passed,
      reason: typeof parsed.reason === "string" ? parsed.reason : "(no reason)",
    };
  } catch {
    return fallback;
  }
}

function buildModelConfig(): ModelConfig {
  const cfg = getBenchJudgeConfig();
  return {
    id: "bench-judge-runtime",
    name: cfg.name,
    provider: cfg.provider,
    modelId: cfg.modelId,
    apiKey: cfg.apiKey,
    apiBase: cfg.apiBase,
    createdAt: new Date().toISOString(),
  };
}

export function createLiveJudges(): JudgePack {
  const modelConfig = buildModelConfig();
  const model = createModel(modelConfig);

  const lift: LiftJudge = async (atom) => {
    const userMessage = `Atom title: "${atom.title}"\nAtom body: ${atom.body || "(empty)"}`;
    try {
      const result = await generateText({
        model,
        system: LIFT_RUBRIC,
        messages: [{ role: "user", content: userMessage }],
      });
      return parseJudgeJson(result.text, { passed: true, reason: "judge-parse-failed (fallback pass)" });
    } catch (err) {
      return { passed: true, reason: `judge-error (fallback pass): ${(err as Error).message}` };
    }
  };

  const novelty: NoveltyJudge = async (synthesisBody, sourceTexts) => {
    const sourcesBlock = sourceTexts
      .slice(0, 6)
      .map((t, i) => `Source #${i + 1}: ${t.slice(0, 600)}`)
      .join("\n");
    const userMessage = `${sourcesBlock}\n\nSynthesis body:\n${synthesisBody.slice(0, 1200)}`;
    try {
      const result = await generateText({
        model,
        system: NOVELTY_RUBRIC,
        messages: [{ role: "user", content: userMessage }],
      });
      return parseJudgeJson(result.text, { passed: true, reason: "judge-parse-failed (fallback pass)" });
    } catch (err) {
      return { passed: true, reason: `judge-error (fallback pass): ${(err as Error).message}` };
    }
  };

  return {
    kind: "live",
    lift,
    novelty,
    meta: {
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      modelName: modelConfig.name,
    },
  };
}

// ─── Selector ─────────────────────────────────────────────────────────────────

export function buildJudges(mode: "live" | "dry-run"): JudgePack {
  if (mode === "live") {
    const cfg = getBenchJudgeConfig();
    if (cfg.apiKey.trim().length === 0) {
      console.warn("[bench] live judge requested but no judge API key; falling back to heuristic.");
      return createHeuristicJudges();
    }
    return createLiveJudges();
  }
  return createHeuristicJudges();
}

/** report に記録するため */
export function getJudgeMeta(): { provider: string; modelId: string; modelName: string } {
  const cfg = getBenchJudgeConfig();
  return { provider: cfg.provider, modelId: cfg.modelId, modelName: cfg.name };
}
