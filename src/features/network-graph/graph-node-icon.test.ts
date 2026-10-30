import { describe, it, expect } from "vitest";
import {
  graphNodeIconDataUri,
  graphNodeIconKind,
  graphNodeIconNeedsLightFill,
  graphNodeIconStroke,
  graphNodeIconSvg,
} from "./graph-node-icon";

describe("graphNodeIconKind（ノードの種類 → アイコン）", () => {
  it("外部ソースは種類ごとに選ぶ", () => {
    expect(graphNodeIconKind({ external: "pdf" })).toBe("pdf");
    expect(graphNodeIconKind({ external: "document" })).toBe("document");
    expect(graphNodeIconKind({ external: "url" })).toBe("url");
    expect(graphNodeIconKind({ external: "chat" })).toBe("chat");
    expect(graphNodeIconKind({ external: "memo" })).toBe("memo");
  });
  it("メディアは mediaType で出し分け、不明なら画像", () => {
    expect(graphNodeIconKind({ external: "media", mediaType: "video" })).toBe("video");
    expect(graphNodeIconKind({ external: "media", mediaType: "audio" })).toBe("audio");
    expect(graphNodeIconKind({ external: "media", mediaType: "image" })).toBe("image");
    expect(graphNodeIconKind({ external: "media" })).toBe("image");
  });
  it("共有 / 提案 / Knowledge、通常ノートはアイコン無し", () => {
    expect(graphNodeIconKind({ sharedKind: "shared" })).toBe("shared");
    expect(graphNodeIconKind({ sharedKind: "proposal" })).toBe("proposal");
    expect(graphNodeIconKind({ isWiki: true })).toBe("wiki");
    expect(graphNodeIconKind({})).toBeUndefined();
  });
});

describe("アイコンの SVG / 色", () => {
  it("data URI は SVG で、指定色の stroke を持つ", () => {
    const uri = graphNodeIconDataUri("pdf", "#6e7378");
    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(uri.split(",")[1])).toContain('stroke="#6e7378"');
  });
  it("不正な色は埋め込まない（注入防止）", () => {
    expect(graphNodeIconSvg("url", '"><script>')).not.toContain("script");
  });
  it("外部ソースは白地に枠色、色付きノードは白抜き", () => {
    expect(graphNodeIconNeedsLightFill("memo")).toBe(true);
    expect(graphNodeIconStroke("memo", "#6e7378")).toBe("#6e7378");
    expect(graphNodeIconNeedsLightFill("wiki")).toBe(false);
    expect(graphNodeIconStroke("wiki", "#123456")).toBe("#ffffff");
  });
});
