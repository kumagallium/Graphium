import { describe, it, expect } from "vitest";
// @ts-expect-error 素の JS（型宣言なし）
import { parsePairingCode, buildClipPayload, isClippableUrl, enqueue, extractDoi } from "./lib.js";

const TOKEN = "a".repeat(43);

describe("parsePairingCode", () => {
  it("正しいコードを分解する", () => {
    expect(parsePairingCode(` 3001.${TOKEN} `)).toEqual({ port: 3001, token: TOKEN });
  });
  it("不正なコードは null", () => {
    expect(parsePairingCode("")).toBeNull();
    expect(parsePairingCode(`0.${TOKEN}`)).toBeNull();
    expect(parsePairingCode(`65536.${TOKEN}`)).toBeNull();
    expect(parsePairingCode("3001.short")).toBeNull();
    expect(parsePairingCode(`3001.${"a".repeat(31)}`)).toBeNull();
    expect(parsePairingCode(`3001.${"a".repeat(31)}!`)).toBeNull();
    expect(parsePairingCode(`abc.${TOKEN}`)).toBeNull();
    expect(parsePairingCode(null)).toBeNull();
  });
});

describe("isClippableUrl", () => {
  it("http/https のみ", () => {
    expect(isClippableUrl("https://example.com/a")).toBe(true);
    expect(isClippableUrl("http://example.com")).toBe(true);
    expect(isClippableUrl("chrome://extensions")).toBe(false);
    expect(isClippableUrl("file:///a.pdf")).toBe(false);
    expect(isClippableUrl("javascript:alert(1)")).toBe(false);
    expect(isClippableUrl("not a url")).toBe(false);
    expect(isClippableUrl(undefined)).toBe(false);
  });
});

describe("buildClipPayload", () => {
  const now = new Date("2026-11-03T00:00:00.000Z");
  it("選択ありは selection", () => {
    expect(buildClipPayload({ selection: "a\nb", title: "T", url: "https://x.y/", doi: "10.1/x", kind: "selection", now }))
      .toEqual({ url: "https://x.y/", title: "T", text: "a\nb", doi: "10.1/x", clippedAt: now.toISOString(), kind: "selection" });
  });
  it("空白だけの選択は page 扱いで text を付けない", () => {
    const p = buildClipPayload({ selection: " \n ", title: "T", url: "https://x.y/", kind: "selection", now });
    expect(p.kind).toBe("page");
    expect("text" in p).toBe(false);
    expect("doi" in p).toBe(false);
  });
  it("長さはそのまま", () => {
    const long = "あ".repeat(100000);
    expect(buildClipPayload({ selection: long, title: "", url: "https://x.y/", kind: "selection", now }).text).toHaveLength(100000);
  });
});

describe("enqueue", () => {
  it("上限を超えたら古いものから捨てる", () => {
    let q: number[] = [];
    for (let i = 0; i < 5; i++) q = enqueue(q, i, 3);
    expect(q).toEqual([2, 3, 4]);
  });
  it("元の配列を変更しない", () => {
    const q = [1];
    enqueue(q, 2);
    expect(q).toEqual([1]);
  });
  it("既定は 200 件", () => {
    let q: number[] = [];
    for (let i = 0; i < 205; i++) q = enqueue(q, i);
    expect(q).toHaveLength(200);
    expect(q[0]).toBe(5);
  });
});

describe("extractDoi", () => {
  it("各形式を正規化する", () => {
    expect(extractDoi(["10.1038/nature12373"])).toBe("10.1038/nature12373");
    expect(extractDoi(["doi:10.1038/nature12373"])).toBe("10.1038/nature12373");
    expect(extractDoi(["DOI: 10.1038/nature12373"])).toBe("10.1038/nature12373");
    expect(extractDoi(["https://doi.org/10.1038/nature12373"])).toBe("10.1038/nature12373");
  });
  it("DOI でなければ null、最初の DOI を採用", () => {
    expect(extractDoi([])).toBeNull();
    expect(extractDoi(["ISBN 123", "pmid:1234"])).toBeNull();
    expect(extractDoi(["abc", "doi:10.1000/xyz"])).toBe("10.1000/xyz");
  });
});
