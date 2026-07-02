import { describe, it, expect } from "vitest";
import {
  replaceMentionRunsInContent,
  applyMentionRenameToDoc,
} from "./mention-rename";
import type { GraphiumDocument } from "../../lib/document-types";

const blueMention = (title: string) => ({
  type: "text",
  text: `@${title}`,
  styles: { textColor: "blue" },
});
const plainText = (text: string) => ({ type: "text", text, styles: {} });

describe("replaceMentionRunsInContent", () => {
  it("青文字の完全一致メンションだけを置換する", () => {
    const content = [
      plainText("前置き "),
      blueMention("旧タイトル"),
      plainText(" 後置き"),
    ];
    const result = replaceMentionRunsInContent(content, "旧タイトル", "新タイトル");
    expect(result).not.toBeNull();
    expect(result![1].text).toBe("@新タイトル");
    expect(result![1].styles?.textColor).toBe("blue");
    expect(result![0].text).toBe("前置き ");
    expect(result![2].text).toBe(" 後置き");
  });

  it("青文字でないテキストは同じ文字列でも置換しない", () => {
    const content = [plainText("@旧タイトル")];
    expect(replaceMentionRunsInContent(content, "旧タイトル", "新")).toBeNull();
  });

  it("部分一致（文中に @旧タイトル を含む run）は置換しない", () => {
    const content = [
      { type: "text", text: "これは @旧タイトル を含む文", styles: { textColor: "blue" } },
    ];
    expect(replaceMentionRunsInContent(content, "旧タイトル", "新")).toBeNull();
  });

  it("link run の内側コンテンツにも再帰する", () => {
    const content = [
      {
        type: "link",
        href: "https://example.com/Graphium/app/#note/abc",
        content: [blueMention("旧タイトル")],
      },
    ];
    const result = replaceMentionRunsInContent(content, "旧タイトル", "新タイトル");
    expect(result).not.toBeNull();
    expect((result![0] as any).content[0].text).toBe("@新タイトル");
  });

  it("配列でない content（table 等）は null", () => {
    expect(replaceMentionRunsInContent({ type: "tableContent" }, "a", "b")).toBeNull();
    expect(replaceMentionRunsInContent(undefined, "a", "b")).toBeNull();
  });
});

const makeDoc = (blocks: any[], knowledgeLinks: any[] = [], provLinks: any[] = []): GraphiumDocument =>
  ({
    version: 5,
    title: "参照元ノート",
    pages: [
      {
        id: "main",
        title: "参照元ノート",
        blocks,
        labels: {},
        provLinks,
        knowledgeLinks,
      },
    ],
    createdAt: "2026-07-01T00:00:00.000Z",
    modifiedAt: "2026-07-01T00:00:00.000Z",
  }) as GraphiumDocument;

const refLink = (sourceBlockId: string, targetNoteId: string) => ({
  id: `link-${sourceBlockId}-${targetNoteId}`,
  sourceBlockId,
  targetBlockId: "",
  type: "reference",
  layer: "knowledge",
  createdBy: "human",
  targetNoteId,
});

const para = (id: string, content: any[]) => ({
  id,
  type: "paragraph",
  props: {},
  content,
  children: [],
});

describe("applyMentionRenameToDoc", () => {
  it("リンクレコードで特定したブロックのメンションを書き換える", () => {
    const doc = makeDoc(
      [
        para("b1", [blueMention("旧B"), plainText(" 説明")]),
        // リンクレコードの無いブロックは同じ見た目でも触らない
        para("b2", [blueMention("旧B")]),
      ],
      [refLink("b1", "note-B")],
    );
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined);
    expect(result).not.toBeNull();
    expect(result!.changedBlockIds).toEqual(["b1"]);
    const blocks = result!.doc.pages[0].blocks;
    expect(blocks[0].content[0].text).toBe("@新B");
    expect(blocks[1].content[0].text).toBe("@旧B");
    expect(result!.doc.modifiedAt).not.toBe(doc.modifiedAt);
  });

  it("同名曖昧ガード: 同ブロックに現タイトルが同じ別ノート参照があれば触らない", () => {
    const doc = makeDoc(
      [para("b1", [blueMention("同名"), plainText(" と "), blueMention("同名")])],
      [refLink("b1", "note-B"), refLink("b1", "note-C")],
    );
    // note-C の現在のタイトルも「同名」→ どの run がどちらか判別不能
    const result = applyMentionRenameToDoc(doc, "note-B", "同名", "新B", (id) =>
      id === "note-C" ? "同名" : undefined,
    );
    expect(result).toBeNull();
  });

  it("同ブロックの別ノート参照でも現タイトルが異なればガードしない", () => {
    const doc = makeDoc(
      [para("b1", [blueMention("旧B"), plainText(" と "), blueMention("別ノート")])],
      [refLink("b1", "note-B"), refLink("b1", "note-C")],
    );
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", (id) =>
      id === "note-C" ? "別ノート" : undefined,
    );
    expect(result).not.toBeNull();
    const content = result!.doc.pages[0].blocks[0].content;
    expect(content[0].text).toBe("@新B");
    expect(content[2].text).toBe("@別ノート");
  });

  it("children 内のブロックにも再帰する", () => {
    const doc = makeDoc(
      [
        {
          ...para("parent", [plainText("親")]),
          children: [para("child", [blueMention("旧B")])],
        },
      ],
      [refLink("child", "note-B")],
    );
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined);
    expect(result).not.toBeNull();
    expect(result!.changedBlockIds).toEqual(["child"]);
    expect(result!.doc.pages[0].blocks[0].children[0].content[0].text).toBe("@新B");
  });

  it("v1 互換の links フィールドも参照する", () => {
    const doc = makeDoc([para("b1", [blueMention("旧B")])]);
    (doc.pages[0] as any).links = [refLink("b1", "note-B")];
    const result = applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined);
    expect(result).not.toBeNull();
    expect(result!.doc.pages[0].blocks[0].content[0].text).toBe("@新B");
  });

  it("対象リンクが無ければ null", () => {
    const doc = makeDoc([para("b1", [blueMention("旧B")])], [refLink("b1", "note-X")]);
    expect(applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined)).toBeNull();
  });

  it("リンクはあるがテキストが一致しなければ null（既に手動編集済み等）", () => {
    const doc = makeDoc([para("b1", [blueMention("手で変えた")])], [refLink("b1", "note-B")]);
    expect(applyMentionRenameToDoc(doc, "note-B", "旧B", "新B", () => undefined)).toBeNull();
  });

  it("タイトルが同一・空のときは null", () => {
    const doc = makeDoc([para("b1", [blueMention("旧B")])], [refLink("b1", "note-B")]);
    expect(applyMentionRenameToDoc(doc, "note-B", "旧B", "旧B", () => undefined)).toBeNull();
    expect(applyMentionRenameToDoc(doc, "note-B", "", "新B", () => undefined)).toBeNull();
  });
});
