// 洞察（Atom）発見の「組み立て」と「判定の適用」を純関数に切り出したもの。
// /api/wiki/atomize のルートと、MCP の洞察ツール（insight-tools）の両方から使う。
// LLM を呼ぶ側（ルート＝同じモデルの別呼び出し／MCP＝外の AI の別の文脈）だけが違い、
// プロンプトの組み立て・ジャッジの対象の選び方・答えの反映・失敗時の既定は 1 か所にそろえる
// （ルートと MCP でずれを生まないため。段 1 の wiki-prompts.ts と同じ考え方）。
//
// 失敗時の既定（アプリのルートと同じ）:
//   transfer … 答えが無い・妥当でない → 外す（fail-closed）
//   fold     … 答えが無い → そのまま（fail-open）
//   relift   … 答えが無い → 元の文
//   重複     … 答えが無い → 別（新規）

import {
  buildAtomizerSystemPrompt,
  buildAtomizerUserMessage,
  buildFoldJudgeUserMessage,
  buildReliftUserMessage,
  buildTransferJudgeUserMessage,
  detectRung1Tokens,
  parseAtomizerOutput,
  resolveFoldVerdict,
  type AtomCandidate,
  type FoldJudgeInput,
  type FoldJudgeResult,
  type ReliftInput,
  type ReliftResult,
  type TransferJudgeInput,
  type TransferJudgeResult,
} from "./wiki-atomizer.js";
import type { ClaimSnapshot } from "./wiki-types.js";

// ── 発見（atomizer）────────────────────────────────────────

export type AtomizePrompt = { systemPrompt: string; userMessage: string };

/** atomizer のシステムプロンプトとユーザーメッセージを組む（/atomize ルートと MCP 共通） */
export function buildAtomizePrompt(
  concepts: ClaimSnapshot[],
  existingAtomTitles: string[],
  language: string,
): AtomizePrompt {
  return {
    systemPrompt: buildAtomizerSystemPrompt(language || "en"),
    userMessage: buildAtomizerUserMessage(concepts, existingAtomTitles),
  };
}

/**
 * atomizer の出力を読む。入力に配った知見の id・status・rebuttal だけを parser に渡す
 * （配っていない id は落ち、epistemicStatus は最低継承、rebuttal は 2 件以上で伝播）
 */
export function parseAtomizeOutput(text: string, concepts: ClaimSnapshot[]): AtomCandidate[] {
  const idToTitle = new Map<string, string>(concepts.map((c) => [c.id, c.title]));
  // Phase η: source Claim の epistemicStatus も parser に渡し、lowest-status inheritance を強制する
  const idToEpistemic = new Map(concepts.map((c) => [c.id, c.epistemicStatus]));
  // Phase γ: source Claim の rebuttalConditions を parser に渡し、共通 rebuttal 伝播ガードを強制する
  const idToRebuttals = new Map(concepts.map((c) => [c.id, c.rebuttalConditions]));
  return parseAtomizerOutput(text, idToTitle, idToEpistemic, idToRebuttals);
}

// ── transfer（越境転移の敵対的ジャッジ）──────────────────────

export type TransferJudgePlan = {
  /** atoms の何番目か（ジャッジの index は 1 始まりでこの並びに対応する） */
  targets: number[];
  items: TransferJudgeInput[];
};

/** transfer を持つ洞察だけを対象に、ジャッジの入力を組む */
export function planTransferJudge(atoms: AtomCandidate[]): TransferJudgePlan {
  const targets: number[] = [];
  const items: TransferJudgeInput[] = [];
  atoms.forEach((a, i) => {
    if (!a.transfer) return;
    targets.push(i);
    items.push({ title: a.title, shape: a.shape, field: a.transfer.field, example: a.transfer.example });
  });
  return { targets, items };
}

export function buildTransferJudgeMessage(plan: TransferJudgePlan): string {
  return buildTransferJudgeUserMessage(plan.items);
}

/**
 * transfer の答えを反映する。妥当と確認できないものは外す（答えが取れない場合も保守的に外す）。
 * verdicts が null ならジャッジ自体が失敗したとみなして全部外す。洞察（principle）自体は常に残す
 */
export function applyTransferVerdicts(
  atoms: AtomCandidate[],
  plan: TransferJudgePlan,
  verdicts: TransferJudgeResult[] | null,
): AtomCandidate[] {
  if (plan.targets.length === 0) return atoms;
  if (verdicts === null) return atoms.map((a) => (a.transfer ? { ...a, transfer: undefined } : a));
  const out = atoms.map((a) => ({ ...a }));
  plan.targets.forEach((atomIndex, k) => {
    const v = verdicts.find((r) => r.index === k + 1) ?? verdicts[k];
    if (!v || !v.valid) out[atomIndex] = { ...out[atomIndex], transfer: undefined };
  });
  return out;
}

// ── fold（束ねた知見の co-structure ジャッジ）──────────────────

export type FoldJudgePlan = {
  targets: { atomIndex: number; ids: string[] }[];
  items: FoldJudgeInput[];
};

/** 派生元が 2 件以上の洞察だけを対象に、ジャッジの入力を組む */
export function planFoldJudge(atoms: AtomCandidate[], concepts: ClaimSnapshot[]): FoldJudgePlan {
  const idToSnapshot = new Map<string, ClaimSnapshot>(concepts.map((c) => [c.id, c]));
  const targets: FoldJudgePlan["targets"] = [];
  const items: FoldJudgeInput[] = [];
  atoms.forEach((a, i) => {
    if (a.derivedFromClaims.length < 2) return;
    const ids = [...a.derivedFromClaims];
    targets.push({ atomIndex: i, ids });
    items.push({
      title: a.title,
      shape: a.shape,
      claims: ids.map((id, pos) => {
        const snap = idToSnapshot.get(id);
        return { id, title: snap?.title ?? a.derivedFromConceptTitles[pos] ?? id, preview: snap?.bodyPreview ?? "" };
      }),
    });
  });
  return { targets, items };
}

export function buildFoldJudgeMessage(plan: FoldJudgePlan): string {
  return buildFoldJudgeUserMessage(plan.items);
}

/**
 * fold の答えを反映する。判定が取れない洞察はそのまま（fail-open）。
 * 確認できた部分集合に derivedFromClaims を絞り、落とした件数を foldDroppedClaims に残す
 */
export function applyFoldVerdicts(
  atoms: AtomCandidate[],
  plan: FoldJudgePlan,
  verdicts: FoldJudgeResult[] | null,
  concepts: ClaimSnapshot[],
): AtomCandidate[] {
  if (plan.targets.length === 0 || verdicts === null) return atoms;
  const idToSnapshot = new Map<string, ClaimSnapshot>(concepts.map((c) => [c.id, c]));
  const out = atoms.map((a) => ({ ...a }));
  plan.targets.forEach((w, k) => {
    const v = verdicts.find((r) => r.index === k + 1) ?? verdicts[k];
    if (!v) return;
    const { confirmed, dropped, changed } = resolveFoldVerdict(w.ids, v.coherentClaimIds);
    if (!changed) return;
    const atom = out[w.atomIndex];
    // derivedFromConceptTitles を id と同じ並びで作り直す（位置対応の維持は必須。
    // グラフ描画 / @リンク解決 / regenerate がこの 2 配列を zip して読む）
    const titles = confirmed.map((id) => {
      const idx = atom.derivedFromClaims.indexOf(id);
      return idx >= 0 ? atom.derivedFromConceptTitles[idx] : (idToSnapshot.get(id)?.title ?? id);
    });
    out[w.atomIndex] = {
      ...atom,
      derivedFromClaims: confirmed,
      derivedFromConceptTitles: titles,
      foldDroppedClaims: dropped > 0 ? dropped : undefined,
    };
  });
  return out;
}

// ── relift（平易化）──────────────────────────────────────────

export type ReliftTarget = { atomIndex: number; jargon: string[] };

/** relift の 1 パス目: 全洞察（jargon 指定なし＝モデルが自分で判断する。分野非依存） */
export function planReliftAll(atoms: AtomCandidate[]): ReliftTarget[] {
  return atoms.map((_, atomIndex) => ({ atomIndex, jargon: [] as string[] }));
}

/** relift の 2 パス目: コード（detectRung1Tokens）で式・略語の取りこぼしを検出した洞察だけ */
export function planReliftResidual(atoms: AtomCandidate[]): ReliftTarget[] {
  return atoms
    .map((a, atomIndex) => ({ atomIndex, jargon: detectRung1Tokens(a.title, a.body) }))
    .filter((x) => x.jargon.length > 0);
}

export function buildReliftMessage(atoms: AtomCandidate[], targets: ReliftTarget[]): string {
  const items: ReliftInput[] = targets.map((t) => ({
    title: atoms[t.atomIndex].title,
    body: atoms[t.atomIndex].body,
    jargon: t.jargon,
  }));
  return buildReliftUserMessage(items);
}

/** relift の答えを反映する。title と body が両方あるものだけ差し替える。答えが無ければ元の文 */
export function applyReliftRewrites(
  atoms: AtomCandidate[],
  targets: ReliftTarget[],
  rewrites: ReliftResult[],
): AtomCandidate[] {
  if (targets.length === 0) return atoms;
  const out = atoms.map((a) => ({ ...a }));
  targets.forEach((t, k) => {
    const rw = rewrites.find((r) => r.index === k + 1) ?? rewrites[k];
    if (rw && rw.title && rw.body) out[t.atomIndex] = { ...out[t.atomIndex], title: rw.title, body: rw.body };
  });
  return out;
}

/**
 * relift を 1 回の呼び出しにまとめる場合（MCP）。アプリの 2 パスのうち、
 * 1 パス目（全洞察を対象にする）と 2 パス目（式・略語の取りこぼしを名指しする）を 1 つにして、
 * 全洞察を対象にしつつ、コードが検出した式・略語を jargon として添える
 */
export function planReliftWithHints(atoms: AtomCandidate[]): ReliftTarget[] {
  return atoms.map((a, atomIndex) => ({ atomIndex, jargon: detectRung1Tokens(a.title, a.body) }));
}
