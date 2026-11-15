// 貼り付けた内容が「表」かどうかを見る
//
// Excel / スプレッドシート / 別ノートの表をコピーすると、クリップボードには
// text/html（<table>）と text/plain（タブ区切り）が入る。BlockNote はこれを
// そのまま本文の表にするので、行が多いと取り込みと同じ「固まる量」が貼り付けから
// 入ってしまう。ここでは表かどうかと行数を判定して TSV に揃えるだけで、どう扱うかは
// 呼び出し側（note-app が取り込みダイアログへ回す）が決める。
//
// カンマ区切りの素のテキストは表とみなさない。文章にもカンマは普通に入るので、
// 誤爆で普通の貼り付けを取り込みダイアログに奪うほうが痛い。

export type PastedTable = {
  /** 見出し行を含む行数 */
  rows: number;
  cols: number;
  /** 取り込みダイアログに渡すタブ区切りテキスト */
  tsv: string;
};

const CELL_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

// 他のページの作者が中身を決められる HTML を走査するので、入力の大きさと行・セル数に上限を置く。
// タグの走査は indexOf で `>` までを 1 回ずつ進める線形の形にする（属性がどれだけ長くても、
// 閉じない `<` が並んでも 2 次にならない）。上限を超えたら表として扱わず null を返す。
const MAX_HTML_LENGTH = 20_000_000; // Excel の大きな表（約 2 万セル）も表として読めるよう 20MB まで。行・セルの上限は別に守る
const MAX_ROWS = 20_000;
const MAX_CELLS_PER_ROW = 2_000;

/** タグ名（小文字）。`<` の位置 i から読む。タグでなければ null。close は閉じタグか */
function readTagName(src: string, i: number): { name: string; close: boolean } | null {
  let j = i + 1;
  const close = src.charCodeAt(j) === 47; // "/"
  if (close) j++;
  let k = j;
  while (k < j + 10 && k < src.length) {
    const c = src.charCodeAt(k) | 32; // 小文字化（英字のみ見る）
    if (c < 97 || c > 122) break;
    k++;
  }
  if (k === j) return null;
  return { name: src.slice(j, k).toLowerCase(), close };
}

/**
 * open〜close の組の内側を順に返す（線形走査）。限度を超えて組があれば overflow を立てる。
 * names は該当するタグ名の一覧。
 */
function innerSections(
  src: string,
  names: string[],
  limit: number,
): { sections: string[]; overflow: boolean } {
  const out: string[] = [];
  let innerStart = -1;
  let i = src.indexOf("<");
  let gt = -1;
  while (i >= 0) {
    // `>` の位置は使い回す（`<` が連続しても毎回末尾まで探さない）
    if (gt <= i) gt = src.indexOf(">", i + 1);
    if (gt < 0) break; // これ以降に `>` は無い
    const tag = readTagName(src, i);
    if (!tag) {
      // タグでない `<`（文中の不等号など）は 1 文字だけ進める
      i = src.indexOf("<", i + 1);
      continue;
    }
    if (names.includes(tag.name)) {
      if (!tag.close) {
        if (innerStart < 0) innerStart = gt + 1;
      } else if (innerStart >= 0) {
        if (out.length >= limit) return { sections: out, overflow: true };
        out.push(src.slice(innerStart, i));
        innerStart = -1;
      }
    }
    // 開きタグは `>` の直後まで読み飛ばす。`<` が連続していても `>` を越えて進むので線形
    i = src.indexOf("<", gt + 1);
  }
  return { sections: out, overflow: false };
}

function cleanCell(raw: string): string {
  // <br> は空白に。残りのタグは `>` までを 1 回の走査で除去する（長さに上限は置かない）
  const t = raw.replace(/<br\s*\/?>/gi, " ");
  let stripped = "";
  let pos = 0;
  for (;;) {
    const lt = t.indexOf("<", pos);
    if (lt < 0) break;
    const gt = t.indexOf(">", lt + 1);
    if (gt < 0) break;
    stripped += t.slice(pos, lt);
    // `<>` は従来どおりタグとみなさず残す
    stripped += gt === lt + 1 ? "<>" : "";
    pos = gt + 1;
  }
  stripped += t.slice(pos);
  // エンティティは 1 パスでデコード（`&amp;lt;` を `<` に二重デコードしない）
  return stripped
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (m) => CELL_ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function toTable(rows: string[][]): PastedTable {
  const cols = Math.max(...rows.map((r) => r.length));
  const tsv = rows.map((r) => r.map((c) => c.replace(/\t/g, " ")).join("\t")).join("\n");
  return { rows: rows.length, cols, tsv };
}

/** クリップボードの中身が表なら行数と TSV を返す。表でなければ null */
export function detectPastedTable(clipboard: {
  text?: string | null;
  html?: string | null;
}): PastedTable | null {
  const html = clipboard.html ?? "";
  if (html.length <= MAX_HTML_LENGTH && /<table[\s>]/i.test(html)) {
    const rows: string[][] = [];
    let tooBig = false;
    const trs = innerSections(html, ["tr"], MAX_ROWS);
    if (trs.overflow) tooBig = true;
    for (const tr of trs.sections) {
      const cs = innerSections(tr, ["td", "th"], MAX_CELLS_PER_ROW);
      if (cs.overflow) tooBig = true;
      const cells = cs.sections.map(cleanCell);
      if (cells.length > 0) rows.push(cells);
    }
    // 上限を超える表は途中で切らず、ここでは表として読まない（text/plain か既存の貼り付けに任せる）
    if (!tooBig && rows.length >= 2) return toTable(rows);
  }
  const text = (clipboard.text ?? "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length >= 2) {
    // 過半の行にタブがあればタブ区切りの表とみなす（Excel / Sheets の text/plain）
    const tabbed = lines.filter((l) => l.includes("\t")).length;
    if (tabbed * 2 > lines.length) return toTable(lines.map((l) => l.split("\t")));
  }
  return null;
}
