import { describe, expect, it } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { buildNoteProvJsonLdText } from "../prov-export/note-jsonld-text";
import { stripUnsharedSources } from "./strip-memo-traces";
import {
  MAX_SOURCES_TO_CHECK,
  collectReferencedSourceIds,
  confirmUnsharedSources,
  decideHiddenSources,
  resolveUnsharedSourceIds,
} from "./unshared-sources";

const t = (key: string, vars?: Record<string, string>) => `${key}:${vars?.count ?? ""}`;

/** 共有していないノート「priv」と共有済みのノート「pub」から作ったトピック */
function topicDoc(): GraphiumDocument {
  return {
    version: 2,
    title: "トピック",
    pages: [
      {
        id: "main",
        title: "トピック",
        labels: {},
        provLinks: [],
        blocks: [
          {
            id: "b1",
            type: "paragraph",
            props: {},
            content: [
              { type: "text", text: "要約の文。", styles: {} },
              { type: "text", text: "@未共有の仮説", styles: { textColor: "blue" } },
            ],
            children: [],
          },
          {
            id: "b2",
            type: "paragraph",
            props: {},
            content: [{ type: "text", text: "@共有済みの記録", styles: { textColor: "blue" } }],
            children: [],
          },
        ],
        knowledgeLinks: [
          { id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "priv", type: "reference", layer: "knowledge", createdBy: "ai", targetQuote: "未共有ノートの一節" },
          { id: "l2", sourceBlockId: "b2", targetBlockId: "", targetNoteId: "pub", type: "reference", layer: "knowledge", createdBy: "ai", targetQuote: "共有済みの一節" },
        ],
      },
    ],
    wikiMeta: {
      kind: "topic",
      derivedFromNotes: ["priv", "pub", "memo:m1"],
      derivedFromChats: [],
      generatedAt: "2026-11-24T00:00:00Z",
      generatedBy: { model: "m", version: "1" },
      language: "ja",
      evidenceSpan: "原文の写し",
      topicMarkdown: "要約の文。[[source:priv|未共有ノートの一節]] 別の文。[[source:pub|共有済みの一節]]",
      passageContexts: [
        { sourceId: "priv", passage: "未共有ノートの一節", before: "前の文", after: "後の文" },
        { sourceId: "pub", passage: "共有済みの一節" },
      ],
    },
  } as unknown as GraphiumDocument;
}

describe("collectReferencedSourceIds", () => {
  it("リンク・資料・一節・引用から id を重複なく集め、自分とメモは除く", () => {
    const doc = topicDoc();
    doc.noteLinks = [{ targetNoteId: "linked", sourceBlockId: "b1", type: "derived_from" }];
    expect(collectReferencedSourceIds(doc, ["self"])).toEqual(["priv", "pub", "linked"]);
    expect(collectReferencedSourceIds(doc, ["priv"])).toEqual(["pub", "linked"]);
  });
});

describe("resolveUnsharedSourceIds", () => {
  const docs: Record<string, GraphiumDocument | null> = {
    pub: { sharedRef: { id: "s-pub" } } as unknown as GraphiumDocument,
    other: { sharedRef: { id: "s-other" } } as unknown as GraphiumDocument,
    priv: {} as GraphiumDocument,
  };
  const deps = {
    loadDoc: async (id: string) => {
      if (id === "boom") throw new Error("read failed");
      return docs[id] ?? null;
    },
    entryRoots: { "s-pub": "/lab", "s-other": "/dept" },
  };

  it("共有先と同じフォルダにある共有だけを「ある」に数える", async () => {
    const got = await resolveUnsharedSourceIds(["pub", "other", "priv", "pdf:abc", "boom"], "/lab", deps);
    expect([...got].sort()).toEqual(["boom", "other", "pdf:abc", "priv"]);
  });

  it("上限を超えた分は開かずに「無い」に数える", async () => {
    const ids = Array.from({ length: MAX_SOURCES_TO_CHECK + 2 }, () => "pub").map((v, i) => (i < MAX_SOURCES_TO_CHECK ? v : `x${i}`));
    const got = await resolveUnsharedSourceIds(ids, "/lab", deps);
    expect(got.size).toBe(2);
  });
});

describe("confirmUnsharedSources", () => {
  it("無ければ聞かずに keep", async () => {
    let asked = false;
    expect(await confirmUnsharedSources(new Set(), true, t, () => ((asked = true), "confirm"))).toBe("keep");
    expect(asked).toBe(false);
  });

  it("3 択の答えを決めに読み替える", async () => {
    const ids = new Set(["a", "b"]);
    let message = "";
    expect(await confirmUnsharedSources(ids, true, t, (m) => ((message = m), "confirm"))).toBe("strip");
    expect(message).toBe("share.unsharedSources.knowledge:2");
    expect(await confirmUnsharedSources(ids, false, t, () => "secondary")).toBe("keep");
    expect(await confirmUnsharedSources(ids, false, t, () => "cancel")).toBe("cancel");
  });
});

describe("stripUnsharedSources", () => {
  it("共有していない資料の一節・題・リンクを外し、共有済みは残す", () => {
    const doc = topicDoc();
    const out = stripUnsharedSources(doc, new Set(["priv"]));
    const json = JSON.stringify(out);
    expect(json).not.toContain("未共有ノートの一節");
    expect(json).not.toContain("未共有の仮説");
    expect(json).not.toContain("前の文");
    expect(json).not.toContain("原文の写し");
    expect(json).toContain("共有済みの一節");
    expect(json).toContain("@共有済みの記録");
    expect(json).toContain("@共有していない資料");
    expect(out.wikiMeta?.derivedFromNotes).toEqual(["pub", "memo:m1"]);
    expect(out.pages[0].knowledgeLinks.map((l) => l.targetNoteId)).toEqual(["pub"]);
    // 要約の文章は残す
    expect(out.wikiMeta?.topicMarkdown).toContain("要約の文。");
  });

  it("手元の文書は変えない", () => {
    const doc = topicDoc();
    const before = JSON.stringify(doc);
    stripUnsharedSources(doc, new Set(["priv"]));
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("外すものが無ければ同じ文書を返す", () => {
    const doc = topicDoc();
    expect(stripUnsharedSources(doc, new Set())).toBe(doc);
    expect(stripUnsharedSources(doc, new Set(["nothing"]))).toBe(doc);
  });

  it("読める写しの来歴から、共有していないつながりの題が消える", () => {
    const doc = {
      version: 2,
      title: "共有するノート",
      pages: [
        {
          id: "p1",
          title: "共有するノート",
          labels: {},
          provLinks: [],
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              props: {},
              content: [{ type: "text", text: "@指導教員に話していない仮説", styles: { textColor: "blue" } }],
              children: [],
            },
          ],
          knowledgeLinks: [
            { id: "k1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "private-1", type: "reference", layer: "knowledge", createdBy: "human" },
            { id: "k2", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "wiki-x", type: "reference", layer: "knowledge", createdBy: "ai", targetNoteTitle: "未共有トピック" },
          ],
        },
      ],
      noteLinks: [{ targetNoteId: "private-1", sourceBlockId: "b1", type: "derived_from" }],
    } as unknown as GraphiumDocument;
    const noteIndex = {
      version: 1,
      notes: [{ noteId: "private-1", title: "指導教員に話していない仮説", modifiedAt: "", createdAt: "" }],
    } as never;
    const prov = (d: GraphiumDocument) =>
      buildNoteProvJsonLdText(d, "me", {
        noteIndex,
        identity: { name: "A" },
        options: { includeChats: false, includeMemos: false },
        includeSourceData: false,
      }) ?? "";

    // 外さなければ題が出る（この試験が守っている穴）
    expect(prov(doc)).toContain("指導教員に話していない仮説");
    expect(prov(doc)).toContain("未共有トピック");

    const out = stripUnsharedSources(doc, new Set(["private-1", "wiki-x"]));
    const text = prov(out) + JSON.stringify(out);
    expect(text).not.toContain("指導教員に話していない仮説");
    expect(text).not.toContain("未共有トピック");
    expect(out.noteLinks).toEqual([]);
  });
});


describe("decideHiddenSources", () => {
  const deps = {
    loadDoc: async (id: string) => (id === "pub" ? ({ sharedRef: { id: "s-pub" } } as unknown as GraphiumDocument) : null),
    entryRoots: { "s-pub": "/lab" },
  };
  it("外すと選べば共有先に無い id を返し、そのままなら空、やめれば null", async () => {
    const base = { ...deps, selfIds: ["self"], isKnowledge: true, t };
    expect([...((await decideHiddenSources(topicDoc(), "/lab", { ...base, ask: () => "confirm" })) ?? [])]).toEqual(["priv"]);
    expect((await decideHiddenSources(topicDoc(), "/lab", { ...base, ask: () => "secondary" }))?.size).toBe(0);
    expect(await decideHiddenSources(topicDoc(), "/lab", { ...base, ask: () => "cancel" })).toBeNull();
  });
  it("資料を指していない文書は聞かない", async () => {
    let asked = false;
    const doc = { version: 2, title: "x", pages: [] } as unknown as GraphiumDocument;
    const got = await decideHiddenSources(doc, "/lab", { ...deps, selfIds: [], isKnowledge: false, t, ask: () => ((asked = true), "confirm") });
    expect(got?.size).toBe(0);
    expect(asked).toBe(false);
  });
});

describe("反証で見つかった形", () => {
  it("noteLinks だけで裏づけられた @ でも、共有済みの相手の題は残す", () => {
    const doc = {
      version: 2,
      title: "n",
      pages: [
        {
          id: "p",
          title: "n",
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
          blocks: [
            { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "@共有済み", styles: { textColor: "blue" } }], children: [] },
            { id: "b2", type: "paragraph", props: {}, content: [{ type: "text", text: "@未共有", styles: { textColor: "blue" } }], children: [] },
          ],
        },
      ],
      noteLinks: [
        { targetNoteId: "pub", sourceBlockId: "b1", type: "derived_from" },
        { targetNoteId: "priv", sourceBlockId: "b2", type: "derived_from" },
      ],
    } as unknown as GraphiumDocument;
    const json = JSON.stringify(stripUnsharedSources(doc, new Set(["priv"])));
    expect(json).toContain("@共有済み");
    expect(json).not.toContain("@未共有");
  });

  it("共有フォルダが 1 件なら、一覧に載る前の共有も共有先にあると数える", async () => {
    const deps = {
      loadDoc: async () => ({ sharedRef: { id: "just-shared" } }) as unknown as GraphiumDocument,
      entryRoots: {},
    };
    expect((await resolveUnsharedSourceIds(["a"], "/lab", { ...deps, roots: ["/lab"] })).size).toBe(0);
    // 2 件以上なら置き場所が分からないものは「無い」に数える
    expect((await resolveUnsharedSourceIds(["a"], "/lab", { ...deps, roots: ["/lab", "/dept"] })).size).toBe(1);
  });

  it("共有エントリの id を直接指すリンクは、置き場所だけで決める", async () => {
    const deps = { loadDoc: async () => null, entryRoots: { "s-other-person": "/lab" } };
    expect((await resolveUnsharedSourceIds(["s-other-person"], "/lab", deps)).size).toBe(0);
    expect((await resolveUnsharedSourceIds(["s-other-person"], "/dept", deps)).size).toBe(1);
  });
});
