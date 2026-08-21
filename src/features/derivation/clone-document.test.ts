import { describe, it, expect } from "vitest";
import {
  cloneBlocksWithIdMap,
  remapLabels,
  remapByBlockId,
  remapLinks,
  buildDerivedDocument,
  appendDerivedNoteLink,
} from "./clone-document";
import type { BlockLink } from "../block-link/link-types";
import type { GraphiumDocument } from "../../lib/document-types";

function makeLink(
  id: string,
  source: string,
  target: string,
  type: BlockLink["type"] = "informed_by",
): BlockLink {
  return {
    id,
    sourceBlockId: source,
    targetBlockId: target,
    type,
    layer: "prov",
    createdBy: "human",
  };
}

// ── cloneBlocksWithIdMap ──

describe("cloneBlocksWithIdMap", () => {
  it("flat な配列の各 block に新 ID を割り振り、idMap で旧→新 ID を返す", () => {
    const { blocks, idMap } = cloneBlocksWithIdMap([
      { id: "a", type: "paragraph" },
      { id: "b", type: "paragraph" },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).not.toBe("a");
    expect(blocks[1].id).not.toBe("b");
    expect(blocks[0].id).not.toBe(blocks[1].id);
    expect(idMap.get("a")).toBe(blocks[0].id);
    expect(idMap.get("b")).toBe(blocks[1].id);
  });

  it("ネストされた children も再帰的に新 ID を割り振る", () => {
    const { blocks, idMap } = cloneBlocksWithIdMap([
      { id: "p", type: "p", children: [{ id: "c1", type: "p" }, { id: "c2", type: "p" }] },
    ]);
    expect(idMap.size).toBe(3);
    expect(blocks[0].children).toHaveLength(2);
    expect(blocks[0].children[0].id).not.toBe("c1");
    expect(idMap.get("c1")).toBe(blocks[0].children[0].id);
  });

  it("元の blocks 配列・children 配列を破壊しない", () => {
    const original = [{ id: "a", children: [{ id: "a1" }] }];
    const before = JSON.stringify(original);
    cloneBlocksWithIdMap(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("type / props / content のフィールドはそのまま運ぶ", () => {
    const { blocks } = cloneBlocksWithIdMap([
      { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Hello" }] },
    ]);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].props).toEqual({ level: 2 });
    expect(blocks[0].content).toEqual([{ type: "text", text: "Hello" }]);
  });
});

// ── remapLabels ──

describe("remapLabels", () => {
  it("idMap に含まれる旧キーだけ新キーで持ち直す", () => {
    const out = remapLabels(
      { a: "procedure", b: "material", outside: "tool" },
      new Map([["a", "A"], ["b", "B"]]),
    );
    expect(out).toEqual({ A: "procedure", B: "material" });
  });

  it("空 / undefined を安全に扱う", () => {
    expect(remapLabels(undefined, new Map())).toEqual({});
    expect(remapLabels({}, new Map())).toEqual({});
  });
});

// ── remapByBlockId ──

describe("remapByBlockId", () => {
  it("任意の値を block ID キーで張り直す", () => {
    const attrs = { a: { checked: true }, b: { checked: false } };
    const out = remapByBlockId(attrs, new Map([["a", "A"]]));
    expect(out).toEqual({ A: { checked: true } });
  });
});

// ── remapLinks ──

describe("remapLinks", () => {
  it("両端が idMap に含まれるリンクを新 ID で複製する", () => {
    const links = [makeLink("l1", "a", "b"), makeLink("l2", "a", "outside")];
    const out = remapLinks(links, new Map([["a", "A"], ["b", "B"]]));
    expect(out).toHaveLength(1);
    expect(out[0].sourceBlockId).toBe("A");
    expect(out[0].targetBlockId).toBe("B");
    expect(out[0].id).not.toBe("l1"); // link id も新規採番
  });

  it("片端が外なら捨てる", () => {
    const out = remapLinks([makeLink("l1", "a", "outside")], new Map([["a", "A"]]));
    expect(out).toHaveLength(0);
  });

  it("layer / type / createdBy はそのまま継承", () => {
    const link: BlockLink = {
      id: "l1",
      sourceBlockId: "a",
      targetBlockId: "b",
      type: "used",
      layer: "prov",
      createdBy: "ai",
      targetNoteId: "n1",
    };
    const out = remapLinks([link], new Map([["a", "A"], ["b", "B"]]));
    expect(out[0].type).toBe("used");
    expect(out[0].layer).toBe("prov");
    expect(out[0].createdBy).toBe("ai");
    expect(out[0].targetNoteId).toBe("n1");
  });
});

// ── buildDerivedDocument ──

function mockDoc(): GraphiumDocument {
  return {
    version: 3,
    title: "Original",
    pages: [
      {
        id: "main",
        title: "Original",
        blocks: [
          { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step" }] },
          { id: "p", type: "paragraph", content: [{ type: "text", text: "Material A" }] },
        ],
        labels: { h: "procedure", p: "material" },
        provLinks: [makeLink("l1", "h", "p", "informed_by")],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildDerivedDocument", () => {
  it("ブロック / labels / provLinks をすべて新 ID で複製する", () => {
    const derived = buildDerivedDocument({
      sourceDoc: mockDoc(),
      sourceNoteId: "src-note",
      derivedTitle: "Derived",
      now: "2026-04-24T00:00:00.000Z",
    });

    const page = derived.pages[0];
    expect(derived.title).toBe("Derived");
    expect(derived.derivedFromNoteId).toBe("src-note");
    expect(derived.derivedFromBlockId).toBeUndefined();
    expect(page.blocks).toHaveLength(2);
    expect(page.blocks[0].id).not.toBe("h");
    expect(page.blocks[1].id).not.toBe("p");

    const newHId = page.blocks[0].id;
    const newPId = page.blocks[1].id;
    expect(page.labels).toEqual({ [newHId]: "procedure", [newPId]: "material" });
    expect(page.provLinks).toHaveLength(1);
    expect(page.provLinks[0].sourceBlockId).toBe(newHId);
    expect(page.provLinks[0].targetBlockId).toBe(newPId);
  });

  it("createdAt / modifiedAt / version を新規ノート扱いにする", () => {
    const derived = buildDerivedDocument({
      sourceDoc: mockDoc(),
      sourceNoteId: "src-note",
      derivedTitle: "Derived",
      now: "2026-04-24T00:00:00.000Z",
    });
    expect(derived.version).toBe(3);
    expect(derived.createdAt).toBe("2026-04-24T00:00:00.000Z");
    expect(derived.modifiedAt).toBe("2026-04-24T00:00:00.000Z");
  });

  it("元ドキュメントを破壊しない（pure）", () => {
    const src = mockDoc();
    const before = JSON.stringify(src);
    buildDerivedDocument({ sourceDoc: src, sourceNoteId: "src-note", derivedTitle: "X" });
    expect(JSON.stringify(src)).toBe(before);
  });

  it("複数ページのブロックとページ内メタデータをすべて複製する", () => {
    const src = mockDoc();
    src.pages[0].mediaInlineLabels = { p: { label: "material", entityId: "entity-p" } };
    src.pages[0].blockAlignments = { p: "center" };
    src.pages[0].mediaOcr = {
      p: { text: "OCR", confidence: 99, lang: "jpn", extractedAt: "2026-01-01T00:00:00.000Z" },
    };
    src.pages[0].highlights = [{
      id: "highlight-1",
      blockId: "p",
      from: 0,
      to: 3,
      label: "material",
      entityId: "entity-p",
      text: "Material A",
    }];
    src.pages[0].provLinks.push({
      ...makeLink("cross-page", "h", "p2"),
      targetPageId: "page-2",
    });
    src.pages.push({
      id: "page-2",
      title: "条件",
      derivedFromPageId: "main",
      derivedFromBlockId: "p",
      blocks: [{ id: "p2", type: "paragraph", content: [{ type: "text", text: "Second page" }] }],
      labels: { p2: "procedure" },
      provLinks: [],
      knowledgeLinks: [],
    });

    const derived = buildDerivedDocument({
      sourceDoc: src,
      sourceNoteId: "src-note",
      derivedTitle: "Derived",
    });

    expect(derived.pages).toHaveLength(2);
    expect(derived.pages[0].title).toBe("Derived");
    expect(derived.pages[1].title).toBe("条件");
    expect(derived.pages[1].id).not.toBe("page-2");
    expect(derived.pages[1].derivedFromPageId).toBe(derived.pages[0].id);
    expect(derived.pages[1].derivedFromBlockId).toBe(derived.pages[0].blocks[1].id);
    expect(derived.pages[1].blocks[0].id).not.toBe("p2");
    expect(derived.pages[1].labels).toEqual({
      [derived.pages[1].blocks[0].id]: "procedure",
    });
    const newPId = derived.pages[0].blocks[1].id;
    expect(derived.pages[0].mediaInlineLabels).toEqual({
      [newPId]: { label: "material", entityId: "entity-p" },
    });
    expect(derived.pages[0].blockAlignments).toEqual({ [newPId]: "center" });
    expect(derived.pages[0].mediaOcr).toEqual({
      [newPId]: { text: "OCR", confidence: 99, lang: "jpn", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(derived.pages[0].highlights?.[0]).toMatchObject({
      blockId: newPId,
      text: "Material A",
    });
    expect(derived.pages[0].provLinks.find((link) => link.targetPageId)?.targetPageId)
      .toBe(derived.pages[1].id);
  });

  it("tableMeta を新しい block ID で張り直す", () => {
    const src = mockDoc();
    src.pages[0].blocks.push({
      id: "tbl",
      type: "table",
      content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "名前", styles: {} }]] }] },
    });
    src.pages[0].tableMeta = {
      tbl: { caption: "試料の一覧", columns: { 名前: ["note-link"] }, noteLinks: { "A-1": "note-x" } },
    };

    const page = buildDerivedDocument({
      sourceDoc: src,
      sourceNoteId: "src-note",
      derivedTitle: "Derived",
    }).pages[0];

    const newTableId = page.blocks[2].id;
    expect(newTableId).not.toBe("tbl");
    expect(page.tableMeta).toEqual({
      [newTableId]: {
        caption: "試料の一覧",
        columns: { 名前: ["note-link"] },
        noteLinks: { "A-1": "note-x" },
      },
    });
  });

  it("旧 indexTables / logTables を持つノートからの派生でも注釈を引き継ぐ", () => {
    const src = mockDoc();
    src.pages[0].blocks.push({
      id: "tbl",
      type: "table",
      content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "日時", styles: {} }]] }] },
    });
    src.pages[0].logTables = { tbl: { name: "頭痛ダイアリー" } };
    src.pages[0].indexTables = { tbl: { "2026-08-13 10:00": "note-y" } };

    const page = buildDerivedDocument({
      sourceDoc: src,
      sourceNoteId: "src-note",
      derivedTitle: "Derived",
    }).pages[0];

    const newTableId = page.blocks[2].id;
    expect(page.tableMeta).toEqual({
      [newTableId]: {
        caption: "頭痛ダイアリー",
        columns: { 日時: ["datetime-auto", "note-link"] },
        noteLinks: { "2026-08-13 10:00": "note-y" },
      },
    });
    // 派生ノートは新形式だけを持つ
    expect(page.logTables).toBeUndefined();
    expect(page.indexTables).toBeUndefined();
  });
});

// ── appendDerivedNoteLink ──

describe("appendDerivedNoteLink", () => {
  it("既存 noteLinks を保ったまま derived_from を追加する", () => {
    const out = appendDerivedNoteLink(
      [{ targetNoteId: "n1", sourceBlockId: "b1", type: "derived_from" }],
      "new-note",
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ targetNoteId: "new-note", sourceBlockId: "", type: "derived_from" });
  });

  it("undefined / 空配列でも動く", () => {
    expect(appendDerivedNoteLink(undefined, "new")).toHaveLength(1);
    expect(appendDerivedNoteLink([], "new")).toHaveLength(1);
  });
});
