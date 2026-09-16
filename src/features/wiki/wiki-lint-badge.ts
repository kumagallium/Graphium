// 点検（Lint）結果の「見てほしいことがある」印
//
// 背景: 点検は取り込み後・起動時（前回から 24h 経過時）に自動実行されるが、
// contradiction / gap を最大 3 件トーストに出すだけで、orphan / stale / redundant は
// 点検画面（WikiLintView）を自分で開かないと分からない。ユーザーは自発的に開かないので
// 手当ての要る項目が黙って溜まる。ここでは「最後の点検が何か見つけていて、まだ
// 点検画面を開いていない」ときだけ立つ印の判定と、リロードをまたぐ永続化を持つ。
//
// 永続化の置き場: settings/store.ts（localStorage）に寄せる。wikiLog は IndexedDB で
// 非同期取得が必須になり、サイドバー描画のたびに待たせるのは重い。この印に必要なのは
// 「件数 / 最重要 severity / 時刻」という薄い要約だけで、レポート本体（issues 全文）は
// 保存しない。settings/store.ts の LLM_MODELS_KEY と同じ「専用キー + get/set 関数」の
// 形を踏襲し、新しい保存の仕組みは作らない。

const BADGE_STORAGE_KEY = "graphium-wiki-lint-badge";

/** 最後に点検が見つけた「手当ての要る」件数の要約（レポート本体は持たない） */
export type LintBadgeSummary = {
  /** 点検の実行時刻（LintReport.analyzedAt） */
  lastLintAt: string;
  /** 自動アーカイブ済みを除いた issues の件数 */
  needsAttentionCount: number;
  /** issues に severity: "error" が 1 件以上含まれるか */
  hasError: boolean;
};

/** localStorage に保存する内部形（要約 + 最後に点検画面を開いた時刻） */
type LintBadgeState = {
  summary: LintBadgeSummary | null;
  /** 点検画面（WikiLintView）を最後に開いた時刻（ISO） */
  lastOpenedAt: string | null;
};

const EMPTY_STATE: LintBadgeState = { summary: null, lastOpenedAt: null };

function loadState(): LintBadgeState {
  try {
    const raw = localStorage.getItem(BADGE_STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<LintBadgeState>;
    const summary =
      parsed.summary &&
      typeof parsed.summary.lastLintAt === "string" &&
      typeof parsed.summary.needsAttentionCount === "number"
        ? {
            lastLintAt: parsed.summary.lastLintAt,
            needsAttentionCount: parsed.summary.needsAttentionCount,
            hasError: parsed.summary.hasError === true,
          }
        : null;
    return {
      summary,
      lastOpenedAt: typeof parsed.lastOpenedAt === "string" ? parsed.lastOpenedAt : null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

function saveState(state: LintBadgeState): void {
  localStorage.setItem(BADGE_STORAGE_KEY, JSON.stringify(state));
}

/** 点検完了後に呼ぶ。要約だけを保存し、開いた時刻はそのまま残す（新しく見つかれば印が立つ） */
export function saveLintBadgeSummary(summary: LintBadgeSummary): void {
  const prev = loadState();
  saveState({ summary, lastOpenedAt: prev.lastOpenedAt });
}

/** 点検画面（WikiLintView）を開いたときに呼ぶ。印を消す */
export function markLintOpened(openedAt: string = new Date().toISOString()): void {
  const prev = loadState();
  saveState({ summary: prev.summary, lastOpenedAt: openedAt });
}

/** 現在保存されている要約と最後に開いた時刻を取得する（バッジ表示用） */
export function getLintBadgeState(): { summary: LintBadgeSummary | null; lastOpenedAt: string | null } {
  return loadState();
}

/**
 * 印を出すべきかどうかを判定する純関数。
 * - summary が無い、または件数が 0 なら出さない（段階的開示）
 * - 点検画面を一度も開いていなければ出す
 * - 最後の点検時刻が最後に開いた時刻より新しければ出す（開いた後に新しく見つかった分だけ）
 */
export function shouldShowLintBadge(
  summary: LintBadgeSummary | null,
  lastOpenedAt: string | null,
): boolean {
  if (!summary) return false;
  if (summary.needsAttentionCount <= 0) return false;
  if (!lastOpenedAt) return true;
  const lintTime = new Date(summary.lastLintAt).getTime();
  const openedTime = new Date(lastOpenedAt).getTime();
  if (Number.isNaN(lintTime) || Number.isNaN(openedTime)) return true;
  return lintTime > openedTime;
}
