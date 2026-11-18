// blocks-to-docx.ts / export-docx.ts の描画テスト
// (a) fflate で docx（zip）を開いて XML を確かめる
// (b) mammoth（Word 文書の読み込み）に読ませ、Word として読めることを確かめる

import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import mammoth from "mammoth";
import { defaultBlockSpecs } from "@blocknote/core";
import { buildNoteDocxBlob, type DocxImage } from "./export-docx";
import { RENDERED_BLOCK_TYPES, cleanXmlText } from "./blocks-to-docx";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const para = (t: string, extra: Record<string, unknown> = {}) => ({
  type: "paragraph", props: {}, content: [text(t)], children: [], ...extra,
});

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const pngImage = (width = 200, height = 100): DocxImage => ({
  data: Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0)),
  type: "png", width, height,
});

type Opts = Parameters<typeof buildNoteDocxBlob>[0];
async function build(blocks: unknown, extra: Partial<Opts> = {}) {
  const blob = await buildNoteDocxBlob({ title: "題", blocks, ...extra });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const files = unzipSync(buf);
  return { files, xml: strFromU8(files["word/document.xml"]), buf };
}
async function html(buf: Uint8Array): Promise<string> {
  // node 環境の mammoth は buffer を受ける
  const r = await mammoth.convertToHtml({ buffer: Buffer.from(buf) });
  return r.value;
}

describe("構造（fflate）", () => {
  it("題は Title、プロパティは題と Graphium、A4 縦・余白 1 インチ", async () => {
    const { files, xml } = await build([para("本文")], { title: "ノートの題" });
    expect(xml).toContain("Title");
    expect(xml).toContain("ノートの題");
    expect(xml).toContain('w:w="11906"');
    expect(xml).toContain('w:top="1440"');
    const core = strFromU8(files["docProps/core.xml"]);
    expect(core).toContain("ノートの題");
    expect(core).toContain("Graphium");
    const styles = strFromU8(files["word/styles.xml"]);
    expect(styles).toContain("Yu Gothic");
  });

  it("題が空なら Title 段落を入れない", async () => {
    const { xml } = await build([para("本文")], { title: "" });
    expect(xml).not.toContain('w:val="Title"');
  });

  it("画像は word/media に入り、横幅は 601px に収まる", async () => {
    const { files, xml } = await build(
      [{ type: "image", props: { url: "u", name: "a.png" }, children: [] }],
      { loadMedia: async () => pngImage(2000, 1000) },
    );
    expect(Object.keys(files).some((k) => k.startsWith("word/media/"))).toBe(true);
    const cx = Number(/<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)![1]);
    expect(cx).toBe(601 * 9525);
  });

  it("previewWidth があればそれを使い、caption が直後に出る", async () => {
    const { xml } = await build(
      [{ type: "image", props: { url: "u", name: "a.png", previewWidth: 300, caption: "図の説明" }, children: [] }],
      { loadMedia: async () => pngImage(2000, 1000) },
    );
    expect(xml).toContain(`cx="${300 * 9525}"`);
    expect(xml.indexOf("図の説明")).toBeGreaterThan(xml.indexOf("<w:drawing>"));
  });

  it("画像が取れなければ差し込み文字（外部 URL はリンク付き）", async () => {
    const { xml, files } = await build([
      { type: "image", props: { url: "https://example.com/a.png", name: "a.png" }, children: [] },
      { type: "video", props: { url: "https://example.com/v.mp4", name: "v.mp4" }, children: [] },
      { type: "file", props: { url: "media:abc", name: "f.pdf" }, children: [] },
    ]);
    expect(xml).toContain("a.png");
    expect(xml).toContain("v.mp4");
    expect(xml).toContain("f.pdf");
    const rels = strFromU8(files["word/_rels/document.xml.rels"]);
    expect(rels).toContain("https://example.com/a.png");
    expect(rels).toContain("https://example.com/v.mp4");
    expect(rels).not.toContain("media:abc");
  });

  it("docxChart は画像が取れれば画像、取れなければ fallback", async () => {
    const chart = [{ id: "ch1", type: "chart", props: { config: "{}" }, children: [] }];
    const withImg = await build(chart, { captureBlockImage: async (id) => (id === "ch1" ? pngImage() : null) });
    expect(Object.keys(withImg.files).some((k) => k.startsWith("word/media/"))).toBe(true);
    const without = await build(chart, { captureBlockImage: async () => null });
    expect(Object.keys(without.files).some((k) => k.startsWith("word/media/"))).toBe(false);
  });

  it("captureBlockImage が例外でも fallback に落ちる", async () => {
    const { files } = await build([{ id: "c", type: "chart", props: {}, children: [] }], {
      captureBlockImage: async () => { throw new Error("x"); },
    });
    expect(Object.keys(files).some((k) => k.startsWith("word/media/"))).toBe(false);
  });

  it("番号つきリストは並びごとに numbering が分かれ、props.start から始まる", async () => {
    const li = (t: string, props: Record<string, unknown> = {}) => ({ type: "numberedListItem", props, content: [text(t)], children: [] });
    const { files, xml } = await build([li("a"), li("b"), para("区切り"), li("c", { start: 5 })]);
    const numbering = strFromU8(files["word/numbering.xml"]);
    expect(numbering).toContain('<w:start w:val="5"/>');
    const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(numIds).size).toBe(2);
  });

  it("textColor は 16 進の色になり、リンクは http のみ ExternalHyperlink", async () => {
    const { xml, files } = await build([
      { type: "paragraph", props: {}, children: [], content: [
        text("赤", { textColor: "red", backgroundColor: "yellow" }),
        { type: "link", href: "https://example.com", content: [text("外")] },
        { type: "link", href: "#note/abc", content: [text("内")] },
      ] },
    ]);
    expect(xml).toContain('w:val="e03e3e"');
    expect(xml).toContain('w:fill="fbf3db"');
    expect(xml).toContain("内");
    const rels = strFromU8(files["word/_rels/document.xml.rels"]);
    expect(rels).toContain("https://example.com");
    expect(rels).not.toContain("#note/abc");
  });
});

describe("Word として読める（mammoth）", () => {
  it("見出し・箇条書き・番号・リンク・強調・上付き下付き・画像", async () => {
    const { buf } = await build(
      [
        { type: "heading", props: { level: 1 }, content: [text("大見出し")], children: [] },
        { type: "bulletListItem", props: {}, content: [text("点")], children: [
          { type: "bulletListItem", props: {}, content: [text("入れ子")], children: [] },
        ] },
        { type: "numberedListItem", props: {}, content: [text("番号")], children: [] },
        { type: "paragraph", props: {}, children: [], content: [
          text("太", { bold: true }), text("斜", { italic: true }), text("2", { superscript: true }), text("i", { subscript: true }),
          { type: "link", href: "https://example.com/x", content: [text("リンク")] },
          { type: "inlineImage", props: { fileId: "f", name: "n", width: 40 } },
        ] },
      ],
      { loadInlineImage: async () => pngImage(40, 40) },
    );
    const h = await html(buf);
    expect(h).toContain("<h1>大見出し</h1>");
    expect(h).toMatch(/<ul>[\s\S]*点[\s\S]*<ul>[\s\S]*入れ子/);
    expect(h).toMatch(/<ol>[\s\S]*番号/);
    expect(h).toContain("<strong>太</strong>");
    expect(h).toContain("<em>斜</em>");
    expect(h).toContain("<sup>2</sup>");
    expect(h).toContain("<sub>i</sub>");
    expect(h).toContain('href="https://example.com/x"');
    expect(h).toContain("<img");
  });

  it("表: colspan / rowspan・見出し行・不揃いな行", async () => {
    const cell = (t: string, props: Record<string, unknown> = {}) => ({ type: "tableCell", props, content: [text(t)] });
    const { buf } = await build([
      {
        type: "table", props: {}, children: [],
        content: {
          type: "tableContent", headerRows: 1, columnWidths: [100, 100, 100],
          rows: [
            { cells: [cell("H1"), cell("H2", { colspan: 2 })] },
            { cells: [cell("A", { rowspan: 2 }), cell("B"), cell("C")] },
            { cells: [cell("D"), cell("E")] },
            { cells: [[text("短い")]] },
          ],
        },
      },
    ]);
    const h = await html(buf);
    expect(h).toContain("<table>");
    expect(h).toMatch(/<td[^>]*colspan="2"[^>]*>[\s\S]*H2/);
    expect(h).toMatch(/<td[^>]*rowspan="2"[^>]*>[\s\S]*A/);
    for (const t of ["H1", "B", "C", "D", "E", "短い"]) expect(h).toContain(t);
  });

  it("引用・コード・区切り線・チェック・トグルも読める", async () => {
    const { buf } = await build([
      { type: "quote", props: {}, content: [text("引用")], children: [] },
      { type: "codeBlock", props: {}, content: [text("a\nb")], children: [] },
      { type: "divider", props: {}, children: [] },
      { type: "checkListItem", props: { checked: true }, content: [text("済")], children: [] },
      { type: "toggleListItem", props: {}, content: [text("畳")], children: [para("子")] },
    ]);
    const h = await html(buf);
    // 印と文字の間はタブ（印をぶら下げて、折り返した行を文字の頭に揃えるため）
    for (const t of ["引用", "a", "b", "☑\t済", "▸\t畳", "子"]) expect(h).toContain(t);
  });
});

// Word で開いた見え方を決めている指定。Word 本体で見て決めたもの（2026-11-17）なので、
// 外れたら Word で見直す
describe("体裁", () => {
  const styleBlock = (styles: string, id: string) =>
    styles.match(new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`))?.[0] ?? "";

  it("英数字と日本語に同じ書体を当てる（別々だと英数字だけ濃く見える）", async () => {
    const { files } = await build([para("本文 abc 123")]);
    const styles = strFromU8(files["word/styles.xml"]);
    expect(styles).toMatch(/w:ascii="Yu Gothic"/);
    expect(styles).toMatch(/w:hAnsi="Yu Gothic"/);
    expect(styles).toMatch(/w:eastAsia="Yu Gothic"/);
  });

  it("題と見出しは太字で本文と同じ色（Word の既定の細い水色にしない）", async () => {
    const { files } = await build([{ type: "heading", props: { level: 1 }, content: [text("見出し")], children: [] }]);
    const styles = strFromU8(files["word/styles.xml"]);
    for (const id of ["Title", "Heading1", "Heading2", "Heading3"]) {
      const block = styleBlock(styles, id);
      expect(block, `${id} の体裁が無い`).not.toBe("");
      expect(block).toContain("<w:b/>");
      expect(block).toContain('w:val="1F1F1F"');
      expect(block).toContain("<w:keepNext/>");
    }
  });

  it("段落の後ろに間を入れる（ゼロだと詰まって見える）", async () => {
    const { files } = await build([para("本文")]);
    const styles = strFromU8(files["word/styles.xml"]);
    expect(styles).toMatch(/<w:pPrDefault>[\s\S]*w:after="120"[\s\S]*<\/w:pPrDefault>/);
  });

  it("チェックの印は書体を名指しする（任せると ☑ だけ絵文字の形になる）", async () => {
    const { xml } = await build([
      { type: "checkListItem", props: { checked: true }, content: [text("済")], children: [] },
      { type: "checkListItem", props: { checked: false }, content: [text("未")], children: [] },
    ]);
    expect(xml.match(/w:ascii="MS Gothic"/g)?.length).toBe(2);
  });

  it("表は灰色の罫線とセルの内側の余白を持つ", async () => {
    const { xml } = await build([
      { type: "table", props: {}, content: { type: "tableContent", rows: [{ cells: [[text("a")], [text("b")]] }] }, children: [] },
    ]);
    expect(xml).toContain("<w:tblCellMar>");
    expect(xml).toMatch(/<w:insideH [^>]*w:color="BFBFBF"/);
    expect(xml).not.toMatch(/<w:tblBorders>[\s\S]*w:color="auto"[\s\S]*<\/w:tblBorders>/);
  });
});

describe("数式", () => {
  const mathBlock = (latex: string, children: unknown[] = []) => ({ type: "math", props: { latex }, children });
  const inlineMath = (latex: string) => ({ type: "inlineMath", props: { latex } });
  /** document.xml の中の、数式を含む段落（w:p）だけを取り出す */
  const mathParagraphs = (xml: string) => (xml.match(/<w:p>(?:(?!<\/w:p>).)*<m:oMath>.*?<\/w:p>/gs) ?? []);

  it("数式ブロックは中央寄せの段落に Word の数式（m:oMathPara）として入る", async () => {
    const { xml, buf } = await build([mathBlock("\\frac{a}{b} + \\sqrt{x}")]);
    expect(xml).toContain('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"');
    const paragraphs = mathParagraphs(xml);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toContain('<w:jc w:val="center"/>');
    expect(paragraphs[0]).toContain('<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>');
    expect(paragraphs[0]).toContain("<m:f><m:num>");
    expect(paragraphs[0]).toContain("<m:rad>");
    // LaTeX の文字は残らない
    expect(xml).not.toContain("$$");
    expect(xml).not.toContain("\\frac");
    await html(buf);
  });

  it("代表的な式がそれぞれの要素になる", async () => {
    const { xml } = await build([
      mathBlock("x^2 + y_i"),
      mathBlock("\\alpha + \\Gamma"),
      mathBlock("\\sum_{i=1}^{n} x_i"),
      mathBlock("\\int_0^1 f(x)\\,dx"),
      mathBlock("\\left( \\frac{a}{b} \\right)"),
    ]);
    expect(mathParagraphs(xml)).toHaveLength(5);
    expect(xml).toContain("<m:sSup>");
    expect(xml).toContain("<m:sSub>");
    expect(xml).toContain("α");
    expect(xml).toContain('<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>');
    expect(xml).toContain('<m:chr m:val="∫"/>');
    expect(xml).toContain('<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/>');
    // 空の要素（隠した次数）も消えずに出る
    const { xml: rad } = await build([mathBlock("\\sqrt{x}")]);
    expect(rad).toContain('<m:degHide m:val="1"/></m:radPr><m:deg/><m:e>');
  });

  it("文中の数式は文の流れの中に入る（段落・見出し・表・リンク）", async () => {
    const cell = (content: unknown[]) => ({ type: "tableCell", props: {}, content });
    const { xml, buf } = await build([
      { type: "paragraph", props: {}, content: [text("前 "), inlineMath("E = mc^2"), text(" 後")], children: [] },
      { type: "heading", props: { level: 2 }, content: [text("見出し "), inlineMath("\\alpha")], children: [] },
      { type: "table", props: {}, children: [], content: { type: "tableContent", rows: [{ cells: [cell([inlineMath("\\sqrt{2}")])] }] } },
      { type: "paragraph", props: {}, content: [{ type: "link", href: "https://example.com", content: [inlineMath("x_1")] }], children: [] },
    ]);
    // 前後の文字と同じ段落に、m:oMathPara ではなく m:oMath で入る
    expect(xml).toMatch(/前 <\/w:t><\/w:r><m:oMath>.*?<\/m:oMath><w:r>/s);
    expect(xml).not.toContain("<m:oMathPara>");
    expect(xml.match(/<m:oMath>/g)).toHaveLength(4);
    expect(xml).toMatch(/<w:tc>.*<m:rad>.*<\/w:tc>/s);
    expect(xml).toMatch(/<w:hyperlink [^>]*>(?:(?!<\/w:hyperlink>).)*<m:sSub>/s);
    expect(xml).not.toContain("$");
    const h = await html(buf);
    expect(h).toContain("前");
    expect(h).toContain("後");
  });

  it("Word の数式にできない式は、これまでどおり LaTeX の文字で出る", async () => {
    const matrix = "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}";
    const { xml, buf } = await build([
      mathBlock(matrix),
      { type: "paragraph", props: {}, content: [text("文中 "), inlineMath("\\boxed{y}")], children: [] },
    ]);
    expect(xml).not.toContain("<m:oMath");
    const h = await html(buf);
    expect(h).toContain("$$ \\begin{pmatrix} a &amp; b \\\\ c &amp; d \\end{pmatrix} $$");
    expect(h).toContain("$\\boxed{y}$");
  });

  it("数式にできる式とできない式が同じノートにあれば、式ごとに決まる", async () => {
    const { xml, buf } = await build([
      mathBlock("\\frac{a}{b}"),
      mathBlock("a = b \\tag{1}"),
      { type: "paragraph", props: {}, content: [inlineMath("x^2"), text(" と "), inlineMath("\\foo")], children: [] },
    ]);
    expect(xml.match(/<m:oMath>/g)).toHaveLength(2);
    const h = await html(buf);
    expect(h).toContain("$$ a = b \\tag{1} $$");
    expect(h).toContain("$\\foo$");
    expect(h).not.toContain("$x^2$");
  });

  it("数式ブロックの子ブロックは、数式でも文字でも残る", async () => {
    const child = para("子の段落");
    for (const latex of ["x^2", "\\boxed{x}"]) {
      const { buf } = await build([mathBlock(latex, [child])]);
      expect(await html(buf)).toContain("子の段落");
    }
  });

  it("壊れた LaTeX・空の式・制御文字でも書き出しは落ちない", async () => {
    const broken = ["\\frac{a}{", "}", "\\left(", "", "   ", "\u0001x\u0008", "\ud800", "x".repeat(5000), "\\sqrt{".repeat(200) + "x" + "}".repeat(200)];
    const { xml, buf } = await build([
      ...broken.map((latex) => mathBlock(latex)),
      { type: "paragraph", props: {}, content: broken.map(inlineMath), children: [] },
      { type: "math", props: {}, children: [] },
      { type: "math", props: { latex: 5 }, children: [] },
      { type: "math", children: [] },
      { type: "paragraph", props: {}, content: [{ type: "inlineMath" }, { type: "inlineMath", props: { latex: null } }], children: [] },
    ]);
    await html(buf);
    // 読めない式は LaTeX の文字のまま
    expect(xml).toContain("\\frac{a}{");
    // 数字だけの latex（5）は数式になる
    expect(xml).toContain("<m:oMath>");
  });

  it("数式の中の < > & は XML として壊れない", async () => {
    const { xml, buf } = await build([mathBlock("a < b \\& c > d \\text{<tag>}")]);
    expect(xml).toContain("a&lt;b");
    expect(xml).toContain("&lt;tag&gt;");
    await html(buf);
  });
});

describe("標準ブロックの取りこぼし", () => {
  it("BlockNote の標準ブロックすべてに描画側の対応がある", () => {
    for (const type of Object.keys(defaultBlockSpecs)) {
      expect(RENDERED_BLOCK_TYPES.has(type), `描画側に ${type} の対応が無い`).toBe(true);
    }
  });
});

describe("壊れた入力", () => {
  const nasty = "制御\u0001\u0008文字 < > & \" ' \ud800 孤立 \udc00 😀 タブ\t改行\nです";

  it("文字の後始末", () => {
    const c = cleanXmlText(nasty);
    expect(c).not.toMatch(/[\u0001\u0008]/);
    expect(c).toContain("😀");
    expect(c).not.toContain("\ud800 ");
    expect(c).toContain("\t");
  });

  it("配列でない blocks・null の要素", async () => {
    for (const b of [undefined, null, "x", 3, {}, [null, undefined, 1, "s", [], {}]]) {
      const { buf } = await build(b);
      await html(buf);
    }
  });

  it("制御文字・記号・対になっていないサロゲートを含む本文", async () => {
    const { buf } = await build([
      para(nasty),
      { type: "heading", props: { level: 9 }, content: [text(nasty)], children: [] },
      { type: "codeBlock", props: {}, content: [text(nasty)], children: [] },
    ], { title: nasty });
    const h = await html(buf);
    expect(h).toContain("&lt; &gt; &amp;");
  });

  it("セル数が不揃い・表より大きい colspan・空の表", async () => {
    const cell = (t: string, props: Record<string, unknown> = {}) => ({ type: "tableCell", props, content: [text(t)] });
    const { buf } = await build([
      { type: "table", props: {}, children: [], content: { type: "tableContent", rows: [
        { cells: [cell("a", { colspan: 99, rowspan: 99 }), cell("b")] },
        { cells: [] },
        { cells: [cell("c")] },
        {},
        null,
      ] } },
      { type: "table", props: {}, children: [], content: { type: "tableContent", rows: [] } },
      { type: "table", props: {}, children: [], content: 5 },
    ]);
    const h = await html(buf);
    expect(h).toContain("a");
  });

  it("深さ 30 の入れ子", async () => {
    let node: any = para("底");
    for (let i = 0; i < 30; i++) {
      node = { type: i % 2 ? "bulletListItem" : "paragraph", props: {}, content: [text(`L${i}`)], children: [node] };
    }
    const { buf } = await build([node]);
    const h = await html(buf);
    expect(h).toContain("底");
  });

  it("画像の読み込みが例外でも全体は失敗しない", async () => {
    const { buf } = await build(
      [{ type: "image", props: { url: "u", name: "x.png" }, children: [] }, para("後続")],
      { loadMedia: async () => { throw new Error("boom"); } },
    );
    const h = await html(buf);
    expect(h).toContain("後続");
    expect(h).toContain("x.png");
  });

  it("縦に長い画像は高さ 900px に収まるよう縦横比を保って縮む", async () => {
    const { xml } = await build(
      [{ type: "image", props: { url: "u", name: "tall.png" }, children: [] }],
      { loadMedia: async () => pngImage(800, 6000) },
    );
    const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)!;
    expect(Number(m[2])).toBeLessThanOrEqual(900 * 9525);
    expect(Number(m[1]) / Number(m[2])).toBeCloseTo(800 / 6000, 1);
  });

  it("チャートを画像で出すときもキャプションと子ブロックが残る", async () => {
    const chart = [{
      id: "ch1", type: "chart", props: { config: JSON.stringify({ caption: "図1 キャプション" }) },
      children: [para("子の段落")],
    }];
    const { files, xml } = await build(chart, { captureBlockImage: async () => pngImage() });
    expect(Object.keys(files).some((k) => k.startsWith("word/media/"))).toBe(true);
    expect(xml).toContain("図1 キャプション");
    expect(xml).toContain("子の段落");
  });

  it("type が Object.prototype の名前でも書き出しは落ちない", async () => {
    const names = ["constructor", "valueOf", "__proto__", "hasOwnProperty", "toString"];
    const { xml } = await build([
      ...names.map((n) => ({ type: n, props: {}, content: [text(`x-${n}`)], children: [] })),
      para("後続"),
    ]);
    expect(xml).toContain("後続");
  });

  it("リンクの文字には Hyperlink の文字スタイルが付く", async () => {
    const { xml } = await build([
      { type: "paragraph", props: {}, children: [], content: [{ type: "link", href: "https://a.com", content: [text("L")] }] },
    ]);
    expect(xml).toContain('w:rStyle w:val="Hyperlink"');
  });

  it("columnWidths が無く全行がセル結合でも結合幅が潰れない", async () => {
    const cell = (t: string, props: Record<string, unknown> = {}) => ({ type: "tableCell", props, content: [text(t)] });
    const { xml } = await build([
      { type: "table", props: {}, children: [], content: { type: "tableContent", rows: [
        { cells: [cell("A", { colspan: 2 }), cell("B", { colspan: 2 })] },
        { cells: [cell("C", { colspan: 2 }), cell("D", { colspan: 2 })] },
      ] } },
    ]);
    expect((xml.match(/<w:gridCol /g) ?? []).length).toBe(4);
    expect((xml.match(/<w:gridSpan w:val="2"\/>/g) ?? []).length).toBe(4);
  });
});
