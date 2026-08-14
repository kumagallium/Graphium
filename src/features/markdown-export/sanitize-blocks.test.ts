// sanitize-blocks.ts（一括 Markdown 変換前のブロックサニタイズ）のユニットテスト

import { describe, it, expect } from "vitest";
import {
  sanitizeBlocksForMarkdown,
  extractInlineText,
  mentionToWikiLinkText,
  type SanitizeSchemaInfo,
} from "./sanitize-blocks";

// default スキーマ相当のテスト用 schema 情報
// （実物は doc-to-markdown.ts が defaultBlockSpecs / defaultStyleSpecs から導出する）
const SCHEMA: SanitizeSchemaInfo = {
  knownBlockTypes: new Set([
    "paragraph", "heading", "quote", "bulletListItem", "numberedListItem",
    "checkListItem", "codeBlock", "table", "file", "image", "video", "audio",
  ]),
  knownStyles: new Set([
    "bold", "italic", "underline", "strike", "code", "textColor", "backgroundColor",
  ]),
};

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });

describe("sanitizeBlocksForMarkdown", () => {
  it("標準ブロックはそのまま維持する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ id: "b1", type: "heading", props: { level: 2 }, content: [text("Title")], children: [] }],
      SCHEMA,
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("heading");
    expect(result[0].props).toEqual({ level: 2 });
    expect(result[0].content).toEqual([text("Title")]);
    // id はヘッドレスエディタ側で採番させるため落とす
    expect(result[0].id).toBeUndefined();
  });

  it("未知のカスタム style（来歴ハイライト）を取り除き、既知 style は残す", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "paragraph",
        content: [text("KOH aq", { bold: true, inlineMaterial: "entity-123" })],
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("KOH aq", { bold: true })]);
  });

  it("bookmark ブロックをリンク付き paragraph に変換する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "bookmark",
        props: { url: "https://example.com/x", title: "Example", domain: "example.com" },
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([
      { type: "link", href: "https://example.com/x", content: [text("Example")] },
    ]);
  });

  it("sharedCitation ブロックを出所テキストの paragraph に変換する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "sharedCitation",
        props: {
          sharedId: "0198-abc",
          entryType: "data-manifest",
          cachedTitle: "NaCl 単結晶 XRD",
          cachedAuthor: "田中",
        },
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    const flat = JSON.stringify(result[0].content);
    expect(flat).toContain("NaCl 単結晶 XRD");
    expect(flat).toContain("data-manifest");
    expect(flat).toContain("田中");
    expect(flat).toContain("shared://0198-abc");
  });

  // 型名は "pdf"。かつて "pdfViewer" を判定していて実データに一度も効かず、
  // テストが同じ綴りで書かれていたため緑のままだった（registry.test.ts が
  // 登録型との差分を見張るようになった経緯）。
  it("pdf ブロックをファイル名リンクの paragraph に変換する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "pdf", props: { url: "local-media://abc", name: "paper.pdf" }, children: [] }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([
      { type: "link", href: "local-media://abc", content: [text("paper.pdf")] },
    ]);
  });

  it("callout ブロックは本文を維持した paragraph に変換する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "callout", props: { variant: "warning" }, content: [text("注意書き")], children: [] }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([text("注意書き")]);
  });

  it("未知ブロックはプレーンテキストの paragraph にフォールバックする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "futureBlock", content: [text("hello "), text("world")], children: [] }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([text("hello world")]);
  });

  it("children を再帰的にサニタイズする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "bulletListItem",
        content: [text("parent")],
        children: [{
          type: "bulletListItem",
          content: [text("child", { inlineTool: "entity-9" })],
          children: [],
        }],
      }],
      SCHEMA,
    );
    expect(result[0].children[0].content).toEqual([text("child")]);
  });

  it("link inline の中の style もサニタイズする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "paragraph",
        content: [{
          type: "link",
          href: "https://example.com",
          content: [text("site", { inlineOutput: "e-1", italic: true })],
        }],
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([
      { type: "link", href: "https://example.com", content: [text("site", { italic: true })] },
    ]);
  });

  it("table のセル内 style をサニタイズする（配列セル形式）", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [[text("A", { inlineMaterial: "e-1" })], [text("B")]] }],
        },
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content.rows[0].cells).toEqual([[text("A")], [text("B")]]);
  });

  it("table の tableCell オブジェクト形式のセルもサニタイズする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [{ type: "tableCell", content: [text("X", { inlineTool: "e" })] }] }],
        },
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content.rows[0].cells).toEqual([
      { type: "tableCell", content: [text("X")] },
    ]);
  });

  it("配列でない入力には空配列を返す", () => {
    expect(sanitizeBlocksForMarkdown(undefined, SCHEMA)).toEqual([]);
    expect(sanitizeBlocksForMarkdown(null, SCHEMA)).toEqual([]);
  });

  it("math ブロックを $$ ... $$ の段落に落とす", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "math", props: { latex: "E = mc^2" }, children: [] }],
      SCHEMA,
    );
    expect(result[0]).toMatchObject({ type: "paragraph" });
    expect(result[0].content).toEqual([text("$$ E = mc^2 $$")]);
  });

  it("latex が空の math ブロックは空段落にする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "math", props: { latex: "  " }, children: [] }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([]);
  });

  it("step ブロックはタイトルを H2、中身をその下に置く", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "step",
        props: { variant: "step" },
        content: [text("試料を秤量する")],
        children: [{ type: "paragraph", props: {}, content: [text("0.5 g")], children: [] }],
      }],
      SCHEMA,
    );
    expect(result[0]).toMatchObject({ type: "heading", props: { level: 2 } });
    expect(result[0].content).toEqual([text("試料を秤量する")]);
    expect(result[0].children[0].content).toEqual([text("0.5 g")]);
  });

  // 設定は props.config の JSON が正。個々の prop（かつての xColumn）を読むと、
  // 設定項目が config に移った時に静かに陳腐化して "(Chart)" しか出なくなる。
  it("chart ブロックをキャプションと系列が読める斜体 1 行に落とす", () => {
    const config = {
      chartType: "line",
      caption: "図1 温度依存性",
      series: [
        { sourceBlockId: "t1", xColumn: "Temperature", yColumn: "Resistivity" },
        { sourceBlockId: "t1", xColumn: "Temperature", yColumn: "Seebeck", label: "S" },
      ],
    };
    const result = sanitizeBlocksForMarkdown(
      [{ type: "chart", props: { config: JSON.stringify(config), sourceBlockId: "" }, children: [] }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    // X が全系列で共通なら 1 回だけ書く
    expect(result[0].content).toEqual([
      text("Chart (line): 図1 温度依存性 — Resistivity, S vs Temperature", { italic: true }),
    ]);
  });

  it("X が系列ごとに違うときは組で書く", () => {
    const config = {
      chartType: "scatter",
      series: [
        { sourceBlockId: "t1", xColumn: "Time", yColumn: "Weight" },
        { sourceBlockId: "t2", xColumn: "Temperature", yColumn: "Resistivity" },
      ],
    };
    const result = sanitizeBlocksForMarkdown(
      [{ type: "chart", props: { config: JSON.stringify(config) }, children: [] }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([
      text("Chart (scatter): Weight vs Time, Resistivity vs Temperature", { italic: true }),
    ]);
  });

  // スペクトル比較（XRD 等）は段＝試料で、Y 列は全段 Intensity のことが多い。
  // 列名で書くと段が 1 つに潰れるので、画面の凡例と同じくテーブル名で書き分ける
  it("スタック表示は段をテーブル名で書き分ける", () => {
    const config = {
      chartType: "line",
      stack: { enabled: true },
      series: [
        { sourceBlockId: "t1", xColumn: "2theta", yColumn: "Intensity" },
        { sourceBlockId: "t2", xColumn: "2theta", yColumn: "Intensity" },
      ],
    };
    const result = sanitizeBlocksForMarkdown(
      [{ type: "chart", props: { config: JSON.stringify(config) }, children: [] }],
      SCHEMA,
      new Map([["t1", "試料 A"], ["t2", "試料 B"]]),
    );
    expect(result[0].content).toEqual([
      text("Chart (line, stacked): 試料 A, 試料 B vs 2theta", { italic: true }),
    ]);
  });

  it("段名が揃ってしまうときは系列数を添える（黙って 1 本に見せない）", () => {
    const config = {
      chartType: "line",
      stack: { enabled: true },
      series: [
        { sourceBlockId: "t1", xColumn: "2theta", yColumn: "Intensity" },
        { sourceBlockId: "t2", xColumn: "2theta", yColumn: "Intensity" },
        { sourceBlockId: "t3", xColumn: "2theta", yColumn: "Intensity" },
      ],
    };
    // テーブル名が無い（キャプションも日時列も無い）ので全段が Intensity に落ちる
    const result = sanitizeBlocksForMarkdown(
      [{ type: "chart", props: { config: JSON.stringify(config) }, children: [] }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([
      text("Chart (line, stacked): Intensity vs 2theta (3 series)", { italic: true }),
    ]);
  });

  it("ヒストグラムは X を持たないので Y だけ並べる", () => {
    const config = {
      chartType: "histogram",
      series: [{ sourceBlockId: "t1", xColumn: "", yColumn: "Diameter" }],
    };
    const result = sanitizeBlocksForMarkdown(
      [{ type: "chart", props: { config: JSON.stringify(config) }, children: [] }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("Chart (histogram): Diameter", { italic: true })]);
  });

  it("キャプションも系列も無い chart は種類だけ残す", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "chart", props: { config: "", sourceBlockId: "" }, children: [] }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("Chart (line)", { italic: true })]);
  });

  // 結果は `//` を付けて添える。calc は `//` 始まりをコメントとして素通しするので、
  // 書き出した Markdown をそのまま貼り戻しても式だけが再評価される
  it("calc ブロックを式と結果のコードブロックに落とす", () => {
    const results = [{ kind: "value", text: "2 kg" }, { kind: "value", text: "6 kg" }];
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "calc",
        props: { source: "a = 2 kg\nb = a * 3", results: JSON.stringify(results) },
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].type).toBe("codeBlock");
    expect(result[0].content).toEqual([text("a = 2 kg   // 2 kg\nb = a * 3  // 6 kg")]);
  });

  it("未評価の calc ブロックは式だけを残す", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "calc", props: { source: "a = 2 kg", results: "" }, children: [] }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("a = 2 kg")]);
  });

  it("空の calc ブロックは何も出さない", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "calc", props: { source: "   ", results: "" }, children: [] }],
      SCHEMA,
    );
    expect(result).toEqual([]);
  });

  it("columnList / column はラッパーを捨てて中身をカラム順に持ち上げる", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        id: "cl1",
        type: "columnList",
        children: [
          {
            id: "c1", type: "column", props: { width: 1 },
            children: [{ type: "paragraph", content: [text("左カラム")], children: [] }],
          },
          {
            id: "c2", type: "column", props: { width: 2 },
            children: [
              { type: "heading", props: { level: 2 }, content: [text("右見出し")], children: [] },
              { type: "paragraph", content: [text("右本文")], children: [] },
            ],
          },
        ],
      }],
      SCHEMA,
    );
    // ラッパー（columnList / column）は出力に残らず、空 paragraph も挟まらない
    expect(result.map((b) => b.type)).toEqual(["paragraph", "heading", "paragraph"]);
    expect(result[0].content).toEqual([text("左カラム")]);
    expect(result[1].content).toEqual([text("右見出し")]);
    expect(result[2].content).toEqual([text("右本文")]);
  });

  it("inlineMath を $ ... $ のテキストに戻す", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "paragraph", props: {}, children: [],
        content: [text("係数は "), { type: "inlineMath", props: { latex: "b = -0.126" } }, text(" である")],
      }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("係数は "), text("$b = -0.126$"), text(" である")]);
  });
});

describe("extractInlineText", () => {
  it("text inline を連結する", () => {
    expect(extractInlineText([text("a"), text("b")])).toBe("ab");
  });

  it("link inline の中のテキストも拾う", () => {
    expect(
      extractInlineText([{ type: "link", href: "x", content: [text("label")] }]),
    ).toBe("label");
  });

  it("inlineMath は $ ... $ の表記で拾う", () => {
    expect(extractInlineText([text("係数 "), { type: "inlineMath", props: { latex: "x^2" } }])).toBe("係数 $x^2$");
  });

  it("配列以外は空文字を返す", () => {
    expect(extractInlineText(undefined)).toBe("");
    expect(extractInlineText({})).toBe("");
  });
});

describe("mentionToWikiLinkText", () => {
  it("青文字の @タイトル を [[タイトル]] にする", () => {
    expect(mentionToWikiLinkText(text("@Other Note", { textColor: "blue" }))).toBe("[[Other Note]]");
  });

  it("Wiki メンションの 🤖 プレフィックスは剥がす", () => {
    expect(mentionToWikiLinkText(text("@🤖 Perovskite", { textColor: "blue" }))).toBe("[[Perovskite]]");
  });

  it("青くない @ テキストは変換しない", () => {
    expect(mentionToWikiLinkText(text("@twitter_handle"))).toBeNull();
  });

  it("@ で始まらない青文字は変換しない", () => {
    expect(mentionToWikiLinkText(text("blue text", { textColor: "blue" }))).toBeNull();
  });

  it("@ のみ（タイトル空）は変換しない", () => {
    expect(mentionToWikiLinkText(text("@", { textColor: "blue" }))).toBeNull();
  });
});

describe("sanitizeBlocksForMarkdown のメンション変換", () => {
  it("paragraph 内のメンションを [[タイトル]] テキストにする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        id: "b1",
        type: "paragraph",
        props: {},
        content: [text("see "), text("@Other Note", { textColor: "blue" })],
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("see "), text("[[Other Note]]")]);
  });
});

describe("メンション変換（children / テーブルセル）", () => {
  it("children とテーブルセルのメンションも [[タイトル]] にする", () => {
    const blocks = [
      {
        id: "b1",
        type: "paragraph",
        props: {},
        content: [text("@Parent", { textColor: "blue" })],
        children: [
          { id: "b2", type: "paragraph", props: {}, content: [text("@Child", { textColor: "blue" })], children: [] },
        ],
      },
      {
        id: "b3",
        type: "table",
        props: {},
        content: {
          type: "tableContent",
          rows: [{ cells: [[text("@Cell", { textColor: "blue" })]] }],
        },
        children: [],
      },
    ];
    const result = sanitizeBlocksForMarkdown(blocks, SCHEMA);
    expect(result[0].content).toEqual([text("[[Parent]]")]);
    expect(result[0].children[0].content).toEqual([text("[[Child]]")]);
    expect(result[1].content.rows[0].cells[0]).toEqual([text("[[Cell]]")]);
  });

  it("元のブロック配列は変更しない（非破壊）", () => {
    const blocks = [{
      id: "b1",
      type: "paragraph",
      props: {},
      content: [text("@Note", { textColor: "blue" })],
      children: [],
    }];
    sanitizeBlocksForMarkdown(blocks, SCHEMA);
    expect(blocks[0].content[0].text).toBe("@Note");
  });
});
