// 計算ブロック → 表への書き戻し
//
// 変数代入行（`w = 5 * table["配合表"]["比率"]`）の結果を、選んだ表の列へ
// 書き込む。式は calc 側に見えたまま、表には**値だけ**が入る（Excel の
// 計算列と違い、式がセルに隠れない）。
//
// 生きた同期: 元の列や式が変わるたびに書き戻し先も更新される。循環は
// 3 つのルールで防ぐ:
// 1. 書き戻せるのは変数代入行だけ（行の増減・並べ替えに強い、変数名で紐付け）
// 2. その calc が読んでいる列へは書けない（extractReadColumns で静的に抽出）
// 3. セルの現在値と同じなら書き込まない（updateBlock しない = 収束する）
//
// 実際の書き込みはホスト（実エディタを持つ note-app / SidePeek）が行う。
// ブロックの render に渡る editor.document は古くなるため（実測）、calc 自身が
// 表を読み書きすると他セルを巻き戻す事故になる。calc は「書きたい内容」を
// ストアに宣言するだけで、ホストが最新の表と突き合わせて差分だけ書く。

import { readCellText } from "../../features/table-meta/table-cells";

/** 書き戻し先。表は blockId で持つ（自動名「表 N」は表の増減でずれるため名前では持たない） */
export type CalcTarget = { tableBlockId: string; column: string };

/** 変数名 → 書き戻し先（calc の props.targets に JSON で保存する形） */
export type CalcTargets = Record<string, CalcTarget>;

/** calc 1 ブロックが宣言する書き込み内容 */
export type CalcWritebackRequest = {
  tableBlockId: string;
  column: string;
  /** データ行（2 行目以降）へ上から順に入れる文字列。行数より少ない分は空になる */
  texts: string[];
};

/** props.targets（JSON）を安全に読む。壊れていたら空 */
export function parseCalcTargets(raw: string): CalcTargets {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CalcTargets = {};
    for (const [name, t] of Object.entries(parsed as Record<string, unknown>)) {
      const target = t as Partial<CalcTarget> | null;
      if (target && typeof target.tableBlockId === "string" && typeof target.column === "string") {
        out[name] = { tableBlockId: target.tableBlockId, column: target.column };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 行が変数代入（`名前 = 式`）なら変数名を返す。mathjs の識別子は ASCII 限定 */
export function assignedVariableOf(line: string): string | null {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/);
  return m ? m[1] : null;
}

/**
 * 式が読んでいる (表名, 列名) を "表名 列名" の集合で返す。
 * 書き戻し先の候補からこの列を外す（自分が読む列へ書くと発振するため）。
 * 静的なパターン抽出なので、変数経由の間接参照（t = "表"; table[t]…）は
 * 拾えない — その場合も同値スキップで書き込み自体は止まるが、
 * 循環設定を UI の時点で防ぐのはこの範囲まで
 */
export function extractReadColumns(source: string): Set<string> {
  const reads = new Set<string>();
  for (const m of source.matchAll(/table\[\s*"([^"]+)"\s*\]\s*\[\s*"([^"]+)"\s*\]/g)) {
    reads.add(`${m[1]} ${m[2]}`);
  }
  for (const m of source.matchAll(/\bcol(?:umn)?\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)) {
    reads.add(`${m[1]} ${m[2]}`);
  }
  return reads;
}

/** セルの形式（tableCell / 旧 inline 配列）を保ったままテキストだけ差し替える */
function withCellText(cell: any, text: string): any {
  const content = text === "" ? [] : [{ type: "text", text, styles: {} }];
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return { ...cell, content };
  }
  return content;
}

/**
 * ストアに宣言された書き戻しを、いまの表に適用する。ホストが
 * onEditorContentChange（と宣言の変化）のたびに呼ぶ。差分が無ければ
 * 何もしないので、何度呼んでも安全（この冪等性が収束の要）。
 */
export function applyCalcWritebacks(
  editor: any,
  writebacks: Record<string, CalcWritebackRequest[]> | null | undefined,
): void {
  if (!editor || !writebacks) return;
  for (const requests of Object.values(writebacks)) {
    for (const req of requests) {
      const block = editor.getBlock?.(req.tableBlockId);
      if (!block || block.type !== "table") continue;
      const rows: any[] = block.content?.rows ?? [];
      if (rows.length < 2) continue;
      const headers: string[] = (rows[0].cells ?? []).map((c: any) => readCellText(c));
      const colIdx = headers.findIndex((h) => h.trim() === req.column);
      if (colIdx < 0) continue; // 列が改名・削除されたら書かない（設定は残り、列を戻せば再開する）
      let changed = false;
      const nextRows = rows.map((row, r) => {
        if (r === 0) return row;
        const want = (req.texts[r - 1] ?? "").trim();
        const cells: any[] = row.cells ?? [];
        if (colIdx >= cells.length) return row; // 形の崩れた行には触らない
        const current = readCellText(cells[colIdx]).trim();
        if (current === want) return row;
        changed = true;
        const nextCells = [...cells];
        nextCells[colIdx] = withCellText(cells[colIdx], want);
        return { ...row, cells: nextCells };
      });
      if (changed) {
        editor.updateBlock(req.tableBlockId, {
          content: { ...block.content, rows: nextRows },
        });
      }
    }
  }
}
