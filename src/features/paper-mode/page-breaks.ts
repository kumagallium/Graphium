// 改ページの目安 — ページの始まりを決める純関数
//
// 印刷（pdf-export/print-note.ts の printNote）は、画面外に組んだ本文を Chromium が
// 紙の高さで区切る。区切る位置は、ブロックの上下と種類から次の決まりで決まる:
//   - 図の類（チャート・画像・数式・計算・段組み）: ページに収まる高さなら、ページをまたぐ
//     ときは丸ごと次のページへ（fitContentToPage の break-inside: avoid）
//   - 表: ページの半分以下ならまたがせない。それより大きい表は行の間で分かれ、
//     2 行以上に折り返したセルを持つ行は、セル内の行（孤立行 2 行）でも分かれる
//   - 見出し（h1〜h3）: 直後で改ページになるなら、見出しごと次のページへ（break-after: avoid）
//   - 段落・リストなど文字のブロック: 行の間で分かれる。孤立行・寡婦行は 2 行。両方を満たせない
//     3 行の塊は寡婦行を諦めて 2+1 行（実測。adjustSplit）
//   - ページより高い図: ページの頭から始まり、はみ出した分は次のページへ
// ここはそれを「測った寸法」から再現するだけで、DOM は触らない（測るのは measure-print-layout.ts）。
// 目安であり、Chromium の分割と数行ずれることがある。

/** 縦の区間（y は測る木の上端を 0 とした px） */
export type Span = { top: number; bottom: number };

/** 表の行。lines は一番行数の多いセルの文字の行（行の途中で分かれる位置の候補。1 行なら無しでよい） */
export type RowSpan = Span & { lines?: Span[] };

export type PageBlockKind = "text" | "heading" | "figure" | "table";

/**
 * 測ったブロック 1 つ。本文の並び順（入れ子の子は親の次）で並べる。
 * lines は文字の行（上下を隙間なく敷き詰めた区間）、rows は表の行（折り返したセルは行の中の行 lines も持つ）。
 * hidden は画面で畳まれていて寸法が無い（画面側の対応づけにだけ使う）。
 */
export type PageBlock = {
  id: string;
  kind: PageBlockKind;
  top: number;
  bottom: number;
  lines?: Span[];
  rows?: RowSpan[];
  /** 表の <table> 要素そのものの高さ（印刷の「小さい表」判定は table 要素の高さで行う。名前行・キャプションを含まない） */
  tableHeight?: number;
  /** 図の「またがせない部分」（img など）の下端。それより下（キャプション）は別に流れる。無ければ全体 */
  mediaBottom?: number;
  hidden?: boolean;
};

/**
 * ページの始まり。blockId のブロックの
 *   - line: その行から、row: その行から（表）、offset: ブロックの上端から offset px 下がった所から
 *   - row と line の両方: 表の row 行目の中の line 行目から（折り返したセルの途中）
 *   - どれも無い: ブロックの頭から
 * 次のページが始まる。
 */
export type PageBreak = {
  blockId: string;
  line?: number;
  row?: number;
  offset?: number;
  /** 図のキャプションの頭から（画面では画像の高さが印刷と違うので、offset でなく画像の下端に合わせる） */
  afterMedia?: boolean;
};

/** 孤立行・寡婦行の最小の行数（Chromium の既定） */
const ORPHANS = 2;
const WIDOWS = 2;
/** 寸法の誤差（Chromium は 1/64px 単位）。境目にぴったり収まる行を溢れ扱いにしない */
const EPS = 0.5;

/**
 * ブロックの並びから、各ページの始まり（2 ページ目以降）を決める。
 * pageHeight は 1 ページの本文の高さ（297mm - 余白 15mm × 2 = 267mm の px）。
 * 1 ページ目は測る木の上端（題名・日時・ラベル・罫線の見出し部分）から始まるので、
 * ブロックの位置にその高さが含まれていること。
 */
export function computePageBreaks(blocks: PageBlock[], pageHeight: number): PageBreak[] {
  const breaks: PageBreak[] = [];
  // これまでの繰り下げで本文が下がった量。ブロックの y にこれを足すと、印刷での y になる
  let shift = 0;
  // 今のページの上端（繰り下げ後の座標）
  let pageStart = 0;
  const pageEnd = () => pageStart + pageHeight;

  // 次のページを始める。originalTop（繰り下げ前の y）の所が次のページの頭に来るように下げる
  // （ページの頭に来た要素の上の余白は、印刷でも捨てられる）
  // topGap はページの頭に残る上の余白（見出しの margin-top は、ページの頭でも捨てられない。実測）
  const startNextPage = (anchor: PageBreak, originalTop: number, topGap = 0) => {
    pageStart += pageHeight;
    shift = pageStart + topGap - originalTop;
    breaks.push(anchor);
  };

  // ブロックの頭で改ページする。直前に見出しが続いていて、それが今のページの頭でないなら、
  // 見出しごと次のページへ送る（break-after: avoid）
  const breakBeforeBlock = (index: number) => {
    let first = index;
    while (
      first > 0 &&
      blocks[first - 1].kind === "heading" &&
      blocks[first - 1].top + shift > pageStart + EPS
    ) {
      first--;
    }
    const target = blocks[first];
    // 見出しは上の余白（直前のブロックとの間の隙間）をページの頭に持ち越す
    const prev = first > 0 ? blocks[first - 1] : undefined;
    const topGap = target.kind === "heading" && prev && !prev.hidden ? Math.max(0, target.top - prev.bottom) : 0;
    startNextPage({ blockId: target.id }, target.top, topGap);
  };

  blocks.forEach((block, index) => {
    switch (block.kind) {
      case "figure":
        placeUnit(block, index);
        break;
      case "table": {
        const rows = block.rows ?? [];
        // ページの半分以下の表は、図と同じく丸ごと（またがせない）
        const height = block.tableHeight ?? block.bottom - block.top;
        if (rows.length === 0 || height <= pageHeight / 2) placeUnit(block, index, pageHeight / 2);
        else placeRows(block, index, rows);
        break;
      }
      default:
        placeLines(block, index);
    }
  });

  return breaks;

  /**
   * またがせない塊（図・小さい表）。maxHeight より高ければ「高すぎる図」として扱う。
   * 画像のキャプションのように、またがせない部分（mediaBottom まで）のあとに続く部分は、
   * 収まらなければ単独で次のページの頭へ載る（印刷は img にだけ break-inside: avoid を付ける）。
   */
  function placeUnit(block: PageBlock, index: number, maxHeight = pageHeight) {
    const unitBottom = block.mediaBottom ?? block.bottom;
    placeUnitBody(block, index, unitBottom, maxHeight);
    if (
      block.mediaBottom !== undefined &&
      block.bottom - block.mediaBottom > EPS &&
      block.mediaBottom + shift <= pageEnd() + EPS &&
      block.bottom + shift > pageEnd() + EPS
    ) {
      startNextPage({ blockId: block.id, offset: block.mediaBottom - block.top, afterMedia: true }, block.mediaBottom);
    }
  }

  function placeUnitBody(block: PageBlock, index: number, unitBottom: number, maxHeight: number) {
    const height = unitBottom - block.top;
    // 余白のぶんだけ次のページの頭にずれ込む場合
    if (block.top + shift >= pageEnd() - EPS) {
      breakBeforeBlock(index);
    }
    if (unitBottom + shift <= pageEnd() + EPS) return;
    if (height <= maxHeight) {
      breakBeforeBlock(index);
      return;
    }
    // ページより高い塊: ページの頭から始めて、はみ出した分はページを送る
    if (block.top + shift > pageStart + EPS) breakBeforeBlock(index);
    while (unitBottom + shift > pageEnd() + EPS) {
      pageStart += pageHeight;
      breaks.push({ blockId: block.id, offset: pageStart - (block.top + shift) });
    }
  }

  /** 大きい表: 行の間で分かれる */
  function placeRows(block: PageBlock, index: number, rows: RowSpan[]) {
    if (block.top + shift >= pageEnd() - EPS) breakBeforeBlock(index);
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      // 今のページに載っている、この行の最初のセル内の行（0 = 行の頭から）
      let seg = 0;
      // 行の途中で分けるたびに繰り返す（1 つの行が複数ページにわたる場合）
      for (;;) {
        const segTop = seg === 0 ? row.top : (row.lines?.[seg].top ?? row.top);
        const overflow = row.bottom + shift > pageEnd() + EPS || segTop + shift >= pageEnd() - EPS;
        if (!overflow) break;
        const atPageTop = (j === 0 && seg === 0 ? block.top : segTop) + shift <= pageStart + EPS;
        if (atPageTop) {
          // ページより高い行: 分けようがないので、はみ出した分のページを送る
          while (row.bottom + shift > pageEnd() + EPS) {
            pageStart += pageHeight;
            breaks.push({ blockId: block.id, row: j, offset: pageStart - (row.top + shift) });
          }
          break;
        }
        // 折り返したセルを持つ行は、セル内の行（孤立行 2 行）でも分かれる
        const k = splitLineInRow(row, seg);
        if (k !== null) {
          startNextPage({ blockId: block.id, row: j, line: k }, row.lines![k].top);
          seg = k;
          continue;
        }
        if (seg > 0) break; // 続きの断片は動かせない（行の頭へは戻らない）
        if (j === 0) breakBeforeBlock(index);
        else startNextPage({ blockId: block.id, row: j }, row.top);
        break;
      }
    }
    // 最後の行のあとの表の下の余白（ブロックの下端との差）が今のページに収まらないときは、
    // 余白だけが次のページの頭に載り、続くブロックがその分（約 1 行）下がる
    const last = rows[rows.length - 1];
    if (block.bottom - last.bottom > EPS && last.bottom + shift <= pageEnd() + EPS && block.bottom + shift > pageEnd() + EPS) {
      startNextPage({ blockId: block.id, row: rows.length - 1, offset: last.bottom - last.top }, last.bottom);
    }
  }

  /**
   * 行 j から次のページへ送りたいブロック（n 行・今のページに載っている最初の行が seg）の、
   * 孤立行・寡婦行の決まりを通した分け目。寡婦行（残りが 2 行未満）は分け目を前へ動かすが、
   * それで孤立行を満たせなくなるときは、CSS の決まりどおり寡婦行を諦めて j のまま
   * （実測: 3 行の塊は 2+1 行で分かれ、4 行以上は 2+2 行などになる）。
   * 前のページに残る行が孤立行未満なら、ブロックごと次へ（seg）。
   */
  function adjustSplit(n: number, seg: number, j: number): number {
    let k = j;
    if (n - k < WIDOWS && n - WIDOWS - seg >= ORPHANS) k = n - WIDOWS;
    if (k - seg < ORPHANS) k = seg;
    return k;
  }

  /**
   * 行 row の seg 行目から始まる断片を、今のページの下端で分ける位置（セル内の行の番号）。
   * 孤立行を満たせない・分ける行が無いときは null（= 行ごと次のページへ）。
   */
  function splitLineInRow(row: RowSpan, seg: number): number | null {
    const lines = row.lines;
    if (!lines || lines.length < 2) return null;
    let k = seg;
    while (
      k < lines.length &&
      !(lines[k].bottom + shift > pageEnd() + EPS || lines[k].top + shift >= pageEnd() - EPS)
    ) {
      k++;
    }
    if (k >= lines.length) return null;
    k = adjustSplit(lines.length, seg, k);
    return k > seg ? k : null;
  }

  /** 文字のブロック: 行の間で分かれる（孤立行・寡婦行は 2 行） */
  function placeLines(block: PageBlock, index: number) {
    const lines = block.lines && block.lines.length > 0 ? block.lines : [{ top: block.top, bottom: block.bottom }];
    const n = lines.length;
    // 今のページに載っている、このブロックの最初の行
    let seg = 0;
    let j = 0;
    while (j < n) {
      const line = lines[j];
      const overflow = line.bottom + shift > pageEnd() + EPS || line.top + shift >= pageEnd() - EPS;
      if (!overflow) {
        j++;
        continue;
      }
      // 行 j からが次のページ。寡婦行・孤立行の決まりに合わせて分け目を動かす
      let k = adjustSplit(n, seg, j);
      // ページの頭から始まっている断片は、これ以上頭へ戻せない。溢れた行で分ける
      if (k <= seg && lines[seg].top + shift <= pageStart + EPS) k = Math.max(j, seg + 1);
      if (k >= n) break;
      if (k === 0) breakBeforeBlock(index);
      else startNextPage({ blockId: block.id, line: k }, lines[k].top);
      seg = k;
      j = k;
    }
  }
}

// ── 画面の位置への写し ──

/** 画面に引く線 1 本（y は用紙の目印の上端から、page は次のページの番号） */
export type GuideLine = { top: number; page: number };

/**
 * 印刷側で決めたページの始まりを、画面の同じブロックの同じ行に対応させて y を返す。
 * 線は「その行の上端と前の行の下端の間」に引く（行は隙間なく敷き詰めてあるので行の上端）。
 * ブロックの頭は、前のブロックの下端との真ん中。行数が合わないときは近い行に寄せる。
 * 畳まれたブロック（hidden）の中で改ページになるときは、畳んである見出し（直前の見えるブロック）の下に出す。
 * 対応するブロックが画面に無いものは出さない。
 */
export function placeBreaksOnScreen(screenBlocks: PageBlock[], breaks: PageBreak[]): GuideLine[] {
  const indexById = new Map<string, number>();
  screenBlocks.forEach((b, i) => indexById.set(b.id, i));

  // 直前の見えるブロックの下端
  const prevBottom = (index: number): number | null => {
    for (let i = index - 1; i >= 0; i--) {
      if (!screenBlocks[i].hidden) return screenBlocks[i].bottom;
    }
    return null;
  };

  const out: GuideLine[] = [];
  breaks.forEach((br, i) => {
    const index = indexById.get(br.blockId);
    if (index === undefined) return;
    const block = screenBlocks[index];
    const page = i + 2;
    if (block.hidden) {
      const y = prevBottom(index);
      if (y !== null) out.push({ top: y, page });
      return;
    }
    const gapMid = () => {
      const prev = prevBottom(index);
      return prev === null ? block.top : (prev + block.top) / 2;
    };
    if (br.afterMedia && block.mediaBottom !== undefined) {
      // 図のキャプションの頭（画像の下端）
      out.push({ top: block.mediaBottom, page });
    } else if (br.offset !== undefined) {
      // 高すぎる塊の途中
      const rows = br.row !== undefined ? block.rows : undefined;
      const base = rows && rows.length > 0 ? rows[Math.min(br.row ?? 0, rows.length - 1)].top : block.top;
      out.push({ top: base + br.offset, page });
    } else if (br.row !== undefined && br.line !== undefined && block.rows && block.rows.length > 0) {
      // 表の行の途中（セル内の行）。画面にセル内の行が無いときは行の上端
      const r = block.rows[Math.min(br.row, block.rows.length - 1)];
      const cellLines = r.lines;
      out.push({
        top: cellLines && cellLines.length > 0 ? cellLines[Math.min(br.line, cellLines.length - 1)].top : r.top,
        page,
      });
    } else if (br.row !== undefined && block.rows && block.rows.length > 0) {
      const row = Math.min(br.row, block.rows.length - 1);
      out.push({ top: row === 0 ? gapMid() : block.rows[row].top, page });
    } else if (br.line !== undefined && block.lines && block.lines.length > 0) {
      const line = Math.min(br.line, block.lines.length - 1);
      out.push({ top: line === 0 ? gapMid() : block.lines[line].top, page });
    } else {
      out.push({ top: gapMid(), page });
    }
  });
  return out;
}
