// フォルダツリー（noteContexts の階層表示）のモデル。
//
// 「フォルダ」はサイドバーでの見せ方であり、実体は noteContexts の文脈ラベルそのもの
// （design.md 決定事項 2026-08-31）。`親/子` のスラッシュ記法を 2 階層の木として解釈する。
// - 階層は 2 段まで: 最初の "/" だけを区切りとして扱い、2 個目以降は子の名前の一部にする
//   （既存タグに "A/B/C" があっても壊さない — 「A」の子「B/C」として表示するだけ）
// - 空フォルダ（ノート 0 件・appdata 由来の定義リスト）をマージして表示できる
// - 並びは名前昇順。件数順にしないのは、エクスプローラーの「フォルダは名前順」という
//   メンタルモデルに合わせるため（文脈タグのサジェスト＝件数順とは目的が違う）

export type FolderNode = {
  /** 表示名（パスの末尾セグメント） */
  name: string;
  /** noteContexts に入る実際の値（"親" または "親/子"） */
  path: string;
  /** このフォルダ直下のノート数（タグがちょうど path のもの） */
  directCount: number;
  /** 直下 + 子の合計（サイドバーの件数表示に使う） */
  totalCount: number;
  /** 子フォルダ（2 階層制約により、子はさらに子を持たない） */
  children: FolderNode[];
};

/**
 * "親/子" を最初の "/" で分割する。"/" が無い・分割すると空になる場合は parent = null。
 */
export function splitFolderPath(value: string): { parent: string | null; leaf: string } {
  const trimmed = value.trim();
  const i = trimmed.indexOf("/");
  if (i < 0) return { parent: null, leaf: trimmed };
  const parent = trimmed.slice(0, i).trim();
  const leaf = trimmed.slice(i + 1).trim();
  if (!parent || !leaf) return { parent: null, leaf: trimmed };
  return { parent, leaf };
}

/**
 * フォルダ名として作成してよいかを検査する（インライン新規作成の入力に使う）。
 * - 空・空白のみ → empty
 * - 区切りを除いたセグメントが空（"A/" "/B" "A//B"） → invalid
 * - "/" が 2 個以上 = 3 階層以上 → tooDeep（2 階層制約）
 */
export function validateFolderPath(value: string): "ok" | "empty" | "invalid" | "tooDeep" {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  const segments = trimmed.split("/");
  if (segments.some((s) => !s.trim())) return "invalid";
  if (segments.length > 2) return "tooDeep";
  return "ok";
}

type MutableNode = {
  name: string;
  path: string;
  directCount: number;
  children: Map<string, { name: string; leaf: string; count: number }>;
  /** 親が単独タグとして実在したか（表示名の優先度: 単独タグの表記 > 子から見えた親表記） */
  seenAsSelf: boolean;
};

/**
 * 使用中の文脈ラベル集計（aggregateNoteContexts の出力）と空フォルダ定義から
 * 2 階層のフォルダツリーを組み立てる。
 * 親名は小文字比較で名寄せする（"ProjectA/x" と "projecta" は同じ親）。
 */
export function buildFolderTree(
  used: readonly { value: string; count: number }[],
  emptyFolders: readonly string[] = [],
): FolderNode[] {
  const roots = new Map<string, MutableNode>();

  const ensureRoot = (name: string): MutableNode => {
    const key = name.toLowerCase();
    let node = roots.get(key);
    if (!node) {
      node = { name, path: name, directCount: 0, children: new Map(), seenAsSelf: false };
      roots.set(key, node);
    }
    return node;
  };

  const add = (rawValue: string, count: number): void => {
    const value = rawValue.trim();
    if (!value) return;
    const { parent, leaf } = splitFolderPath(value);
    if (parent === null) {
      const node = ensureRoot(leaf);
      // 単独タグとして見えた表記を表示名として優先する
      if (!node.seenAsSelf) {
        node.name = leaf;
        node.path = leaf;
        node.seenAsSelf = true;
      }
      node.directCount += count;
      return;
    }
    const node = ensureRoot(parent);
    const childKey = leaf.toLowerCase();
    const child = node.children.get(childKey);
    if (child) {
      child.count += count;
    } else {
      node.children.set(childKey, { name: leaf, leaf, count });
    }
  };

  for (const { value, count } of used) add(value, count);
  // 空フォルダは件数 0 として同じ経路でマージする（既存フォルダと小文字名寄せで重複しない）
  for (const path of emptyFolders) add(path, 0);

  const sortByName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, "ja");

  const result: FolderNode[] = [];
  for (const node of roots.values()) {
    const children: FolderNode[] = [...node.children.values()]
      .map((c) => ({
        name: c.name,
        path: `${node.path}/${c.leaf}`,
        directCount: c.count,
        totalCount: c.count,
        children: [] as FolderNode[],
      }))
      .sort(sortByName);
    const childTotal = children.reduce((sum, c) => sum + c.totalCount, 0);
    result.push({
      name: node.name,
      path: node.path,
      directCount: node.directCount,
      totalCount: node.directCount + childTotal,
      children,
    });
  }
  result.sort(sortByName);
  return result;
}
