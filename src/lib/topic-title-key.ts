/**
 * トピックの題の名寄せキー（純関数。client / server / mcp のどこからも import できる）。
 *
 * 「生地の一次発酵」と「生地一次発酵」、「X」と「X（別名）」のように、人が見れば同じ題を
 * 機械的に同一視するための正規化。取り込み時の新規作成の抑止（runSourceTopicStage）と、
 * 機械の点検（detectLocalIssues）の両方がこの 1 か所を使う。
 *
 * 安全側に倒す: 包含（「加水率」と「バゲットの加水率」）や長音の有無
 * （「サーバー」と「サーバ」）は同じとみなさない。括弧が複数・末尾でないときは切り出さない。
 */

/** 末尾の括弧書き 1 つ（NFKC 後なので全角（）は半角 () になっている） */
const TRAILING_PAREN = /^([^()]*?)\s*\(([^()]*)\)\s*$/;

/** 1 つの文字列を比較用に正規化する（括弧の切り出しは済んでいる前提） */
function normalizePart(s: string): string {
  const compact = s
    .normalize("NFKC")
    .toLowerCase()
    // 空白・ハイフン／ダッシュ類・中黒・アンダースコアを除去（長音「ー」は消さない）
    .replace(/[\s\-‐‑‒–—―−・·_]/g, "");
  // 「の」は前後がどちらもひらがな以外のときだけ除去（「もの」「ののしる」の「の」は残す）
  return compact.replace(/(?<=[^ぁ-ゟ])の(?=[^ぁ-ゟ])/g, "");
}

export function topicTitleParts(title: string): { base: string; gloss: string | null } {
  const nfkc = title.normalize("NFKC");
  const m = TRAILING_PAREN.exec(nfkc);
  if (!m) return { base: normalizePart(nfkc), gloss: null };
  const gloss = normalizePart(m[2]);
  return { base: normalizePart(m[1]), gloss: gloss === "" ? null : gloss };
}

export function sameTopicTitle(a: string, b: string): boolean {
  const pa = topicTitleParts(a);
  const pb = topicTitleParts(b);
  if (pa.base === "" || pa.base !== pb.base) return false;
  return pa.gloss === null || pb.gloss === null || pa.gloss === pb.gloss;
}

/**
 * name と同じ題の既存を 1 件返す。無いとき、または曖昧なとき（別の括弧書きを持つ既存が
 * 2 種類以上あり、name に括弧書きが無い）は null。
 */
export function findSameTitleTopic<T extends { id: string; title: string }>(name: string, existing: T[]): T | null {
  const matches = existing.filter((e) => sameTopicTitle(name, e.title));
  if (matches.length === 0) return null;
  const nameGloss = topicTitleParts(name).gloss;
  if (nameGloss === null) {
    const glosses = new Set(matches.map((m) => topicTitleParts(m.title).gloss).filter((g): g is string => g !== null));
    if (glosses.size >= 2) return null;
    return matches[0];
  }
  return matches.find((m) => topicTitleParts(m.title).gloss === nameGloss) ?? matches[0];
}

/**
 * 同じ題の組を集める（2 件以上のグループだけ）。base ごとに束ね、その中で括弧書きごとに
 * クラスタを作る。括弧書き無しは、括弧書きの種類がちょうど 1 つならそこに合流、0 なら
 * 無し同士、2 つ以上なら無し同士だけで 1 クラスタ（別の概念の略語が同じものを混ぜない）。
 * 入力順を保つ。
 */
export function groupSameTitleTopics<T extends { title: string }>(items: T[]): T[][] {
  const byBase = new Map<string, { item: T; gloss: string | null }[]>();
  for (const item of items) {
    const { base, gloss } = topicTitleParts(item.title);
    if (base === "") continue;
    const list = byBase.get(base);
    if (list) list.push({ item, gloss });
    else byBase.set(base, [{ item, gloss }]);
  }
  const groups: T[][] = [];
  for (const list of byBase.values()) {
    if (list.length < 2) continue;
    const glossKinds = [...new Set(list.map((e) => e.gloss).filter((g): g is string => g !== null))];
    if (glossKinds.length === 1) {
      groups.push(list.map((e) => e.item));
      continue;
    }
    // 種類が 0 なら null 同士で 1 クラスタ、2 以上なら gloss ごと + null 同士
    const clusters = new Map<string | null, T[]>();
    for (const e of list) {
      const c = clusters.get(e.gloss);
      if (c) c.push(e.item);
      else clusters.set(e.gloss, [e.item]);
    }
    for (const c of clusters.values()) if (c.length >= 2) groups.push(c);
  }
  return groups;
}
