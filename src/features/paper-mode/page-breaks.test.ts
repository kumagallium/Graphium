// 改ページの目安の純関数。1 ページ = 1000px の仮の寸法で、各ブロックの種類ごとの決まりを確かめる。

import { describe, expect, it } from "vitest";
import { computePageBreaks, placeBreaksOnScreen, type PageBlock } from "./page-breaks";

const H = 1000;
const LINE = 20;

/** 20px の行が n 行の文字のブロック（top から隙間なく） */
function text(id: string, top: number, n: number, kind: "text" | "heading" = "text"): PageBlock {
  const lines = Array.from({ length: n }, (_, i) => ({ top: top + i * LINE, bottom: top + (i + 1) * LINE }));
  return { id, kind, top, bottom: top + n * LINE, lines };
}
function figure(id: string, top: number, height: number): PageBlock {
  return { id, kind: "figure", top, bottom: top + height };
}
/** 1 行 rowH の表（rows 行） */
function table(id: string, top: number, rows: number, rowH: number): PageBlock {
  const rs = Array.from({ length: rows }, (_, i) => ({ top: top + i * rowH, bottom: top + (i + 1) * rowH }));
  return { id, kind: "table", top, bottom: top + rows * rowH, rows: rs };
}

describe("computePageBreaks", () => {
  it("1 ページに収まるなら線は無い", () => {
    expect(computePageBreaks([text("a", 0, 20)], H)).toEqual([]);
  });

  it("1 ページ目は見出し部分（題名・日時・罫線）の高さから始まる", () => {
    // 見出し部分が 200px。本文は 200 から。1 ページ目に載るのは (1000 - 200) / 20 = 40 行
    expect(computePageBreaks([text("a", 200, 50)], H)).toEqual([{ blockId: "a", line: 40 }]);
    // 見出し部分が無ければ 50 行目から
    expect(computePageBreaks([text("a", 0, 80)], H)).toEqual([{ blockId: "a", line: 50 }]);
  });

  it("文字のブロックは行の間で分かれ、次のページの先頭に下がった分が続きの位置になる", () => {
    // 2 ページ目は 50 行目から。120 行は 50 + 50 + 20 行 → 3 ページ目が 100 行目から
    expect(computePageBreaks([text("a", 0, 120)], H)).toEqual([
      { blockId: "a", line: 50 },
      { blockId: "a", line: 100 },
    ]);
  });

  it("図はページをまたぐなら次のページの頭へ", () => {
    const blocks = [text("a", 0, 45), figure("fig", 900, 200), text("b", 1100, 5)];
    expect(computePageBreaks(blocks, H)).toEqual([{ blockId: "fig" }]);
  });

  it("図が収まるなら動かさない", () => {
    expect(computePageBreaks([text("a", 0, 40), figure("fig", 800, 200)], H)).toEqual([]);
  });

  it("図が下がると続きのブロックも下がり、次のページの線がその分ずれる", () => {
    // 図は 900 → 1000 へ 100px 下がる。続きの b（元 1100〜、100 行 = 2000px）は
    // 1200 から始まり、3 ページ目は元の座標で 2000 - 100 = 1900 のあたり（b の 40 行目）
    const blocks = [text("a", 0, 45), figure("fig", 900, 200), text("b", 1100, 100)];
    const breaks = computePageBreaks(blocks, H);
    expect(breaks[0]).toEqual({ blockId: "fig" });
    // 2 ページ目は 1000〜2000。図 200px のあと b の 40 行（800px）が載り、41 行目からが 3 ページ目
    expect(breaks[1]).toEqual({ blockId: "b", line: 40 });
  });

  it("ページの半分以下の表はまたがせない", () => {
    expect(computePageBreaks([text("a", 0, 40), table("t", 800, 4, 100)], H)).toEqual([{ blockId: "t" }]);
  });

  it("ページの半分より大きい表は行の間で分かれる", () => {
    // 100px の行が 15 行 = 1500px。10 行目から 2 ページ目
    expect(computePageBreaks([table("t", 0, 15, 100)], H)).toEqual([{ blockId: "t", row: 10 }]);
  });

  it("大きい表が途中から始まるときは、収まらない行から分かれる", () => {
    // 表は 500 から。500〜1000 に 5 行（行 0〜4）、行 5 から 2 ページ目
    expect(computePageBreaks([table("t", 500, 10, 100)], H)).toEqual([{ blockId: "t", row: 5 }]);
  });

  it("見出しの直後で改ページになるなら、見出しごと次のページへ", () => {
    // 見出しが 960〜1000 に収まり、直後の段落が 1000 から。見出しだけが前のページに残らない
    const blocks = [text("a", 0, 48), text("h", 960, 2, "heading"), text("p", 1000, 5)];
    expect(computePageBreaks(blocks, H)).toEqual([{ blockId: "h" }]);
  });

  it("見出しが続いていれば、続きの見出しもまとめて次のページへ", () => {
    const blocks = [
      text("a", 0, 44),
      text("h1", 880, 2, "heading"),
      text("h2", 920, 2, "heading"),
      text("p", 960, 5),
    ];
    // 段落 p は 960〜1060。2 行目までは前のページに入るが、3 行目からは入らない。
    // p は 5 行で、1000 までに 2 行しか載らない → 分け目は 2 行目の後（行 2）で孤立行の決まりを満たす
    expect(computePageBreaks(blocks, H)).toEqual([{ blockId: "p", line: 2 }]);
    // 段落の 1 行目も入らないとき（見出しが 960〜1000 にあり段落が 1000〜）は見出しごと
    const blocks2 = [
      text("a", 0, 40),
      text("h1", 800, 5, "heading"),
      text("h2", 900, 5, "heading"),
      text("p", 1000, 5),
    ];
    expect(computePageBreaks(blocks2, H)).toEqual([{ blockId: "h1" }]);
  });

  it("ページの頭にある見出しは、さらに前へ戻さない", () => {
    // 1 ページ目の先頭が見出しで、直後が収まらない図。見出しを動かしても同じなので、図だけが次へ
    const blocks = [text("h", 0, 2, "heading"), figure("fig", 40, 990)];
    expect(computePageBreaks(blocks, H)).toEqual([{ blockId: "fig" }]);
  });

  it("孤立行: 前のページに 1 行しか残らないなら、ブロックごと次へ", () => {
    // 4 行のブロックが 980 から。1 行だけ前のページに載る → 孤立行（2 行未満）なので全部次へ
    expect(computePageBreaks([text("a", 0, 49), text("b", 980, 4)], H)).toEqual([{ blockId: "b" }]);
  });

  it("寡婦行: 次のページに 1 行しか行かないなら、前のページから 1 行連れていく", () => {
    // 10 行のブロックが 820 から。9 行入るが、残り 1 行（寡婦行）を避けて 8 行で分ける
    expect(computePageBreaks([text("a", 0, 41), text("b", 820, 10)], H)).toEqual([{ blockId: "b", line: 8 }]);
  });

  it("3 行のブロックは孤立行と寡婦行を両方満たせないので、ブロックごと次へ", () => {
    expect(computePageBreaks([text("a", 0, 48), text("b", 960, 3)], H)).toEqual([{ blockId: "b" }]);
  });

  it("ページより高い図はそのページの頭から始まり、はみ出した分は次のページへ", () => {
    const blocks = [text("a", 0, 5), figure("fig", 100, 2500)];
    expect(computePageBreaks(blocks, H)).toEqual([
      { blockId: "fig" },
      { blockId: "fig", offset: 1000 },
      { blockId: "fig", offset: 2000 },
    ]);
  });

  it("ページの頭にある高すぎる図は、頭へ送らずそのまま始める", () => {
    expect(computePageBreaks([figure("fig", 0, 1500)], H)).toEqual([{ blockId: "fig", offset: 1000 }]);
  });
});

describe("placeBreaksOnScreen", () => {
  // 画面の側（余白や行の高さは印刷と同じとは限らない）
  const screen: PageBlock[] = [
    text("a", 0, 10),
    { ...text("h", 210, 2, "heading") },
    figure("fig", 260, 100),
    { id: "hid", kind: "text", top: 0, bottom: 0, hidden: true },
    text("b", 400, 5),
    table("t", 520, 4, 30),
  ];

  it("行の境目（行の上端）に線を引く", () => {
    const lines = placeBreaksOnScreen(screen, [{ blockId: "a", line: 4 }]);
    expect(lines).toEqual([{ top: 80, page: 2 }]);
  });

  it("ブロックの頭は、前のブロックの下端との真ん中", () => {
    // a の下端は 200、h の上端は 210
    expect(placeBreaksOnScreen(screen, [{ blockId: "h" }])).toEqual([{ top: 205, page: 2 }]);
  });

  it("番号は 2 から振る", () => {
    const lines = placeBreaksOnScreen(screen, [{ blockId: "a", line: 2 }, { blockId: "b", line: 3 }]);
    expect(lines.map((l) => l.page)).toEqual([2, 3]);
  });

  it("行数が合わないときは近い行（最後の行）に寄せる", () => {
    const lines = placeBreaksOnScreen(screen, [{ blockId: "a", line: 99 }]);
    expect(lines).toEqual([{ top: 180, page: 2 }]);
  });

  it("表は行の上端", () => {
    expect(placeBreaksOnScreen(screen, [{ blockId: "t", row: 2 }])).toEqual([{ top: 580, page: 2 }]);
  });

  it("畳まれたブロックの中で改ページになるときは、直前の見えるブロックの下端", () => {
    expect(placeBreaksOnScreen(screen, [{ blockId: "hid" }])).toEqual([{ top: 360, page: 2 }]);
  });

  it("画面に無いブロックは出さない（番号は印刷側の順のまま）", () => {
    const lines = placeBreaksOnScreen(screen, [{ blockId: "gone" }, { blockId: "b", line: 2 }]);
    expect(lines).toEqual([{ top: 440, page: 3 }]);
  });

  it("高すぎる図の途中は、ブロックの上端からの距離", () => {
    expect(placeBreaksOnScreen(screen, [{ blockId: "fig", offset: 50 }])).toEqual([{ top: 310, page: 2 }]);
  });
});
