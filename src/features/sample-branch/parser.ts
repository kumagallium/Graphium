// ──────────────────────────────────────────────
// 試料テーブル解析
//
// [試料] ラベルが付いたテーブルブロックを解析し、
// 1列目を試料ID、2列目以降を試料固有条件として抽出する。
// thought-provenance-spec.md § 0-D に準拠
// ──────────────────────────────────────────────

/** 試料テーブルから抽出された1行分のデータ */
export type SampleRow = {
  /** 試料ID（1列目、完全一致・大文字小文字区別） */
  sampleId: string;
  /** 列名 → 値 のマップ（2列目以降） */
  params: Record<string, string>;
};

/** 試料テーブル解析結果 */
export type SampleTable = {
  /** 元のブロックID */
  blockId: string;
  /** 列ヘッダー（1列目 = 試料ID列名、2列目以降 = パラメータ列名） */
  headers: string[];
  /** 各行の試料データ */
  rows: SampleRow[];
};

/**
 * BlockNoteのテーブルブロックJSONから試料テーブルを解析する
 *
 * テーブル構造:
 *   content.rows[0] = ヘッダー行
 *   content.rows[1..] = データ行
 *   各 row.cells = セル配列、各セルは InlineContent[] の配列
 */
export function parseSampleTable(block: any): SampleTable | null {
  if (block.type !== "table") return null;

  const rows = block.content?.rows;
  if (!rows || rows.length < 2) return null; // ヘッダー + 最低1行必要

  // ヘッダー行からカラム名を抽出
  const headerRow = rows[0];
  const headers = headerRow.cells.map((cell: any[]) => extractCellText(cell));

  // データ行を解析
  const dataRows: SampleRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].cells;
    const sampleId = extractCellText(cells[0]);
    if (!sampleId) continue; // 空のIDは無視

    const params: Record<string, string> = {};
    for (let j = 1; j < cells.length && j < headers.length; j++) {
      const value = extractCellText(cells[j]);
      if (value) {
        params[headers[j]] = value;
      }
    }

    dataRows.push({ sampleId, params });
  }

  return {
    blockId: block.id,
    headers,
    rows: dataRows,
  };
}

/**
 * セルからテキストを抽出
 *
 * BlockNote のセル形式は2通り:
 *   テスト用: [{ type: "text", text: "..." }]（配列）
 *   エディタ出力: { type: "tableCell", content: [{ type: "text", text: "..." }], props: {...} }（オブジェクト）
 */
function extractCellText(cell: any): string {
  // BlockNote エディタ出力形式: { type: "tableCell", content: [...] }
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return extractInlineText(cell.content ?? []);
  }
  // テスト用・旧形式: [{ type: "text", text: "..." }]
  if (Array.isArray(cell)) {
    return extractInlineText(cell);
  }
  return "";
}

/** InlineContent 配列からテキストを結合 */
function extractInlineText(inlines: any[]): string {
  if (!Array.isArray(inlines)) return "";
  return inlines
    .map((inline: any) => {
      if (typeof inline === "string") return inline;
      if (inline.type === "text") return inline.text ?? "";
      return "";
    })
    .join("")
    .trim();
}

/**
 * 試料IDの照合（完全一致、大文字小文字区別）
 */
export function matchSampleId(id1: string, id2: string): boolean {
  return id1 === id2;
}

/**
 * 2つのテーブルの試料IDを照合し、不一致を報告する
 */
export function validateSampleIds(
  sampleTable: SampleTable,
  resultTable: SampleTable,
): { matched: string[]; unmatched: string[] } {
  const sampleIds = new Set(sampleTable.rows.map((r) => r.sampleId));
  const resultIds = resultTable.rows.map((r) => r.sampleId);

  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const id of resultIds) {
    if (sampleIds.has(id)) {
      matched.push(id);
    } else {
      unmatched.push(id);
    }
  }

  return { matched, unmatched };
}
