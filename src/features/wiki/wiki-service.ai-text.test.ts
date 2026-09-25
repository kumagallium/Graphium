// AI に渡す本文のテキスト化と、AI の出力をページに戻す変換で、上付き・下付き・数式・リンクが
// 落ちないこと、step の中身・入れ子の子・表が落ちないことの回帰テスト。
//
// 入力側: extractPlainTextFromDoc / extractPlainTextBlocks / extractBodyPreview と、
//         書き直し（rewriteAndMerge）が Rewriter に渡す節のテキスト
// 出力側: parseInlineCitations / convertSectionsToBlocks（buildSourceTopicDocument 経由）

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSourceTopicDocument,
  extractBodyPreview,
  extractPlainTextBlocks,
  extractPlainTextFromDoc,
  extractTopicOneLiner,
  ingestNote,
  parseInlineCitations,
  rewriteAndMerge,
} from "./wiki-service";
import type { GraphiumDocument } from "../../lib/document-types";
import type { IngesterOutput } from "../../server/services/wiki-ingester";

const emptyIndex: any[] = [];

function docWithBlocks(blocks: any[], extra: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 2,
    title: "テストノート",
    pages: [{ id: "main", title: "テストノート", blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-09-01T00:00:00Z",
    modifiedAt: "2026-09-01T00:00:00Z",
    ...extra,
  } as GraphiumDocument;
}

const t = (text: string, styles: Record<string, unknown> = {}) => ({ type: "text", text, styles });

// 「圧力 10⁵ Pa で H₂O の ΔG が負になる（出典）」+ 数式ブロック
const richBlocks: any[] = [
  {
    id: "b1",
    type: "paragraph",
    content: [
      t("圧力 10"),
      t("5", { superscript: true }),
      t(" Pa で H"),
      t("2", { subscript: true }),
      t("O の "),
      { type: "inlineMath", props: { latex: "\\Delta G" } },
      t(" が負になる（"),
      { type: "link", href: "https://example.com/paper", content: [t("出典")] },
      t("）"),
    ],
    children: [],
  },
  { id: "b2", type: "math", props: { latex: "\\Delta G = \\Delta H - T\\Delta S" }, children: [] },
];

describe("AI に渡す本文 - 上付き・下付き・数式・リンクを保つ", () => {
  it("extractPlainTextFromDoc は <sup> / <sub>・$…$・リンクの文字・$$ … $$ で本文を書く", () => {
    expect(extractPlainTextFromDoc(docWithBlocks(richBlocks))).toBe(
      "圧力 10<sup>5</sup> Pa で H<sub>2</sub>O の $\\Delta G$ が負になる（出典）\n" +
        "$$ \\Delta G = \\Delta H - T\\Delta S $$",
    );
  });

  it("リンクを [object Object] にしない", () => {
    const text = extractPlainTextFromDoc(docWithBlocks(richBlocks));
    expect(text).not.toContain("[object Object]");
  });

  it("extractPlainTextBlocks は数式ブロックを $$ … $$ にする（出典照合の原文もこれを通る）", () => {
    expect(extractPlainTextBlocks(docWithBlocks(richBlocks))[1]).toEqual({
      id: "b2",
      text: "$$ \\Delta G = \\Delta H - T\\Delta S $$",
    });
  });

  it("extractBodyPreview（点検・洞察・一覧のプレビュー）も上付きと数式ブロックを保つ", () => {
    const doc = docWithBlocks([
      { id: "h", type: "heading", props: { level: 2 }, content: [t("定義")], children: [] },
      ...richBlocks,
    ]);
    expect(extractBodyPreview(doc, 500)).toBe(
      "圧力 10<sup>5</sup> Pa で H<sub>2</sub>O の $\\Delta G$ が負になる（出典） " +
        "$$ \\Delta G = \\Delta H - T\\Delta S $$",
    );
  });

  describe("取り込みと書き直しが API に送る本文", () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("ingestNote は上付き・数式を保った本文を /ingest に送る", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "m" }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await ingestNote("note-1", docWithBlocks(richBlocks), [], "ja", "m", undefined, "schema");

      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/ingest"));
      expect(call).toBeDefined();
      const body = JSON.parse(String(call![1]?.body));
      expect(body.noteContent).toContain("10<sup>5</sup> Pa");
      expect(body.noteContent).toContain("H<sub>2</sub>O");
      expect(body.noteContent).toContain("$\\Delta G$");
      expect(body.noteContent).toContain("$$ \\Delta G = \\Delta H - T\\Delta S $$");
    });

    it("rewriteAndMerge は読み戻せる表記（[[…]]・[文字](URL)・<sup>・$…$・$$ … $$）で既存の節を渡す", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const existing = claimDoc();
      await rewriteAndMerge(existing, ingesterOutput, "note-2", "m");

      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/rewrite"));
      expect(call).toBeDefined();
      const body = JSON.parse(String(call![1]?.body));
      expect(body.existingSections).toEqual([
        {
          heading: "条件",
          content:
            "圧力 10<sup>5</sup> Pa で H<sub>2</sub>O の $\\Delta G$ が負になる（[出典](https://example.com/paper)）[[元ノート]]\n" +
            "$$ \\Delta G = \\Delta H - T\\Delta S $$",
        },
      ]);
    });

    it("書き直しで AI が節をそのまま返しても、上付き・下付き・数式・リンク・引用がページに戻る（往復）", async () => {
      global.fetch = vi.fn(async (url: any, init: any) => {
        if (String(url).endsWith("/rewrite")) {
          const sent = JSON.parse(String(init?.body));
          return { ok: true, json: async () => ({ sections: sent.existingSections }) };
        }
        return { ok: false, status: 500 };
      }) as unknown as typeof fetch;

      const noteIndex = [{ id: "note-1", title: "元ノート" }];
      const next = await rewriteAndMerge(claimDoc(), ingesterOutput, "note-2", "m", "ja", noteIndex);

      const blocks = next.pages[0].blocks as any[];
      // 追記マージ（フォールバック）ではなく、書き直しの出力からページが組み直されていること
      // （フォールバックだと元のブロックが残り、下の比較が素通りしてしまう）
      expect(blocks.map((b) => b.id)).not.toContain("b1");
      expect(JSON.stringify(blocks)).not.toContain("新しい内容");
      expect(next.pages[0].knowledgeLinks.map((l: any) => l.targetNoteId)).toContain("note-1");

      const heading = blocks.find((b) => b.type === "heading");
      expect(heading.content).toEqual([t("条件")]);

      const paragraph = blocks.find((b) => b.type === "paragraph");
      expect(paragraph.content).toEqual([
        t("圧力 10"),
        t("5", { superscript: true }),
        t(" Pa で H"),
        t("2", { subscript: true }),
        t("O の "),
        { type: "inlineMath", props: { latex: "\\Delta G" } },
        t(" が負になる（"),
        { type: "link", href: "https://example.com/paper", content: [t("出典")] },
        t("）"),
        t("@元ノート", { textColor: "blue" }),
      ]);

      const math = blocks.find((b) => b.type === "math");
      expect(math.props).toEqual({ latex: "\\Delta G = \\Delta H - T\\Delta S" });
    });

    it("書き直しの往復で、丸括弧を含む URL を書き換えない", async () => {
      global.fetch = vi.fn(async (url: any, init: any) => {
        if (String(url).endsWith("/rewrite")) {
          const sent = JSON.parse(String(init?.body));
          return { ok: true, json: async () => ({ sections: sent.existingSections }) };
        }
        return { ok: false, status: 500 };
      }) as unknown as typeof fetch;

      const wiki = "https://en.wikipedia.org/wiki/Seebeck_(disambiguation)";
      const odd = "https://example.com/a(b";
      const existing = claimDoc();
      existing.pages[0].blocks = [
        { id: "h1", type: "heading", props: { level: 2 }, content: [t("条件")], children: [] },
        {
          id: "p1",
          type: "paragraph",
          content: [
            { type: "link", href: wiki, content: [t("Seebeck")] },
            t(" と "),
            { type: "link", href: odd, content: [t("対の無い括弧")] },
          ],
          children: [],
        },
      ] as any;
      const next = await rewriteAndMerge(existing, ingesterOutput, "note-2", "m");

      const paragraph = (next.pages[0].blocks as any[]).find((b) => b.type === "paragraph");
      expect(paragraph.id).not.toBe("p1");
      expect(paragraph.content).toEqual([
        { type: "link", href: wiki, content: [t("Seebeck")] },
        t(" と "),
        // 対の無い丸括弧だけは %28 にして読み戻す（リンクは失わない）
        { type: "link", href: "https://example.com/a%28b", content: [t("対の無い括弧")] },
      ]);
    });
  });
});

// BlockNote 0.47 からの表のセル
const cell = (...content: unknown[]) => ({ type: "tableCell", props: {}, content });

// 見出し → step（段落・入れ子の箇条書き・表を中に持つ）→ 段落 → 2 段組み
const structuredBlocks: any[] = [
  { id: "h1", type: "heading", props: { level: 2 }, content: [t("試料作製")], children: [] },
  {
    id: "s1",
    type: "step",
    props: {},
    content: [t("粉末の秤量")],
    children: [
      {
        id: "p1",
        type: "paragraph",
        content: [t("Bi"), t("2", { subscript: true }), t("Te"), t("3", { subscript: true }), t(" を 5 g 秤量する")],
        children: [],
      },
      {
        id: "li1",
        type: "bulletListItem",
        content: [t("メノウ乳鉢で混合する")],
        children: [{ id: "li2", type: "bulletListItem", content: [t("30 分")], children: [] }],
      },
      {
        id: "tb1",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [cell(t("試料")), cell(t("温度 (K)"))] },
            { cells: [cell(t("A")), cell(t("300"))] },
          ],
        },
        children: [],
      },
    ],
  },
  { id: "p2", type: "paragraph", content: [t("焼結後に XRD で確認した。")], children: [] },
  {
    id: "cl1",
    type: "columnList",
    children: [
      { id: "c1", type: "column", props: { width: 1 }, children: [{ id: "p3", type: "paragraph", content: [t("左の列")], children: [] }] },
      { id: "c2", type: "column", props: { width: 1 }, children: [{ id: "p4", type: "paragraph", content: [t("右の列")], children: [] }] },
    ],
  },
];

describe("AI に渡す本文 - step の中身・入れ子の子・表を落とさない", () => {
  it("子は親の下に 2 字ずつ下げて並べ、表は 1 行ずつセルを | で区切る", () => {
    expect(extractPlainTextFromDoc(docWithBlocks(structuredBlocks))).toBe(
      [
        "試料作製",
        "粉末の秤量",
        "  Bi<sub>2</sub>Te<sub>3</sub> を 5 g 秤量する",
        "  メノウ乳鉢で混合する",
        "    30 分",
        "  試料 | 温度 (K)",
        "  A | 300",
        "焼結後に XRD で確認した。",
        "左の列",
        "右の列",
      ].join("\n"),
    );
  });

  it("extractPlainTextBlocks は子・入れ子の子・表も 1 ブロックずつ id 付きで返し、繋ぐと本文と同じになる", () => {
    const doc = docWithBlocks(structuredBlocks);
    const blocks = extractPlainTextBlocks(doc);
    expect(blocks.map((b) => b.id)).toEqual(["h1", "s1", "p1", "li1", "li2", "tb1", "p2", "p3", "p4"]);
    expect(blocks.find((b) => b.id === "tb1")?.text).toBe("  試料 | 温度 (K)\n  A | 300");
    expect(blocks.map((b) => b.text).join("\n")).toBe(extractPlainTextFromDoc(doc));
  });

  it("本文を持たない親の子も、字下げして 1 行ずつ読む（以前は「, 」で 1 行に繋いでいた）", () => {
    const doc = docWithBlocks([
      {
        id: "li1",
        type: "bulletListItem",
        content: [],
        children: [
          { id: "li2", type: "bulletListItem", content: [t("一つ目")], children: [] },
          { id: "li3", type: "bulletListItem", content: [t("二つ目")], children: [] },
        ],
      },
    ]);
    expect(extractPlainTextFromDoc(doc)).toBe("  一つ目\n  二つ目");
  });

  it("以前のセルの形（inline の配列）の表も読む", () => {
    const doc = docWithBlocks([
      {
        id: "tb1",
        type: "table",
        content: { type: "tableContent", rows: [{ cells: [[t("試料")], [t("A")]] }] },
        children: [],
      },
    ]);
    expect(extractPlainTextFromDoc(doc)).toBe("試料 | A");
  });

  it("段組みの中の step も、トグル見出しの子も読む", () => {
    const doc = docWithBlocks([
      {
        id: "cl1",
        type: "columnList",
        children: [
          {
            id: "c1",
            type: "column",
            props: { width: 1 },
            children: [{ ...structuredBlocks[1], children: [structuredBlocks[1].children[0]] }],
          },
        ],
      },
      {
        id: "h2",
        type: "heading",
        props: { level: 3, isToggleable: true },
        content: [t("補足")],
        children: [{ id: "p9", type: "paragraph", content: [t("湿度 60 %")], children: [] }],
      },
    ]);
    expect(extractPlainTextFromDoc(doc)).toBe(
      "粉末の秤量\n  Bi<sub>2</sub>Te<sub>3</sub> を 5 g 秤量する\n補足\n  湿度 60 %",
    );
  });

  it("1 行が前提の所（プレビュー・トピックの一行定義）では、表の行を / で繋いで 1 行にする", () => {
    const table = structuredBlocks[1].children[2];
    expect(extractBodyPreview(docWithBlocks([table]), 500)).toBe("試料 | 温度 (K) / A | 300");
    const topic = docWithBlocks([
      { id: "h", type: "heading", props: { level: 2 }, content: [t("定義")], children: [] },
      table,
    ]);
    expect(extractTopicOneLiner(topic)).toBe("試料 | 温度 (K) / A | 300");
  });

  describe("取り込みが API に送る本文", () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("ingestNote は step の中身・入れ子の子・表を /ingest に送る", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "m" }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await ingestNote("note-1", docWithBlocks(structuredBlocks), [], "ja", "m", undefined, "schema");

      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/ingest"));
      expect(call).toBeDefined();
      const body = JSON.parse(String(call![1]?.body));
      expect(body.noteContent).toBe(extractPlainTextFromDoc(docWithBlocks(structuredBlocks)));
      expect(body.noteContent).toContain("  Bi<sub>2</sub>Te<sub>3</sub> を 5 g 秤量する");
      expect(body.noteContent).toContain("    30 分");
      expect(body.noteContent).toContain("  A | 300");
    });
  });
});

function claimDoc(): GraphiumDocument {
  return docWithBlocks(
    [
      { id: "h1", type: "heading", props: { level: 2 }, content: [t("条件")], children: [] },
      {
        ...richBlocks[0],
        content: [...richBlocks[0].content, t("@元ノート", { textColor: "blue" })],
      },
      richBlocks[1],
    ],
    {
      title: "知見タイトル",
      wikiMeta: {
        kind: "claim",
        derivedFromNotes: ["note-1"],
        derivedFromChats: [],
        generatedAt: "2026-09-01T00:00:00Z",
        generatedBy: { model: "m", version: "1.0.0" },
      },
    } as Partial<GraphiumDocument>,
  );
}

const ingesterOutput: IngesterOutput = {
  kind: "claim",
  title: "知見タイトル",
  sections: [{ heading: "条件", content: "新しい内容。" }],
  suggestedAction: "merge",
  confidence: 0.9,
  relatedClaims: [],
  externalReferences: [],
};

describe("parseInlineCitations - 上付き・下付きと数式を読み戻す", () => {
  it("<sup> / <sub> を上付き・下付きの書式にする", () => {
    const { inlineContent } = parseInlineCitations("10<sup>5</sup> Pa の H<sub>2</sub>O", emptyIndex);
    expect(inlineContent).toEqual([
      t("10"),
      t("5", { superscript: true }),
      t(" Pa の H"),
      t("2", { subscript: true }),
      t("O"),
    ]);
  });

  it("タグの大文字・属性付きも読む", () => {
    const { inlineContent } = parseInlineCitations('x<SUP class="a">2</SUP>', emptyIndex);
    expect(inlineContent).toEqual([t("x"), t("2", { superscript: true })]);
  });

  it("タグの中のエスケープ（AI が本文の表記をそのまま返したもの）を戻す", () => {
    const { inlineContent } = parseInlineCitations("p<sup>\\*</sup> と a<sub>i\\_j</sub> と x<sup>&lt;1&gt;</sup>", emptyIndex);
    expect(inlineContent).toEqual([
      t("p"),
      t("*", { superscript: true }),
      t(" と a"),
      t("i_j", { subscript: true }),
      t(" と x"),
      t("<1>", { superscript: true }),
    ]);
  });

  it("上付きのアスタリスク同士を斜体の対にしない", () => {
    const { inlineContent } = parseInlineCitations("A<sup>*</sup> と B<sup>*</sup>", emptyIndex);
    expect(inlineContent).toEqual([
      t("A"),
      t("*", { superscript: true }),
      t(" と B"),
      t("*", { superscript: true }),
    ]);
  });

  it("$…$ と \\(…\\) を inlineMath にする", () => {
    const { inlineContent } = parseInlineCitations("式 $E = mc^2$ と \\(a_1\\) を使う", emptyIndex);
    expect(inlineContent).toEqual([
      t("式 "),
      { type: "inlineMath", props: { latex: "E = mc^2" } },
      t(" と "),
      { type: "inlineMath", props: { latex: "a_1" } },
      t(" を使う"),
    ]);
  });

  it("式の中の * や _ を強調の記法として拾わない", () => {
    const { inlineContent } = parseInlineCitations("$a*b*c$ と $x_1 x_2$", emptyIndex);
    expect(inlineContent).toEqual([
      { type: "inlineMath", props: { latex: "a*b*c" } },
      t(" と "),
      { type: "inlineMath", props: { latex: "x_1 x_2" } },
    ]);
  });

  it("金額の $ は数式にしない（markdown-math.ts と同じ判定）", () => {
    const { inlineContent } = parseInlineCitations("原料は $100 と $200 の 2 種類", emptyIndex);
    expect(inlineContent).toEqual([t("原料は $100 と $200 の 2 種類")]);
  });

  it("価格帯（$50-$75）も数式にしない（後ろの金額を落とさない）", () => {
    const { inlineContent } = parseInlineCitations("1 kg あたり $50-$75 で買える", emptyIndex);
    expect(inlineContent).toEqual([t("1 kg あたり $50-$75 で買える")]);
  });

  it("リンクの URL は対になった丸括弧を含められる（Wikipedia の Foo_(bar)）", () => {
    const { inlineContent } = parseInlineCitations(
      "[Seebeck](https://en.wikipedia.org/wiki/Seebeck_(disambiguation)) と [例](https://example.com) (補足)",
      emptyIndex,
    );
    expect(inlineContent).toEqual([
      { type: "link", href: "https://en.wikipedia.org/wiki/Seebeck_(disambiguation)", content: [t("Seebeck")] },
      t(" と "),
      { type: "link", href: "https://example.com", content: [t("例")] },
      t(" (補足)"),
    ]);
  });

  it("コードの中の $ は数式にしない", () => {
    const { inlineContent } = parseInlineCitations("`echo $HOME$` を実行", emptyIndex);
    expect(inlineContent).toEqual([t("echo $HOME$", { code: true }), t(" を実行")]);
  });

  it("太字の中の上付き・数式も戻す（書式は重ねる）", () => {
    const { inlineContent } = parseInlineCitations("**10<sup>5</sup> Pa と $p$**", emptyIndex);
    expect(inlineContent).toEqual([
      t("10", { bold: true }),
      t("5", { bold: true, superscript: true }),
      t(" Pa と ", { bold: true }),
      { type: "inlineMath", props: { latex: "p" } },
    ]);
  });

  it("リンクの文字の上付きは書式に戻し、数式は（リンクの中に置けないので）元の表記のまま残す", () => {
    const { inlineContent } = parseInlineCitations("[図 1<sup>a</sup> と $x$](https://example.com)", emptyIndex);
    expect(inlineContent).toEqual([
      {
        type: "link",
        href: "https://example.com",
        content: [t("図 1"), t("a", { superscript: true }), t(" と $x$")],
      },
    ]);
  });

  it("引用と数式が同じ行にあってもどちらも読む", () => {
    const noteIndex = [{ id: "n1", title: "熱電ノート" }];
    const { inlineContent, knowledgeLinks } = parseInlineCitations("$ZT$ は 1 を超えた [[熱電ノート]]", noteIndex);
    expect(inlineContent).toEqual([
      { type: "inlineMath", props: { latex: "ZT" } },
      t(" は 1 を超えた "),
      t("@熱電ノート", { textColor: "blue" }),
    ]);
    expect(knowledgeLinks).toHaveLength(1);
    expect(knowledgeLinks[0].targetNoteId).toBe("n1");
  });

  it("行の中の $$ … $$ はインライン数式として読む", () => {
    const { inlineContent } = parseInlineCitations("ここで $$\\int f$$ を使う", emptyIndex);
    expect(inlineContent).toEqual([
      t("ここで "),
      { type: "inlineMath", props: { latex: "\\int f" } },
      t(" を使う"),
    ]);
  });
});

describe("convertSectionsToBlocks（buildSourceTopicDocument 経由）- 数式ブロックと見出し", () => {
  const sources = [{ id: "note-a", title: "資料A" }];

  function bodyBlocks(markdown: string): any[] {
    const doc = buildSourceTopicDocument("話題タイトル", markdown, sources, null);
    const blocks = doc.pages[0].blocks as any[];
    const refIndex = blocks.findIndex((b) => b.type === "heading" && b.content?.[0]?.text === "References");
    return refIndex >= 0 ? blocks.slice(0, refIndex) : blocks;
  }

  it("$$ … $$ だけの行を数式ブロックにする", () => {
    const blocks = bodyBlocks("## 定義\n自由エネルギーは次の式で表す。\n$$ \\Delta G = \\Delta H - T\\Delta S $$");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "math"]);
    expect(blocks[2].props).toEqual({ latex: "\\Delta G = \\Delta H - T\\Delta S" });
  });

  it("複数行にまたがる $$ … $$ も 1 つの数式ブロックにする", () => {
    const blocks = bodyBlocks("## 定義\n$$\n\\sigma = n e \\mu\n$$\n説明の段落。");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "math", "paragraph"]);
    expect(blocks[1].props).toEqual({ latex: "\\sigma = n e \\mu" });
    expect(blocks[2].content).toEqual([t("説明の段落。")]);
  });

  it("見出しと箇条書きの上付き・下付き・数式も戻す", () => {
    const blocks = bodyBlocks("## H<sub>2</sub>O と $\\rho$\n- 10<sup>-3</sup> M で測る");
    expect(blocks[0].content).toEqual([
      t("H"),
      t("2", { subscript: true }),
      t("O と "),
      { type: "inlineMath", props: { latex: "\\rho" } },
    ]);
    expect(blocks[1].type).toBe("bulletListItem");
    expect(blocks[1].content).toEqual([
      t("10"),
      t("-3", { superscript: true }),
      t(" M で測る"),
    ]);
  });

  it("書式の無い本文は従来どおり（見出しは text 1 つ）", () => {
    const blocks = bodyBlocks("## 定義\nただの段落。");
    expect(blocks[0].content).toEqual([t("定義")]);
    expect(blocks[1].content).toEqual([t("ただの段落。")]);
  });
});
