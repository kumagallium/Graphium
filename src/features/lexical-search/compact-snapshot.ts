// 語彙インデックスの保存形（詰めた形）
//
// MiniSearch 標準の保存形（toJSON / loadJS）は、postings を
// `{ "<文書の内部 id>": 出現数 }` という素のオブジェクトで持つ。数万チャンクの索引では
// これが数百万プロパティになり、復元のたびに
//   1. その素のオブジェクトを丸ごと展開し、
//   2. Object.keys で内部 id を文字列として数百万個つくり、
//   3. 語を 1 つずつ radix tree に入れ直す（挿入のたびにノードのキーを走査する）
// ので、使い捨ての割り当てが GB 単位で出る。WKWebView（JavaScriptCore）は一度広げた
// ヒープをなかなか OS に返さないため、起動するだけで画面のメモリが数 GB になっていた
// （3.9 万チャンクの実測: 復元だけで 0.6 GB → 約 4 GB）。
//
// ここでは索引の中身を型付き配列と文字列の配列に詰める。
// - postings は Uint32Array 2 本（内部 id と出現数）
// - 語の木（radix tree）は形そのものを前順で書き出し、復元では挿入し直さずに
//   ノードの Map を直接組み立てる
// 構造化複製（IndexedDB）は型付き配列をバイト列のまま運ぶので、保存も復元も軽い。
//
// MiniSearch の内部（_index._tree など）に触るので、minisearch の版は package.json で
// 固定している。版を上げるときは compact-snapshot.test.ts の往復テストで確かめること。
// 形が想定と違えば toCompact / fromCompact は例外を投げ、呼び出し側は
// 「保存しない」「空から作り直す」に倒れる（検索結果を黙って壊さない）。

import MiniSearch, { type Options } from "minisearch";

/** radix tree の葉を表すキー（MiniSearch の SearchableMap と同じ） */
const LEAF = "";
/** fieldLength に値が無い（そのフィールドを持たない文書）ことを表す番兵 */
const NO_LENGTH = 0xffffffff;
/** 復元中、これだけ postings を組み立てるごとに 1 回譲る（起動時に画面を固めない） */
const YIELD_EVERY_POSTINGS = 200_000;

export const COMPACT_VERSION = 1;

export type CompactIndex = {
  compactVersion: number;
  documentCount: number;
  nextId: number;
  fieldIds: Record<string, number>;
  averageFieldLength: number[];
  dirtCount: number;
  /** 文書の内部 id（MiniSearch の shortId）。ids / stored / fieldLengths と同じ並び */
  shortIds: Uint32Array;
  /** 文書 id（`${kind}:${sourceId}:${chunkId}`） */
  ids: string[];
  /** 文書 × フィールドの語数（値が無いところは NO_LENGTH） */
  fieldLengths: Uint32Array;
  /** storeFields の中身（無ければ null） */
  stored: (Record<string, unknown> | null)[];
  /** radix tree を前順でたどったときの、各ノードの子の数 */
  nodeChildCounts: Uint32Array;
  /** 同じ前順で並べた、子へのキー（"" は葉 = その語の postings） */
  edgeKeys: string[];
  /** 語（葉の出現順）× フィールドの postings 件数。0xffffffff はそのフィールドの Map 自体が無い */
  termFieldCounts: Uint32Array;
  /** postings: 文書の内部 id */
  postIds: Uint32Array;
  /** postings: 出現数 */
  postTfs: Uint32Array;
};

type PostingMap = Map<number, number>;
type FieldIndex = Map<number, PostingMap>;
type TreeNode = Map<string, TreeNode | FieldIndex>;

/** MiniSearch の内部のうち、ここで読み書きするもの */
type MiniSearchInternals = {
  _index: { _tree: TreeNode; _size: number | undefined };
  _documentCount: number;
  _documentIds: Map<number, string>;
  _idToShortId: Map<string, number>;
  _fieldIds: Record<string, number>;
  _fieldLength: Map<number, (number | undefined)[]>;
  _avgFieldLength: number[];
  _nextId: number;
  _storedFields: Map<number, Record<string, unknown>>;
  _dirtCount: number;
};

function internals(ms: MiniSearch<any>): MiniSearchInternals {
  const m = ms as unknown as MiniSearchInternals;
  if (
    !(m._index?._tree instanceof Map) ||
    !(m._documentIds instanceof Map) ||
    !(m._idToShortId instanceof Map) ||
    !(m._fieldLength instanceof Map) ||
    !(m._storedFields instanceof Map) ||
    typeof m._fieldIds !== "object" ||
    typeof m._nextId !== "number"
  ) {
    throw new Error("lexical index: MiniSearch の内部構造が想定と違う");
  }
  return m;
}

/** 索引を詰めた形にする（同期。索引は書き換えない） */
export function toCompact(ms: MiniSearch<any>): CompactIndex {
  const m = internals(ms);
  const fieldCount = Object.keys(m._fieldIds).length;

  // 1 周目: 大きさを数える（型付き配列を 1 回で確保するため）
  let nodeCount = 0;
  let edgeCount = 0;
  let termCount = 0;
  let postingCount = 0;
  const count = (node: TreeNode): void => {
    nodeCount++;
    for (const [key, value] of node) {
      edgeCount++;
      if (key === LEAF) {
        termCount++;
        for (const postings of (value as FieldIndex).values()) postingCount += postings.size;
      } else {
        count(value as TreeNode);
      }
    }
  };
  count(m._index._tree);

  const nodeChildCounts = new Uint32Array(nodeCount);
  const edgeKeys = new Array<string>(edgeCount);
  const termFieldCounts = new Uint32Array(termCount * fieldCount).fill(NO_LENGTH);
  const postIds = new Uint32Array(postingCount);
  const postTfs = new Uint32Array(postingCount);

  // 2 周目: 前順で書き出す
  let ni = 0;
  let ei = 0;
  let ti = 0;
  let pi = 0;
  const write = (node: TreeNode): void => {
    nodeChildCounts[ni++] = node.size;
    for (const [key, value] of node) {
      edgeKeys[ei++] = key;
      if (key !== LEAF) {
        write(value as TreeNode);
        continue;
      }
      // フィールド id の昇順で書く。Map の並びは「その語が先にどのフィールドに出たか」で
      // 決まるので（本文に先に出た語は 1, 0 の順）、並びのまま書くと、id の昇順で読む
      // 復元側で title と text の postings が入れ替わる
      const fieldIndex = value as FieldIndex;
      let written = 0;
      for (let fieldId = 0; fieldId < fieldCount; fieldId++) {
        const postings = fieldIndex.get(fieldId);
        if (!postings) continue;
        written++;
        termFieldCounts[ti * fieldCount + fieldId] = postings.size;
        for (const [shortId, tf] of postings) {
          postIds[pi] = shortId;
          postTfs[pi] = tf;
          pi++;
        }
      }
      if (written !== fieldIndex.size) throw new Error("lexical index: 未知のフィールド id");
      ti++;
    }
  };
  write(m._index._tree);

  const docCount = m._documentIds.size;
  const shortIds = new Uint32Array(docCount);
  const ids = new Array<string>(docCount);
  const fieldLengths = new Uint32Array(docCount * fieldCount).fill(NO_LENGTH);
  const stored = new Array<Record<string, unknown> | null>(docCount);
  let di = 0;
  for (const [shortId, id] of m._documentIds) {
    shortIds[di] = shortId;
    ids[di] = id;
    const lengths = m._fieldLength.get(shortId);
    if (lengths) {
      for (let f = 0; f < fieldCount; f++) {
        const n = lengths[f];
        if (typeof n === "number") fieldLengths[di * fieldCount + f] = n;
      }
    }
    stored[di] = m._storedFields.get(shortId) ?? null;
    di++;
  }

  return {
    compactVersion: COMPACT_VERSION,
    documentCount: m._documentCount,
    nextId: m._nextId,
    fieldIds: { ...m._fieldIds },
    averageFieldLength: [...m._avgFieldLength],
    dirtCount: m._dirtCount,
    shortIds,
    ids,
    fieldLengths,
    stored,
    nodeChildCounts,
    edgeKeys,
    termFieldCounts,
    postIds,
    postTfs,
  };
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 詰めた形として読めるか（壊れた・別の版の保存を弾く） */
function isCompactIndex(c: unknown): c is CompactIndex {
  const x = c as CompactIndex | null | undefined;
  return (
    !!x &&
    x.compactVersion === COMPACT_VERSION &&
    x.shortIds instanceof Uint32Array &&
    x.fieldLengths instanceof Uint32Array &&
    x.nodeChildCounts instanceof Uint32Array &&
    x.termFieldCounts instanceof Uint32Array &&
    x.postIds instanceof Uint32Array &&
    x.postTfs instanceof Uint32Array &&
    Array.isArray(x.ids) &&
    Array.isArray(x.stored) &&
    Array.isArray(x.edgeKeys) &&
    Array.isArray(x.averageFieldLength) &&
    Number.isInteger(x.documentCount) &&
    Number.isInteger(x.nextId) &&
    !!x.fieldIds &&
    typeof x.fieldIds === "object"
  );
}

/**
 * 詰めた形から索引を組み立てる。形が合わなければ例外。
 * 途中で譲る（await）が、組み立て中の索引はまだ誰にも渡っていないので割り込まれない。
 */
export async function fromCompact<T>(compact: unknown, options: Options<T>): Promise<MiniSearch<T>> {
  if (!isCompactIndex(compact)) throw new Error("lexical index: 保存形が読めない");
  const c = compact;
  const ms = new MiniSearch<T>(options);
  const m = internals(ms);

  // 索引と復元でフィールドの並びが同じであること（違えば postings の対応がずれる）
  const expected = m._fieldIds;
  const fieldNames = Object.keys(expected);
  const fieldCount = fieldNames.length;
  if (Object.keys(c.fieldIds).length !== fieldCount || fieldNames.some((f) => c.fieldIds[f] !== expected[f])) {
    throw new Error("lexical index: フィールドの構成が保存時と違う");
  }

  const docCount = c.shortIds.length;
  if (c.ids.length !== docCount || c.stored.length !== docCount || c.fieldLengths.length !== docCount * fieldCount) {
    throw new Error("lexical index: 文書の配列の長さが合わない");
  }
  // 件数と採番が文書の一覧と合っていること。合わないまま使うと、スコアが NaN になったり、
  // 次に足す文書が既存の内部 id を上書きしたりする
  if (c.documentCount !== docCount) throw new Error("lexical index: 文書数が合わない");
  if (c.averageFieldLength.length > fieldCount || c.averageFieldLength.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    throw new Error("lexical index: 平均の語数が読めない");
  }
  for (let d = 0; d < docCount; d++) {
    const shortId = c.shortIds[d];
    const id = c.ids[d];
    if (typeof id !== "string" || shortId >= c.nextId || m._documentIds.has(shortId)) {
      throw new Error("lexical index: 文書の内部 id が読めない");
    }
    m._documentIds.set(shortId, id);
    m._idToShortId.set(id, shortId);
    const lengths: (number | undefined)[] = [];
    for (let f = 0; f < fieldCount; f++) {
      const n = c.fieldLengths[d * fieldCount + f];
      if (n !== NO_LENGTH) lengths[f] = n;
    }
    m._fieldLength.set(shortId, lengths);
    const stored = c.stored[d];
    if (stored) m._storedFields.set(shortId, stored);
  }

  // radix tree を前順のまま組み立てる（語を挿入し直さない）
  const counts = c.nodeChildCounts;
  if (counts.length === 0) throw new Error("lexical index: 語の木が空");
  const root: TreeNode = new Map();
  const nodeStack: TreeNode[] = [root];
  const remainingStack: number[] = [counts[0]];
  let ni = 1;
  let ei = 0;
  let ti = 0;
  let pi = 0;
  let sinceYield = 0;
  const termCount = c.termFieldCounts.length / fieldCount;
  while (nodeStack.length > 0) {
    const top = nodeStack.length - 1;
    if (remainingStack[top] === 0) {
      nodeStack.pop();
      remainingStack.pop();
      continue;
    }
    remainingStack[top]--;
    if (ei >= c.edgeKeys.length) throw new Error("lexical index: 語の木のキーが足りない");
    const key = c.edgeKeys[ei++];
    if (key !== LEAF) {
      if (ni >= counts.length) throw new Error("lexical index: 語の木のノードが足りない");
      const child: TreeNode = new Map();
      nodeStack[top].set(key, child);
      nodeStack.push(child);
      remainingStack.push(counts[ni++]);
      continue;
    }
    if (ti >= termCount) throw new Error("lexical index: 語の数が合わない");
    const fieldIndex: FieldIndex = new Map();
    for (let f = 0; f < fieldCount; f++) {
      const n = c.termFieldCounts[ti * fieldCount + f];
      if (n === NO_LENGTH) continue;
      if (pi + n > c.postIds.length) throw new Error("lexical index: postings が足りない");
      const postings: PostingMap = new Map();
      for (let k = 0; k < n; k++) {
        postings.set(c.postIds[pi], c.postTfs[pi]);
        pi++;
      }
      fieldIndex.set(f, postings);
      sinceYield += n;
    }
    nodeStack[top].set(LEAF, fieldIndex);
    ti++;
    if (sinceYield >= YIELD_EVERY_POSTINGS) {
      sinceYield = 0;
      await yieldToUi();
    }
  }
  if (ni !== counts.length || ei !== c.edgeKeys.length || ti !== termCount || pi !== c.postIds.length || c.postTfs.length !== c.postIds.length) {
    throw new Error("lexical index: 保存形の長さが合わない");
  }

  m._index._tree = root;
  m._index._size = undefined;
  m._documentCount = c.documentCount;
  m._nextId = c.nextId;
  m._avgFieldLength = [...c.averageFieldLength];
  m._dirtCount = c.dirtCount || 0;
  return ms;
}

/**
 * 語ごとの「その語を含む生きた文書の数」を数える（設定画面の語彙一覧用）。
 * toJSON() を経由すると索引全体の写しができるので、内部の Map を直接たどる
 */
export function termDocumentFrequencies(ms: MiniSearch<any>): { term: string; df: number }[] {
  const m = internals(ms);
  const out: { term: string; df: number }[] = [];
  const seen = new Set<number>();
  const walk = (node: TreeNode, prefix: string): void => {
    for (const [key, value] of node) {
      if (key !== LEAF) {
        walk(value as TreeNode, prefix + key);
        continue;
      }
      seen.clear();
      for (const postings of (value as FieldIndex).values()) {
        for (const shortId of postings.keys()) if (m._documentIds.has(shortId)) seen.add(shortId);
      }
      if (seen.size > 0) out.push({ term: prefix, df: seen.size });
    }
  };
  walk(m._index._tree, "");
  return out;
}
