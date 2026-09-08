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

function cleanCell(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
  if (/<table[\s>]/i.test(html)) {
    const rows: string[][] = [];
    for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanCell(m[1]));
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length >= 2) return toTable(rows);
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
