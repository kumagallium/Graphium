// 来歴スタックビューの純データモデル。
// 起点から下へ段を縦に積む表示で使う型と、段の開閉・手順差分の純関数。

export type StackNodeKind = "proc" | "plan" | "text" | "knowledge" | "asset" | "root";

/** inputFrom: 他ノートから受け取った材料の説明文 */
export type StackStep = { name: string; inputFrom?: string };

/** 札・段の「開く」先。無ければ開くボタンを出さない */
export type StackOpenTarget =
  | { type: "note"; navId: string } // 通常ノートは素の id、知識は "wiki:<id>"（lineage-builder の navId と同じ規則）
  | { type: "media"; fileId: string } // pdf / document
  | { type: "url"; url: string }
  | { type: "memo"; captureId: string };

/** 箱（見出し／表名／関係種別） */
export type StackGroup = {
  key: string;
  label: string;
  children: string[];
  /** 上限で省いた件数（「他 N 件」表示用） */
  more?: number;
  /**
   * 上限で省いた札の名前だけの一覧（「他 N 件」を押したときに出す）。中身は作っていないので、
   * 開くときは経路として builder に頼んで作らせる（focusPath）
   */
  hidden?: { id: string; title: string; kind: StackNodeKind }[];
};

export type StackNode = {
  id: string;
  title: string;
  kind: StackNodeKind;
  /** 今開いているノート（「ここ」バッジ） */
  isCurrent?: boolean;
  /** 「開く」先。無ければ開くボタンを出さない */
  open?: StackOpenTarget;
  /** 子を持つのに上限で展開しなかった（「派生なし」と区別する） */
  truncated?: boolean;
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
