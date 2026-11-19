import { afterEach, describe, expect, it } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { syncLocale } from "../../i18n";
import { stripMemoTraces } from "./strip-memo-traces";

const blue = (text: string) => ({ type: "text", text, styles: { textColor: "blue" } });
const plain = (text: string) => ({ type: "text", text, styles: {} });
const link = (sourceBlockId: string, targetNoteId: string) => ({
  id: `${sourceBlockId}-${targetNoteId}`,
  sourceBlockId,
  targetBlockId: "",
  targetNoteId,
  type: "reference",
  layer: "knowledge",
  createdBy: "ai",
});
const para = (id: string, ...content: unknown[]) => ({ id, type: "paragraph", content, children: [] });

function makeDoc(page: Record<string, unknown>, overrides: Record<string, unknown> = {}): GraphiumDocument {
  return {
    version: 5,
    title: "t",
    createdAt: "2026-11-19T00:00:00Z",
    modifiedAt: "2026-11-19T00:00:00Z",
    pages: [{ id: "p", title: "t", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [], ...page }],
    ...overrides,
  } as unknown as GraphiumDocument;
}
const textsOf = (doc: GraphiumDocument, index = 0) =>
  (doc.pages[0].blocks[index] as any).content.map((c: any) => c.text);

afterEach(() => syncLocale("en"));

describe("stripMemoTraces — 引用の表示", () => {
  it("リンクの順と表示の順が違っても、メモの題を残さない", () => {
    const out = stripMemoTraces(
      makeDoc({
        blocks: [para("b1", blue("@実験メモ"), plain(" と "), blue("@別ノート"))],
        knowledgeLinks: [link("b1", "note-xyz"), link("b1", "memo:abc")],
      }),
    );
    expect(JSON.stringify(out.pages[0].blocks)).not.toContain("実験メモ");
  });

  it("参考文献の行で別ノートと分かる題は、メモと同じブロックでも残す", () => {
    const out = stripMemoTraces(
      makeDoc({
        blocks: [
          para("b1", blue("@実験メモ"), plain(" と "), blue("@別ノート")),
          para("r1", blue("@実験メモ")),
          para("r2", blue("@別ノート")),
        ],
        knowledgeLinks: [
          link("b1", "note-xyz"),
          link("b1", "memo:abc"),
          link("r1", "memo:abc"),
          link("r2", "note-xyz"),
        ],
      }),
    );
    expect(textsOf(out)).toEqual(["@Memo", " と ", "@別ノート"]);
    expect(textsOf(out, 1)).toEqual(["@Memo"]);
    expect(textsOf(out, 2)).toEqual(["@別ノート"]);
  });

  it("リンク元のブロックが本文に無くても、メモの題を残さない", () => {
    const out = stripMemoTraces(
      makeDoc({ blocks: [para("bNEW", blue("@実験メモ"))], knowledgeLinks: [link("bOLD", "memo:abc")] }),
    );
    expect(textsOf(out)).toEqual(["@Memo"]);
    expect(out.pages[0].knowledgeLinks).toEqual([]);
  });

  it("メモと同じ題の別ノートへの引用は、そのまま残す", () => {
    const out = stripMemoTraces(
      makeDoc({
        blocks: [para("b1", blue("@実験メモ")), para("b2", blue("@実験メモ"))],
        knowledgeLinks: [link("b1", "memo:abc"), link("b2", "note-xyz")],
      }),
    );
    expect(textsOf(out)).toEqual(["@Memo"]);
    expect(textsOf(out, 1)).toEqual(["@実験メモ"]);
  });

  it("provLinks だけがメモを指すときも、題を残さない", () => {
    const out = stripMemoTraces(
      makeDoc({ blocks: [para("b1", blue("@メモの 1 行目"))], provLinks: [link("b1", "memo:abc")] }),
    );
    expect(textsOf(out)).toEqual(["@Memo"]);
    expect(out.pages[0].provLinks).toEqual([]);
  });

  it("リンクが消えていても、メモが資料のページではリンクの無い題を残さない", () => {
    const out = stripMemoTraces(
      makeDoc(
        { blocks: [para("b1", blue("@実験メモ"))] },
        { wikiMeta: { kind: "claim", derivedFromNotes: ["memo:abc"], derivedFromChats: [] } },
      ),
    );
    expect(textsOf(out)).toEqual(["@Memo"]);
  });

  it("表のセルと子ブロックの題も置き換える", () => {
    const table = {
      id: "t1",
      type: "table",
      content: { type: "tableContent", rows: [{ cells: [[blue("@実験メモ")], { type: "tableCell", content: [blue("@実験メモ")] }] }] },
      children: [],
    };
    const out = stripMemoTraces(
      makeDoc({ blocks: [{ ...para("b0"), children: [table] }], knowledgeLinks: [link("t1", "memo:abc")] }),
    );
    expect(JSON.stringify(out.pages[0].blocks)).not.toContain("実験メモ");
  });

  it("wikiMeta の無いノートは、画面の言語に合わせて @メモ にする", () => {
    syncLocale("ja");
    const out = stripMemoTraces(
      makeDoc({ blocks: [para("b1", blue("@実験メモ"))], knowledgeLinks: [link("b1", "memo:abc")] }),
    );
    expect(textsOf(out)).toEqual(["@メモ"]);
  });
});

describe("stripMemoTraces — 編集の来歴", () => {
  const provenance = (contentDiff: unknown[]) => ({
    agents: [],
    activities: [],
    revisions: [
      {
        id: "r1",
        savedAt: "",
        contentHash: "h",
        wasGeneratedBy: "a1",
        summary: { blocksAdded: 1, blocksRemoved: 0, blocksModified: 0, labelsChanged: [], contentDiff },
      },
    ],
  });

  it("メモをたどれるページでは、ブロックの全文を持つ差分を渡さない", () => {
    const out = stripMemoTraces(
      makeDoc(
        { blocks: [para("b1", blue("@実験メモ"))], knowledgeLinks: [link("b1", "memo:abc")] },
        { documentProvenance: provenance([{ blockId: "b1", type: "add", after: "Source: @実験メモ" }]) },
      ),
    );
    expect(JSON.stringify(out)).not.toContain("実験メモ");
    expect(out.documentProvenance!.revisions[0].summary.blocksAdded).toBe(1);
    expect("contentDiff" in out.documentProvenance!.revisions[0].summary).toBe(false);
  });

  it("メモの引用を持つノートでも、差分を渡さない", () => {
    const out = stripMemoTraces(
      makeDoc(
        { memoQuotes: { q1: { captureId: "abc", quotedAt: "", quotedText: "下書き" } } },
        { documentProvenance: provenance([{ blockId: "q1", type: "remove", before: "下書き" }]) },
      ),
    );
    expect(JSON.stringify(out)).not.toContain("下書き");
  });

  it("メモと関係のないページの差分は残す", () => {
    const doc = makeDoc(
      { blocks: [para("b1", plain("本文"))] },
      { documentProvenance: provenance([{ blockId: "b1", type: "add", after: "本文" }]) },
    );
    expect(stripMemoTraces(doc)).toBe(doc);
  });
});

describe("stripMemoTraces — wikiMeta", () => {
  it("procedureContext.derivedFromNotes の memo: を外し、原文を写した欄も外す", () => {
    const out = stripMemoTraces(
      makeDoc(
        {},
        {
          wikiMeta: {
            kind: "claim",
            derivedFromNotes: ["note-1"],
            derivedFromChats: [],
            evidenceSpan: "メモの一文",
            procedureContext: { derivedFromNotes: ["memo:abc", "note-1"], keyTools: ["オーブン"] },
          },
        },
      ),
    );
    expect(out.wikiMeta!.procedureContext).toEqual({ derivedFromNotes: ["note-1"], keyTools: ["オーブン"] });
    expect(out.wikiMeta!.evidenceSpan).toBeUndefined();
  });

  it("一節に ] を含む引用も、ほかの引用を巻き込まずに外す", () => {
    const out = stripMemoTraces(
      makeDoc(
        {},
        {
          wikiMeta: {
            kind: "topic",
            derivedFromNotes: ["memo:abc", "note-1"],
            derivedFromChats: [],
            topicMarkdown: "A[[source:memo:abc|see [14]]] B[[source:note-1|keep [2]]] C",
          },
        },
      ),
    );
    expect(out.wikiMeta!.topicMarkdown).toBe("A B[[source:note-1|keep [2]]] C");
  });
});

describe("stripMemoTraces — 入力を変えない", () => {
  it("渡した doc は変更しない", () => {
    const doc = makeDoc({ blocks: [para("b1", blue("@実験メモ"))], knowledgeLinks: [link("b1", "memo:abc")] });
    const before = JSON.stringify(doc);
    stripMemoTraces(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
