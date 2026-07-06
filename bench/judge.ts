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

/** 化学式 (数字つき): 例 Bi2Te3 / TiO2 / H2PtCl6 / CO2 / N2O */
const CHEM_FORMULA_DIGIT_RE = /\b(?:[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*){0,}|(?:[A-Z][a-z]?){2,}\d+|[A-Z]{2,}\d+)\b/g;

/**
 * Atomizer-strengthen (2026-05) で追加: 元素記号 2 種以上が数字なしで連結する
 * 化合物 (ZnSb, AlV, BiTe, NaCl) を catch する。corpus に Al-V 系合金 / ZnSb 熱電
 * 化合物が登場するため、digit なしの素直な並びを取りこぼさないようにする。
 */
const CHEM_FORMULA_NODIGIT_RE = /\b(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn)(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn)+\b/g;

/**
 * 3 文字以上の大文字略語: 例 SPS / XRD / ORR / qPCR / DMEM / MHC / NTP / PROV.
 *
 * Atomizer-strengthen で 2-char (`AI`, `OS`, `UI` 等) を外し 3+ に絞った。
 * これにより stoplist でカバーしきれなかった 2-char 一般略語 (CI, OS, TS, JS) を
 * pattern 段階で誤検知しなくなる。3+ char の真に specific な略語 (SPS, PROV, ZT)
 * は引き続き catch。
 */
const ACRONYM_3PLUS_RE = /\b[A-Z]{3,}(?:[a-z][A-Z]+)?\b/g;

/** 装置 / 製品 ID パターン: 例 ZEM-3 / GPT-4 / Dr Sinter（ハイフン or 数字付き名前） */
const PRODUCT_ID_RE = /\b[A-Z][a-zA-Z]+(?:[-\s][A-Z]?[a-zA-Z]*)?[-\s]?\d+[A-Za-z]?\b/g;

/**
 * Atomizer-strengthen (2026-05) で追加: hyphenated 大文字始まり複合
 * (Klemens-Callaway, Klein-Nishina, von-Neumann)。物理式 / 理論 / 人名複合を catch。
 */
const HYPHENATED_PROPER_RE = /\b[A-Z][a-zA-Z]+-[A-Z][a-zA-Z]+\b/g;

/**
 * domain-specific っぽいカタカナ + 英数字の混在: 例 「siRNAトランスフェクション」「NaCl結晶」
 * 4 文字以上のカタカナ語自体は domain-general としていったん許容する（spec §5 plain-language register）。
 */
const KATAKANA_ASCII_HYBRID_RE = /[ァ-ヾー]+[A-Za-z0-9]/g;

function findJargonTokens(text: string): string[] {
  const matches = new Set<string>();
  for (const re of [
    CHEM_FORMULA_DIGIT_RE,
    CHEM_FORMULA_NODIGIT_RE,
    ACRONYM_3PLUS_RE,
    PRODUCT_ID_RE,
    HYPHENATED_PROPER_RE,
    KATAKANA_ASCII_HYBRID_RE,
  ]) {
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

export type JudgeKind = "heuristic" | "live";

export type JudgePack = {
  kind: JudgeKind;
  lift: LiftJudge;
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

export function createHeuristicJudges(): JudgePack {
  return {
    kind: "heuristic",
    lift: async (atom) => heuristicLift(atom),
    meta: { provider: "heuristic", modelId: "n/a", modelName: "heuristic (pattern-based jargon)" },
  };
}

// 同期版（metrics.test.ts のため）
export function judgeAtomLift(atom: BenchAtom): Judgment {
  return heuristicLift(atom);
}

// ─── Live (LLM-as-judge) ──────────────────────────────────────────────────────

const LIFT_RUBRIC = `You are evaluating whether an Atom title has been "lifted" to a domain-general level (rung-2).

rung-2 = the proposition stands on its own without naming the specific instrument, material, abbreviation, formula name, or jargon of the source domain. A non-specialist should understand the gist.

rung-1 (FAIL) examples — fail if ANY of the following kinds of tokens is load-bearing in the title:
  - Material / chemistry: "SPS 焼結条件で ZnSb が単相化する", "Bi2Te3 に Sb をドープすると ZT が向上する", "Al3V 系合金で熱伝導率が低下する", "Pt/C 触媒の ORR 活性が向上する"
  - Named formula / theory / law: "Klemens-Callaway モデルで格子熱伝導率を予測できる", "温度依存ローレンツ数を導入すると熱物性予測が改善する"
  - Specific standard / spec: "PROV-DM で合成手順をモジュール化できる", "OAuth でトークン更新する"
  - Domain abbreviations / jargon: "ホットプレスで単相形成が安定する", "ホール濃度の増加でパワーファクターが向上する", "siRNA でノックダウンする", "Redis でレートリミットを実装する", "律速段階が水酸化物の脱離から電子移動に切り替わる"
  - Economics / sociology / social-science academic terms: "二面市場は臨界規模を超えて初めて正のネットワーク効果が現れる", "個人のわずかな同類志向が全体で強い居住分離を生む", "貧困の罠は世帯レベルで顕在化しやすく国レベルでは見えにくい", "ナッシュ均衡では各人が一方的に行動を変えても損になる", "外部性が大きい財は市場だけでは最適に供給されない", "情報の非対称性は逆選択を生む". 日本語の漢字 4 字以下でも、特定学派の造語は rung-1。

rung-2 (PASS) examples — describe the same mechanism without naming the specific instance:
  - "短時間の高温処理で揮発成分の分布が変わる"
  - "二種類の元素でできた化合物に少量の別元素を加えると、運ぶ性質と熱を妨げる性質が同時に変わる"
  - "格子の振動から熱の伝わりを見積もる古典モデルに温度の効果を入れると、高温域の見積もりが揃う"
  - "助触媒の担持で還元活性点が増える"
  - "由来を辿れるかたちで作業を記述する仕組みは、工程の組み替えと再利用を扱いやすくする"
  - "トークンバケットで burst を許容しつつ定常負荷を平等化する"
  - "二種類の利用者が互いに集まるほど価値が増す場では、片方を呼び込める仕組みが先に立ち上がる"
  - "似た立場の人と関わることを選びやすい傾向が積み重なると、属性ごとに住む場所が分かれていく"
  - "ある状態に一度落ちると自力で抜け出しづらい仕組みが、個人レベルでは見えるのに集計レベルでは見えにくい"

Respond with ONLY a single JSON object (no markdown):
{"passed": true | false, "reason": "<one short sentence>"}

passed=true ⟺ the Atom title contains no domain-specific proper noun, instrument name, chemical formula (with or without digits), formula / theory name, specification name, abbreviation, or jargon that would force a non-specialist to look up the term to decode the sentence.`;

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
  // createModel は async（Promise<LanguageModel> を返す）。createLiveJudges を async 化すると
  // buildJudges / runner まで波及するため、ここで Promise を 1 度だけ生成し、async な lift
  // クロージャ内で await して解決する（解決済み Promise の再 await は即時なのでキャッシュになる）。
  const modelPromise = createModel(modelConfig);

  const lift: LiftJudge = async (atom) => {
    const userMessage = `Atom title: "${atom.title}"\nAtom body: ${atom.body || "(empty)"}`;
    try {
      const model = await modelPromise;
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

  return {
    kind: "live",
    lift,
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
    // claude-subscription は apiKey ではなくローカル claude CLI の OAuth で認証するため、
    // apiKey 空でも live judge を使える。それ以外の provider は従来通り apiKey を要求する。
    const hasCreds = cfg.apiKey.trim().length > 0 || cfg.provider === "claude-subscription";
    if (!hasCreds) {
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
