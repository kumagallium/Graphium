// カスタムブロック登録の回帰ガード
//
// note-app.tsx / side-peek.tsx の sanitizeBlocks は KNOWN_BLOCK_TYPES に無いブロックを
// 除去し、その結果をそのまま自動保存する。つまり登録漏れ＝ユーザーのデータ損失。
// children を持つブロック（step）では、親が除去されると子孫（表・画像・コード）も
// まとめて消えるため損失が特に大きい。
// 「登録したつもりで漏れていた」を構造的に検出するためのテスト。

import { describe, it, expect, vi } from "vitest";

// registry は pdf-viewer 経由で react-pdf（canvas/DOMMatrix 前提）を読み込むため、
// node 環境のテストでは描画まわりだけモックする。検証したいのは型の登録であって
// PDF 描画ではない。
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../lib/pdfjs-config", () => ({}));

import { defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { inlineLabelStyleSpecs } from "../features/inline-label/styles";
import {
  customBlockEntries,
  CUSTOM_BLOCK_TYPES,
  KNOWN_BLOCK_TYPES,
  CUSTOM_INLINE_TYPES,
  KNOWN_INLINE_TYPES,
  KNOWN_STYLE_KEYS,
  sanitizeBlocksForLoad,
} from "./registry";
import { blockMarkdownConverters } from "./markdown";

describe("block registry", () => {
  it("すべてのカスタムブロックが CUSTOM_BLOCK_TYPES に入る", () => {
    for (const entry of customBlockEntries) {
      expect(CUSTOM_BLOCK_TYPES.has(entry.type)).toBe(true);
    }
  });

  it("すべてのカスタムブロックが KNOWN_BLOCK_TYPES に入る（除去されない）", () => {
    // ここが落ちたら、そのブロックは保存済みノートから除去されて自動保存される
    for (const entry of customBlockEntries) {
      expect(KNOWN_BLOCK_TYPES.has(entry.type)).toBe(true);
    }
  });

  it("sharedCitation（shared:// 引用カード）が登録されている", () => {
    // 登録漏れは、引用入りノートを開いた瞬間にカードが除去され自動保存で恒久消失する
    expect(CUSTOM_BLOCK_TYPES.has("sharedCitation")).toBe(true);
    expect(KNOWN_BLOCK_TYPES.has("sharedCitation")).toBe(true);
  });

  it("step コンテナが登録されている", () => {
    // step は children を持つため、除去されると子孫ごとデータが失われる
    expect(CUSTOM_BLOCK_TYPES.has("step")).toBe(true);
    expect(KNOWN_BLOCK_TYPES.has("step")).toBe(true);
    expect(customBlockEntries.some((b) => b.type === "step")).toBe(true);
  });

  it("マルチカラム（columnList / column）が両方登録されている", () => {
    // columnList と column は 2 型セット。どちらか一方でも漏れると
    // sanitizeBlocks がカラムを children ごと除去し、カラム内の
    // 全ブロック（本文・表・画像）が道連れで消える。
    for (const type of ["columnList", "column"]) {
      expect(CUSTOM_BLOCK_TYPES.has(type)).toBe(true);
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true);
      expect(customBlockEntries.some((b) => b.type === type)).toBe(true);
    }
  });

  it("既存のカスタムブロックも維持されている", () => {
    for (const type of ["callout", "bookmark", "pdf"]) {
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true);
    }
  });

  it("すべてのカスタムブロックが Markdown 変換を持つ", () => {
    // ここが落ちたら、そのブロックは Markdown 書き出しで未知ブロック扱いになる。
    // content: "none" のブロック（チャート・計算・PDF 等）は本文テキストを
    // 持たないので、書き出しから跡形もなく消える。
    // 実際 calc は変換が無いまま、pdf は型名を "pdfViewer" と綴り違えたまま
    // 出荷されていた（どちらもテストが無かったので気づけなかった）。
    for (const entry of customBlockEntries) {
      expect(
        Object.keys(blockMarkdownConverters),
        `${entry.type} の to-markdown.ts を blocks/markdown.ts に登録すること`,
      ).toContain(entry.type);
    }
  });

  it("Markdown 変換レジストリに未登録型が紛れていない", () => {
    // 綴り違い（"pdfViewer"）がここで落ちる
    for (const type of Object.keys(blockMarkdownConverters)) {
      expect(CUSTOM_BLOCK_TYPES.has(type), `${type} は登録済みのブロック型ではない`).toBe(true);
    }
  });

  it("標準ブロック型（step の子になりうるもの）を含む", () => {
    for (const type of ["paragraph", "heading", "table", "image", "codeBlock"]) {
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true);
    }
  });

  it("BlockNote の全デフォルトブロック型が KNOWN_BLOCK_TYPES に入る（除去されない）", () => {
    // エディタのスキーマ（base/editor.tsx）は defaultBlockSpecs を丸ごと使う。
    // つまりスキーマで作成・保存できる型は、読み込み時も全て既知でなければ
    // ならない。実際に divider / toggleListItem が手書きリストから漏れて、
    // /div で挿入した区切り線が「保存→再オープン」で消える事故が起きた。
    for (const type of Object.keys(defaultBlockSpecs)) {
      expect(KNOWN_BLOCK_TYPES.has(type), `default block "${type}" が未登録`).toBe(true);
    }
  });

  it("divider / toggleListItem が登録されている（読込消失の回帰ガード）", () => {
    expect(KNOWN_BLOCK_TYPES.has("divider")).toBe(true);
    expect(KNOWN_BLOCK_TYPES.has("toggleListItem")).toBe(true);
  });

  it("未知のブロック型は含まない（除去対象のまま）", () => {
    expect(KNOWN_BLOCK_TYPES.has("sampleScope")).toBe(false);
  });

  it("登録エントリに重複した type が無い", () => {
    const types = customBlockEntries.map((b) => b.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe("inline registry", () => {
  it("カスタムインライン型が KNOWN_INLINE_TYPES に入る（除去されない）", () => {
    // ここが落ちたら、そのインライン要素は本文から静かに消えて自動保存される
    for (const type of CUSTOM_INLINE_TYPES) {
      expect(KNOWN_INLINE_TYPES.has(type)).toBe(true);
    }
  });

  it("インライン数式が登録されている", () => {
    // 実際にここが漏れていて、取り込んだ論文の本文から数式だけが消えた
    expect(KNOWN_INLINE_TYPES.has("inlineMath")).toBe(true);
  });

  it("標準のインライン型（text / link）を含む", () => {
    expect(KNOWN_INLINE_TYPES.has("text")).toBe(true);
    expect(KNOWN_INLINE_TYPES.has("link")).toBe(true);
  });

  it("未知のインライン型は含まない（除去対象のまま）", () => {
    expect(KNOWN_INLINE_TYPES.has("mention")).toBe(false);
  });
});

// sanitizeBlocks は note-app.tsx / side-peek.tsx 内の private 関数なので直接は呼べない。
// ここでは同じ判定（KNOWN_BLOCK_TYPES による filter ＋ children 再帰）を再現し、
// step とその子孫が保持されることを確認する。実関数と同じ集合を参照しているので、
// 登録漏れが起きればこのテストも落ちる。
// 実物の読み込みサニタイザ（note-app / SidePeek が使うのと同じ実装）
const sanitizeLike = (blocks: any[]) => sanitizeBlocksForLoad(blocks);

describe("sanitize 相当の挙動（step のデータ保護）", () => {
  const stepWithChildren = {
    id: "s1",
    type: "step",
    content: [{ type: "text", text: "反応 A を実施する", styles: {} }],
    children: [
      { id: "c1", type: "paragraph", content: [], children: [] },
      { id: "c2", type: "table", content: { type: "tableContent", rows: [] }, children: [] },
      { id: "c3", type: "image", props: { url: "x" }, children: [] },
      { id: "c4", type: "codeBlock", content: [], children: [] },
    ],
  };

  it("step が除去されず、子孫もすべて残る", () => {
    const out = sanitizeLike([stepWithChildren]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("step");
    expect(out[0].children.map((c: any) => c.type)).toEqual([
      "paragraph",
      "table",
      "image",
      "codeBlock",
    ]);
  });

  it("step の子にある未知ブロックだけが除去される", () => {
    const out = sanitizeLike([
      {
        ...stepWithChildren,
        children: [
          { id: "c1", type: "paragraph", children: [] },
          { id: "cx", type: "sampleScope", children: [] },
        ],
      },
    ]);
    expect(out[0].children.map((c: any) => c.type)).toEqual(["paragraph"]);
  });

  it("divider が保存→読込サニタイズで温存される", () => {
    // divider は content も children も持たないため、未知型扱いされると
    // 「子の持ち上げ」でも何も残らず跡形なく消える（実際に起きた症状）
    const out = sanitizeLike([
      { id: "p1", type: "paragraph", content: [], children: [] },
      { id: "d1", type: "divider", props: {}, children: [] },
      { id: "p2", type: "paragraph", content: [], children: [] },
    ]);
    expect(out.map((b: any) => b.type)).toEqual(["paragraph", "divider", "paragraph"]);
  });

  it("toggleListItem が children ごと温存される", () => {
    const out = sanitizeLike([
      {
        id: "t1",
        type: "toggleListItem",
        content: [{ type: "text", text: "トグル", styles: {} }],
        children: [{ id: "p1", type: "paragraph", content: [], children: [] }],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("toggleListItem");
    expect(out[0].children.map((c: any) => c.type)).toEqual(["paragraph"]);
  });

  it("入れ子の step も保持される", () => {
    const out = sanitizeLike([
      {
        id: "outer",
        type: "step",
        children: [{ id: "inner", type: "step", children: [{ id: "p", type: "paragraph" }] }],
      },
    ]);
    expect(out[0].children[0].type).toBe("step");
    expect(out[0].children[0].children[0].type).toBe("paragraph");
  });

  it("未知のコンテナ型は children を持ち上げて温存する（道連れ削除しない）", () => {
    const out = sanitizeLike([
      {
        id: "u1",
        type: "futureContainer",
        children: [{ id: "p", type: "paragraph", children: [] }],
      },
    ]);
    expect(out.map((b: any) => b.type)).toEqual(["paragraph"]);
  });
});

describe("sanitize のカラム構造修復（不正構造で BlockNoteEditor.create が throw しない形にする）", () => {
  const para = (id: string) => ({ id, type: "paragraph", children: [] });

  it("正常な 2 カラムはそのまま保持される", () => {
    const out = sanitizeLike([
      {
        id: "cl",
        type: "columnList",
        children: [
          { id: "c1", type: "column", children: [para("p1")] },
          { id: "c2", type: "column", children: [para("p2")] },
        ],
      },
    ]);
    expect(out[0].type).toBe("columnList");
    expect(out[0].children.map((c: any) => c.type)).toEqual(["column", "column"]);
  });

  it("唯一の子が未知型で空になったカラムは drop され、columnList が解消される", () => {
    // column の content は blockContainer+（空を許さない）、columnList は
    // column column+（2 本以上）。修復しないと initialContent で throw する
    const out = sanitizeLike([
      {
        id: "cl",
        type: "columnList",
        children: [
          { id: "c1", type: "column", children: [{ id: "u", type: "futureBlock", children: [] }] },
          { id: "c2", type: "column", children: [para("p2")] },
        ],
      },
    ]);
    // c1 は空になり drop → 単一カラムの columnList は解消され中身が持ち上がる
    expect(out.map((b: any) => b.type)).toEqual(["paragraph"]);
    expect(out[0].id).toBe("p2");
  });

  it("カラムが全滅した columnList は丸ごと消える", () => {
    const out = sanitizeLike([
      {
        id: "cl",
        type: "columnList",
        children: [
          { id: "c1", type: "column", children: [{ id: "u1", type: "futureBlock", children: [] }] },
          { id: "c2", type: "column", children: [{ id: "u2", type: "futureBlock", children: [] }] },
        ],
      },
      para("after"),
    ]);
    expect(out.map((b: any) => b.type)).toEqual(["paragraph"]);
    expect(out[0].id).toBe("after");
  });

  it("columnList 直下の column 以外の子は外に持ち上げる", () => {
    const out = sanitizeLike([
      {
        id: "cl",
        type: "columnList",
        children: [
          { id: "c1", type: "column", children: [para("p1")] },
          { id: "c2", type: "column", children: [para("p2")] },
          para("stray"),
        ],
      },
    ]);
    expect(out.map((b: any) => b.type)).toEqual(["columnList", "paragraph"]);
    expect(out[0].children).toHaveLength(2);
    expect(out[1].id).toBe("stray");
  });
});

describe("KNOWN_STYLE_KEYS と未知 style の除去", () => {
  // BlockNote は styleSchema に無い style キーで throw する（silent drop ではない）。
  // 未来のビルドが新しい永続 style を保存しても、このビルドがノートを開けることを保証する。

  it("schema に渡す全 style（default + inline label）が既知集合に入る", () => {
    for (const key of Object.keys(defaultStyleSpecs)) {
      expect(KNOWN_STYLE_KEYS.has(key), `default style ${key}`).toBe(true);
    }
    for (const key of Object.keys(inlineLabelStyleSpecs)) {
      expect(KNOWN_STYLE_KEYS.has(key), `custom style ${key}`).toBe(true);
    }
  });

  it("tableRowIdentity が既知集合に入る（読込で剥がされない）", () => {
    expect(KNOWN_STYLE_KEYS.has("tableRowIdentity")).toBe(true);
  });

  it("段落 inline の未知 style キーだけを剥がし、既知 style は残す", () => {
    const out = sanitizeLike([
      {
        id: "p1",
        type: "paragraph",
        content: [
          { type: "text", text: "hello", styles: { bold: true, futureStyle: "x" } },
        ],
        children: [],
      },
    ]);
    expect(out[0].content[0].styles).toEqual({ bold: true });
  });

  it("テーブルセル内 inline の未知 style キーを剥がす（link のネストも含む）", () => {
    const out = sanitizeLike([
      {
        id: "t1",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            {
              cells: [
                [{ type: "text", text: "行A", styles: { tableRowIdentity: "row_1", futureStyle: "x" } }],
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "link",
                      href: "https://example.com",
                      styles: { futureStyle: "y" },
                      content: [{ type: "text", text: "リンク", styles: { futureStyle: "z", italic: true } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        children: [],
      },
    ]);
    const rows = out[0].content.rows;
    expect(rows[0].cells[0][0].styles).toEqual({ tableRowIdentity: "row_1" });
    const link = rows[0].cells[1].content[0];
    expect(link.styles).toEqual({});
    expect(link.content[0].styles).toEqual({ italic: true });
  });

  it("未知 style が無いブロックはオブジェクト同一性を保つ（無駄な再構築をしない）", () => {
    const content = [{ type: "text", text: "そのまま", styles: { bold: true } }];
    const out = sanitizeLike([
      { id: "p1", type: "paragraph", content, children: [] },
    ]);
    expect(out[0].content).toBe(content);
  });
});
