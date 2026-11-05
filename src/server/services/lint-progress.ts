// 点検（POST /lint）の窓ごとの進み具合。
//
// /lint は 1 回の要求の中で、ナレッジを窓（LINT_INPUT_BUDGET_TOKENS ごと）に分けて順に送り、
// 全部終わるまで返事をしない。大きなナレッジでは 1 窓 30〜60 秒 × 数窓かかり、画面は
// 「点検しています…」のまま数分回る（2026-11-05、2,316 ページで 4 窓・約 3 分）。
// そこで、クライアントが progressId を添えて要求し、走っている間は GET /lint/progress/:id で
// 「何窓目まで済んだか」を見られるようにする。サーバーの記憶だけで、ファイルには書かない。
// 要求が終わっても消さず、一定時間で忘れる（最後の問い合わせが終了直後に来ても答えられるように）。

export type LintProgress = { done: number; total: number };

/** 進み具合を覚えておく時間。これを過ぎたものは次の書き込み・読み出しで忘れる */
export const LINT_PROGRESS_TTL_MS = 10 * 60_000;

const entries = new Map<string, LintProgress & { updatedAt: number }>();

/** progressId として受け付ける形（クライアントが作る UUID 程度。長い文字列や記号は弾く） */
export function isLintProgressId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function setLintProgress(id: string, progress: LintProgress, now: number = Date.now()): void {
  prune(now);
  entries.set(id, { done: progress.done, total: progress.total, updatedAt: now });
}

export function getLintProgress(id: string, now: number = Date.now()): LintProgress | undefined {
  const entry = entries.get(id);
  if (!entry) return undefined;
  if (now - entry.updatedAt > LINT_PROGRESS_TTL_MS) {
    entries.delete(id);
    return undefined;
  }
  return { done: entry.done, total: entry.total };
}

function prune(now: number): void {
  for (const [id, entry] of entries) {
    if (now - entry.updatedAt > LINT_PROGRESS_TTL_MS) entries.delete(id);
  }
}

/** テスト用: 全部忘れる */
export function clearLintProgressForTest(): void {
  entries.clear();
}
