import { describe, expect, it } from "vitest";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { buildPlaceUrl } from "./link-url";
import { linkFilesErrorNotice, linkFilesNotice, type LinkFilesOutcome } from "./link-notice";

// キーと引数をそのまま文字列にして、どの知らせを選んだかを確かめる
const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",")})` : key;

const entry = (name: string): MediaIndexEntry => ({
  fileId: name,
  name,
  type: "url",
  mimeType: "text/x-uri",
  url: buildPlaceUrl("p", name),
  thumbnailUrl: "",
  uploadedAt: "2026-11-19T00:00:00.000Z",
  usedIn: [],
  link: { placeId: "p", relPath: name, size: 1, mtimeMs: 1, recordedAt: "2026-11-19T00:00:00.000Z" },
});

const outcome = (over: Partial<LinkFilesOutcome>): LinkFilesOutcome => ({
  linked: [],
  existing: [],
  outside: 0,
  failed: 0,
  ...over,
});

describe("linkFilesNotice: 1 件のとき", () => {
  it("開いている一覧に入ったら何も出さない", () => {
    expect(linkFilesNotice(outcome({ linked: [entry("a.csv")] }), "data", t)).toBeNull();
  });
  it("別の一覧に入ったら、入った先を知らせる", () => {
    expect(linkFilesNotice(outcome({ linked: [entry("a.csv")] }), "image", t)).toBe(
      "linkedFile.listedIn(type=asset.type.data)",
    );
  });
  it("リンク済みでも、別の一覧にあれば入った先を知らせる", () => {
    expect(linkFilesNotice(outcome({ existing: [entry("a.csv")] }), "image", t)).toBe(
      "linkedFile.listedIn(type=asset.type.data)",
    );
  });
  it("置き場の外なら、置き場の案内を出す", () => {
    expect(linkFilesNotice(outcome({ outside: 1 }), "data", t)).toBe("linkedFile.outsidePlace");
  });
  it("読み取れなければ、そう知らせる", () => {
    expect(linkFilesNotice(outcome({ failed: 1 }), "data", t)).toBe("linkedFile.skippedFailed(count=1)");
  });
});

describe("linkFilesNotice: 複数のとき", () => {
  it("リンクした件数を種類ごとに数える", () => {
    const linked = [entry("a.csv"), entry("b.csv"), entry("c.png")];
    expect(linkFilesNotice(outcome({ linked }), "data", t)).toBe(
      "linkedFile.linkedMany(count=3,kinds=linkedFile.kindCount(type=asset.type.data,count=2)linkedFile.kindSeparatorlinkedFile.kindCount(type=asset.type.image,count=1))",
    );
  });
  it("PDF は左の一覧と同じドキュメントとして数える", () => {
    const linked = [entry("a.pdf"), entry("b.docx")];
    expect(linkFilesNotice(outcome({ linked }), "data", t)).toBe(
      "linkedFile.linkedMany(count=2,kinds=linkedFile.kindCount(type=asset.type.document,count=2))",
    );
  });
  it("リンクしなかった分の内訳も続けて出す", () => {
    const text = linkFilesNotice(outcome({ linked: [entry("a.csv")], existing: [entry("b.csv")], outside: 2, failed: 3 }), "data", t);
    expect(text).toContain("linkedFile.skippedExisting(count=1)");
    expect(text).toContain("linkedFile.skippedOutside(count=2)");
    expect(text).toContain("linkedFile.skippedFailed(count=3)");
  });
  it("1 件もリンクできなくても、理由は出す", () => {
    expect(linkFilesNotice(outcome({ outside: 2 }), "data", t)).toBe("linkedFile.skippedOutside(count=2)");
  });
});

describe("linkFilesErrorNotice", () => {
  it("選びすぎは、上限の案内に置き換える（文字列で投げられても）", () => {
    expect(linkFilesErrorNotice("PLACE_PICK_TOO_MANY:500", t)).toBe("linkedFile.tooMany(max=500)");
  });
  it("Error で届いても同じ案内", () => {
    expect(linkFilesErrorNotice(new Error("PLACE_PICK_TOO_MANY:500"), t)).toBe("linkedFile.tooMany(max=500)");
  });
  it("ほかの失敗は、そのまま伝える", () => {
    expect(linkFilesErrorNotice(new Error("boom"), t)).toBe("linkedFile.linkFailed(message=boom)");
  });
});
