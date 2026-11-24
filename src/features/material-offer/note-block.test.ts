import { describe, expect, it } from "vitest";
import { appendBlockToDoc, materialBlockFor } from "./note-block";
import { displayClientName, isOfferExpired, offerIdsFromKeys, parseOfferMeta } from "./offer-file";
import type { GraphiumDocument } from "../../lib/document-types";

const doc = (blocks: unknown[]): GraphiumDocument =>
  ({ title: "Rye", pages: [{ id: "p", title: "Rye", blocks, labels: {}, provLinks: [], knowledgeLinks: [] }] }) as unknown as GraphiumDocument;

describe("materialBlockFor", () => {
  it("種類ごとにブロックを選ぶ", () => {
    expect(materialBlockFor({ type: "pdf", url: "u", name: "a.pdf" }, "b").type).toBe("pdf");
    expect(materialBlockFor({ type: "image", url: "u", name: "a.jpg" }, "b").type).toBe("image");
    expect(materialBlockFor({ type: "data", url: "u", name: "a.csv" }, "b").type).toBe("file");
    expect(materialBlockFor({ type: "document", url: "u", name: "a.docx" }, "b")).toEqual({
      id: "b",
      type: "file",
      props: { url: "u", name: "a.docx" },
      children: [],
    });
  });
});

describe("appendBlockToDoc", () => {
  const block = materialBlockFor({ type: "image", url: "u", name: "a.jpg" }, "new");
  it("末尾が空の段落なら、その手前に入れる", () => {
    const out = appendBlockToDoc(doc([{ id: "1", type: "paragraph", content: [{ type: "text", text: "x" }] }, { id: "2", type: "paragraph", content: [] }]), block, "t");
    expect(out?.pages[0].blocks.map((b: { id: string }) => b.id)).toEqual(["1", "new", "2"]);
    expect(out?.modifiedAt).toBe("t");
  });
  it("それ以外は末尾に足す", () => {
    const out = appendBlockToDoc(doc([{ id: "1", type: "heading", content: [] }]), block);
    expect(out?.pages[0].blocks.map((b: { id: string }) => b.id)).toEqual(["1", "new"]);
  });
  it("ページが無ければ null", () => {
    expect(appendBlockToDoc({ title: "x", pages: [] } as unknown as GraphiumDocument, block)).toBeNull();
  });
});

describe("offer-file", () => {
  it("一覧のキーからメタの id だけを取る", () => {
    expect(offerIdsFromKeys(["material-offer-a1", "material-offer-bytes-a1", "other", "material-offer-../x"])).toEqual(["a1"]);
  });
  it("期限は 14 日、読めない日時は切れた扱い", () => {
    const now = Date.parse("2026-11-24T00:00:00Z");
    expect(isOfferExpired({ offeredAt: "2026-11-11T00:00:00Z" }, now)).toBe(false);
    expect(isOfferExpired({ offeredAt: "2026-11-09T00:00:00Z" }, now)).toBe(true);
    expect(isOfferExpired({ offeredAt: "nope" }, now)).toBe(true);
  });
  it("形の違うメタは null", () => {
    const ok = { version: 1, id: "a", name: "a.jpg", mimeType: "image/jpeg", size: 1, sha256: "h", sourcePath: "/tmp/a.jpg", client: "AI", offeredAt: "2026-11-24T00:00:00Z" };
    expect(parseOfferMeta(ok)).toEqual(ok);
    expect(parseOfferMeta({ ...ok, size: -1 })).toBeNull();
    expect(parseOfferMeta({ ...ok, version: 2 })).toBeNull();
    expect(parseOfferMeta({ ...ok, noteId: "" })).toBeNull();
  });
  it("クライアント名を画面の名前にする", () => {
    expect(displayClientName("codex-mcp-client")).toBe("ChatGPT / Codex");
    expect(displayClientName("claude-ai")).toBe("Claude");
    expect(displayClientName(undefined)).toBe("AI");
  });
});
