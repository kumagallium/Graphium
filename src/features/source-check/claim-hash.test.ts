import { describe, expect, it } from "vitest";
import { claimHashBody, computeClaimHash } from "./claim-hash";
import { extractPlainTextFromDoc } from "../wiki/wiki-service";
import type { GraphiumDocument } from "../../lib/document-types";

function docWithBlocks(blocks: any[]): GraphiumDocument {
  return {
    version: 2,
    title: "知見",
    pages: [{ id: "p1", title: "Main", blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

describe("claimHashBody - 照合済みページの指紋は v1 の抽出に固定する", () => {
  // リンク・数式・上付き・数式ブロックを含む知見。AI に渡す本文はこれらを保つようになったが、
  // 指紋が変わると照合済みのページが本文を触らずに「本文が変わった」扱いになる
  const blocks = [
    {
      id: "b1",
      type: "paragraph",
      content: [
        { type: "text", text: "圧力 10", styles: {} },
        { type: "text", text: "5", styles: { superscript: true } },
        { type: "text", text: " Pa で ", styles: {} },
        { type: "inlineMath", props: { latex: "\\Delta G" } },
        { type: "text", text: " が負になる（", styles: {} },
        { type: "link", href: "https://example.com", content: [{ type: "text", text: "出典", styles: {} }] },
        { type: "text", text: "）", styles: {} },
      ],
      children: [],
    },
    { id: "b2", type: "math", props: { latex: "E = mc^2" }, children: [] },
  ];

  it("v1 と同じ文字列を返す（リンクは [object Object]・数式と上付きは見ない・数式ブロックは空）", () => {
    expect(claimHashBody(docWithBlocks(blocks))).toBe("圧力 105 Pa で  が負になる（[object Object]）");
  });

  it("AI に渡す本文とは別物になる（本文側は上付き・数式・リンクの文字を保つ）", () => {
    const doc = docWithBlocks(blocks);
    expect(extractPlainTextFromDoc(doc)).toBe(
      "圧力 10<sup>5</sup> Pa で $\\Delta G$ が負になる（出典）\n$$ E = mc^2 $$",
    );
    expect(claimHashBody(doc)).not.toBe(extractPlainTextFromDoc(doc));
  });

  it("文字だけの本文なら AI に渡す本文と同じ（ほとんどの既存ページはどちらでも同じ値）", () => {
    const doc = docWithBlocks([
      { id: "b1", type: "paragraph", content: [{ type: "text", text: "本文の段落", styles: {} }], children: [] },
      { id: "b2", type: "bulletListItem", content: [{ type: "text", text: "箇条書き", styles: {} }], children: [] },
    ]);
    expect(claimHashBody(doc)).toBe("本文の段落\n箇条書き");
    expect(claimHashBody(doc)).toBe(extractPlainTextFromDoc(doc));
  });
});

describe("computeClaimHash", () => {
  it("sha256: プレフィックス付きの決定的な文字列を返す", async () => {
    const h1 = await computeClaimHash("タイトル", "本文");
    const h2 = await computeClaimHash("タイトル", "本文");
    expect(h1).toBe(h2);
    expect(h1.startsWith("sha256:")).toBe(true);
  });

  it("本文が変わればハッシュも変わる", async () => {
    const before = await computeClaimHash("タイトル", "本文A");
    const after = await computeClaimHash("タイトル", "本文B");
    expect(before).not.toBe(after);
  });

  it("タイトルが変わればハッシュも変わる", async () => {
    const before = await computeClaimHash("タイトルA", "本文");
    const after = await computeClaimHash("タイトルB", "本文");
    expect(before).not.toBe(after);
  });

  it("区切り文字を挟むことで title/body の境界が異なる組み合わせと衝突しない", async () => {
    // "AB" + "" と "A" + "B" のような境界のずれが、区切り無しの単純結合だと衝突しうる
    const a = await computeClaimHash("AB", "");
    const b = await computeClaimHash("A", "B");
    expect(a).not.toBe(b);
  });
});
