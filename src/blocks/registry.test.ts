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

import {
  customBlockEntries,
  CUSTOM_BLOCK_TYPES,
  KNOWN_BLOCK_TYPES,
} from "./registry";

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

  it("step コンテナが登録されている", () => {
    // step は children を持つため、除去されると子孫ごとデータが失われる
    expect(CUSTOM_BLOCK_TYPES.has("step")).toBe(true);
    expect(KNOWN_BLOCK_TYPES.has("step")).toBe(true);
    expect(customBlockEntries.some((b) => b.type === "step")).toBe(true);
  });

  it("既存のカスタムブロックも維持されている", () => {
    for (const type of ["callout", "bookmark", "pdf"]) {
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true);
    }
  });

  it("標準ブロック型（step の子になりうるもの）を含む", () => {
    for (const type of ["paragraph", "heading", "table", "image", "codeBlock"]) {
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true);
    }
  });

  it("未知のブロック型は含まない（除去対象のまま）", () => {
    expect(KNOWN_BLOCK_TYPES.has("sampleScope")).toBe(false);
  });

  it("登録エントリに重複した type が無い", () => {
    const types = customBlockEntries.map((b) => b.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

// sanitizeBlocks は note-app.tsx / side-peek.tsx 内の private 関数なので直接は呼べない。
// ここでは同じ判定（KNOWN_BLOCK_TYPES による filter ＋ children 再帰）を再現し、
// step とその子孫が保持されることを確認する。実関数と同じ集合を参照しているので、
// 登録漏れが起きればこのテストも落ちる。
function sanitizeLike(blocks: any[]): any[] {
  return blocks
    .filter((b) => KNOWN_BLOCK_TYPES.has(b.type))
    .map((b) => ({
      ...b,
      children: b.children?.length ? sanitizeLike(b.children) : b.children,
    }));
}

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
});
