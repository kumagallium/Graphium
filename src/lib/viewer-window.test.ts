import { describe, expect, it } from "vitest";
import { buildViewerUrl, parseViewerTarget } from "./viewer-window";

describe("parseViewerTarget", () => {
  it("別ウィンドウのクエリから行き先を読む", () => {
    expect(parseViewerTarget("?viewer=note&id=abc-123")).toEqual({ kind: "note", id: "abc-123" });
  });

  it("wiki: などのプレフィックス付きの ID をそのまま返す", () => {
    expect(parseViewerTarget("?viewer=note&id=wiki%3Aabc")).toEqual({ kind: "note", id: "wiki:abc" });
  });

  it("メインのウィンドウ（クエリ無し・他のクエリ）では null", () => {
    expect(parseViewerTarget("")).toBeNull();
    expect(parseViewerTarget("?demo=bread-en")).toBeNull();
  });

  it("知らない種類・空の ID・長すぎる ID は受け取らない", () => {
    expect(parseViewerTarget("?viewer=graph&id=abc")).toBeNull();
    expect(parseViewerTarget("?viewer=note&id=")).toBeNull();
    expect(parseViewerTarget("?viewer=note")).toBeNull();
    expect(parseViewerTarget(`?viewer=note&id=${"a".repeat(513)}`)).toBeNull();
  });

  it("ノートのフォルダの外を指す ID（区切り・..）は受け取らない", () => {
    expect(parseViewerTarget("?viewer=note&id=..%2F..%2Fx")).toBeNull();
    expect(parseViewerTarget("?viewer=note&id=a%2Fb")).toBeNull();
    expect(parseViewerTarget("?viewer=note&id=a%5Cb")).toBeNull();
    expect(parseViewerTarget("?viewer=note&id=wiki%3A..")).toBeNull();
  });
});

describe("buildViewerUrl", () => {
  it("いまのパスに別ウィンドウのクエリを付ける", () => {
    const url = buildViewerUrl({ kind: "note", id: "wiki:a b" }, { pathname: "/Graphium/", search: "" });
    expect(url.startsWith("/Graphium/?")).toBe(true);
    expect(parseViewerTarget(url.slice(url.indexOf("?")))).toEqual({ kind: "note", id: "wiki:a b" });
  });

  it("見本モードを引き継ぐ（別ウィンドウが本人のデータを読みに行かないように）", () => {
    const url = buildViewerUrl({ kind: "note", id: "n1" }, { pathname: "/Graphium/", search: "?demo=bread-en&intro=1" });
    const params = new URLSearchParams(url.slice(url.indexOf("?")));
    expect(params.get("demo")).toBe("bread-en");
    // 見本以外のクエリは持ち込まない
    expect(params.get("intro")).toBeNull();
  });
});
