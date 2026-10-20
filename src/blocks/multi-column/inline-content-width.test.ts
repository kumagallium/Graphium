// 段組みのドロップ領域（左右 1/3 ずつ）は、ブロックの「中身」の左右端を基準に取る
// （drop-to-columns.ts の contentEdges）。段落・見出し・リストの中身は .bn-inline-content で、
// これが本文欄の幅いっぱいでないと、文字の長さが基準になって
// 「右の領域が文字の終わりから行末まで広がり、左の領域はほぼ消える」。
//
// BlockNote 0.47 までは本家の CSS が width: 100% を当てていたが、0.48〜0.52 のどこかで外れた。
// Graphium は app.css で当て直している。jsdom ではレイアウトを測れないので、規則があることを見張る。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("文字欄の幅（段組みのドロップ領域の基準）", () => {
  it("app.css が .bn-editor .bn-inline-content に width: 100% を当てている", () => {
    const css = readFileSync(resolve(__dirname, "../../app.css"), "utf8");
    const rule = /\.bn-editor \.bn-inline-content\s*\{([^}]*)\}/.exec(css);
    expect(rule, ".bn-editor .bn-inline-content の規則が無い").not.toBeNull();
    expect(rule![1]).toMatch(/width:\s*100%/);
  });
});
