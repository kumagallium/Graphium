import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeTableBleed, CONTENT_COLUMN_WIDTH, EDITOR_GUTTER, EXTEND_BUTTON_ROOM } from "./wide-table-bleed";

// 右パディング 24px では「＋」ボタンの逃げ場（52px）に足りない分だけ張り出しを削る
const BUTTON_CUT_AT_24 = EXTEND_BUTTON_ROOM - 24;

describe("computeTableBleed", () => {
  it("中央寄せで余った片側 + ハンドル溝ぶんだけ張り出す", () => {
    // 1512px ウィンドウ・右パネル open のときのペイン幅
    const bleed = computeTableBleed({ paneWidth: 1007, padLeft: 24, padRight: 24, fullWidth: false });
    // avail = 959, 余白 = (959 - 828) / 2 = 65.5, + 54 = 120 から「＋」ボタンぶんを引く
    expect(bleed).toBe(120 - BUTTON_CUT_AT_24);
  });

  it("ラベルバッジで右パディングが広がると、その分は食わない", () => {
    const withLabels = computeTableBleed({ paneWidth: 1007, padLeft: 24, padRight: 80, fullWidth: false });
    // avail = 903, 余白 = (903 - 828) / 2 = 37.5, + 54。右パディング 80px は
    // 「＋」ボタンの逃げ場（52px）を満たすので、ボタンぶんの削りは無い
    expect(withLabels).toBe(Math.round((903 - CONTENT_COLUMN_WIDTH) / 2) + EDITOR_GUTTER);
  });

  it("ペインが本文カラムより狭ければ、ハンドル溝ぶんだけになる", () => {
    const bleed = computeTableBleed({ paneWidth: 600, padLeft: 16, padRight: 80, fullWidth: false });
    expect(bleed).toBe(EDITOR_GUTTER);
  });

  it("fullWidth では中央寄せの余白が無いので、ハンドル溝ぶんだけになる", () => {
    const bleed = computeTableBleed({ paneWidth: 1600, padLeft: 24, padRight: 80, fullWidth: true });
    expect(bleed).toBe(EDITOR_GUTTER);
  });

  it("ペイン幅が広いほど張り出せるが、常に有限で非負", () => {
    const narrow = computeTableBleed({ paneWidth: 900, padLeft: 24, padRight: 24, fullWidth: false });
    const wide = computeTableBleed({ paneWidth: 1400, padLeft: 24, padRight: 24, fullWidth: false });
    expect(narrow).toBeGreaterThanOrEqual(0);
    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBe(Math.round((1400 - 48 - CONTENT_COLUMN_WIDTH) / 2) + EDITOR_GUTTER - BUTTON_CUT_AT_24);
  });

  it("本文枠が狭いときは詰めた右の溝（24px）ぶんだけ張り出す", () => {
    // 詰めた溝より外（枠の右の余白 24px）へは張り出さない。右パディング 80px なら「＋」の削りも無い
    const bleed = computeTableBleed({ paneWidth: 464, padLeft: 24, padRight: 80, fullWidth: false, gutter: 24 });
    expect(bleed).toBe(24);
  });

  it("右パディングに「＋」ボタンが収まらないぶんだけ削り、0 を下回らない", () => {
    // 詰めた溝 24px の枠 + 右パディング 24px: 削りが溝を上回るので 0
    expect(
      computeTableBleed({ paneWidth: 408, padLeft: 24, padRight: 24, fullWidth: false, gutter: 24 }),
    ).toBe(0);
  });

  it("gutter を省くと既定の 54px（広い枠は今までと同じ）", () => {
    const base = { paneWidth: 1007, padLeft: 24, padRight: 24, fullWidth: false };
    expect(computeTableBleed(base)).toBe(computeTableBleed({ ...base, gutter: EDITOR_GUTTER }));
  });

  it("寸法が取れない初期描画では 0（張り出さない）", () => {
    expect(computeTableBleed({ paneWidth: 0, padLeft: 24, padRight: 24, fullWidth: false })).toBe(0);
    expect(computeTableBleed({ paneWidth: NaN, padLeft: 24, padRight: 24, fullWidth: false })).toBe(0);
  });
});

// 枠を持つ入れ物（カラム・step のカード）の中では、張り出しを CSS で止めている。
// 止め忘れると表が枠を突き抜ける（右パネルを開いた 1280px 幅で step の枠を 23px 越える）。
// jsdom は :has() を含む cascade を計算できないので、規則の本文を文字列で守る。
describe("app.css: 入れ物の中では表を張り出させない", () => {
  const css = readFileSync(resolve(__dirname, "../../app.css"), "utf8");

  /** セレクタ行から始まる規則の本文（最初の { から最初の } まで）を、同名の規則すべてについて取る */
  function ruleBodies(selector: string): string[] {
    const bodies: string[] = [];
    let from = 0;
    for (;;) {
      const start = css.indexOf(`${selector} {`, from);
      if (start < 0) break;
      const open = css.indexOf("{", start);
      const close = css.indexOf("}", open);
      bodies.push(css.slice(open + 1, close));
      from = close;
    }
    expect(bodies.length, `${selector} の規則が app.css に無い`).toBeGreaterThan(0);
    return bodies;
  }
  const zeroBleed = /--gph-table-bleed:\s*0px\s*;/;

  it("step のカードの中で --gph-table-bleed を 0 にしている", () => {
    const bodies = ruleBodies(".bn-editor .bn-block:has(> .react-renderer.node-step)");
    expect(bodies.some((b) => zeroBleed.test(b))).toBe(true);
  });

  it("マルチカラムの中でも --gph-table-bleed を 0 にしている（先例）", () => {
    expect(ruleBodies(".gph-column").some((b) => zeroBleed.test(b))).toBe(true);
  });
});
