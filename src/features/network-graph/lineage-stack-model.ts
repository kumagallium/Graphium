// 来歴スタックビューの純データモデル。
// 起点から下へ段を縦に積む表示で使う型と、段の開閉・手順差分の純関数。

export type StackNodeKind = "proc" | "plan" | "text" | "knowledge" | "asset" | "root";

/** inputFrom: 他ノートから受け取った材料の説明文 */
export type StackStep = { name: string; inputFrom?: string };

/** 箱（見出し／表名／関係種別） */
export type StackGroup = { key: string; label: string; children: string[] };

export type StackNode = {
  id: string;
  title: string;
  kind: StackNodeKind;
  /** 今開いているノート（「ここ」バッジ） */
  isCurrent?: boolean;
  /** この段の中の箱 */
  groups: StackGroup[];
  /** 箱の中の札どうしの受け渡し（同じ段の children 同士） */
  links: { from: string; to: string }[];
  /** proc: 手順の鎖 */
  steps?: StackStep[];
  /** proc: 出力 */
  outputs?: string[];
  /** text / knowledge / asset: 本文の冒頭・説明 */
  body?: string;
  /** knowledge: 出典名 */
  sources?: string[];
};

export type LineageStackModel = {
  nodes: Record<string, StackNode>;
  rootId: string;
  /** 初期の開き方（root から現在ノートまでの id 列。先頭は rootId） */
  initialPath: string[];
};

export type StepDiff = { omitted: string[]; added: string[] };

/** 親の手順名集合と子の手順名集合の差。どちらかが steps を持たなければ null */
export function diffSteps(parent: StackNode, child: StackNode): StepDiff | null {
  if (!parent.steps || !child.steps) return null;
  const p = new Set(parent.steps.map((s) => s.name));
  const c = new Set(child.steps.map((s) => s.name));
  // 共通の手順が 1 つも無ければ「再現・改変」の関係ではない（計画 → 工程など）。
  // 差分を出しても全部が省略・追加になり意味を持たないので比較しない
  if (![...p].some((n) => c.has(n))) return null;
  return {
    omitted: parent.steps.map((s) => s.name).filter((n) => !c.has(n)),
    added: child.steps.map((s) => s.name).filter((n) => !p.has(n)),
  };
}

/**
 * 段 levelIndex（path[levelIndex] のノード）で札 childId をクリックしたときの次の path。
 * すでに path[levelIndex+1] === childId なら閉じる（path を levelIndex+1 で切る）。
 * それ以外は path を levelIndex+1 で切って childId を足す。
 */
export function nextPath(path: string[], levelIndex: number, childId: string): string[] {
  const head = path.slice(0, levelIndex + 1);
  if (path[levelIndex + 1] === childId) return head;
  return [...head, childId];
}
