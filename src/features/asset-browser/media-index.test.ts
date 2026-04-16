// findBlockIdsByMediaUrl のユニットテスト

import { describe, it, expect } from "vitest";
import { findBlockIdsByMediaUrl, updateBlockNameByUrl } from "./media-index";

describe("findBlockIdsByMediaUrl", () => {
  const targetUrl = "https://example.com/image.png";

  it("URL が一致する画像ブロックの ID を返す", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: targetUrl, name: "old.png" } },
      { id: "b2", type: "paragraph", props: {} },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual(["b1"]);
  });

  it("複数ブロックが同じ URL を参照している場合すべて返す", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: targetUrl } },
      { id: "b2", type: "video", props: { url: targetUrl } },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual(["b1", "b2"]);
  });

  it("子ブロックも再帰的に走査する", () => {
    const blocks = [
      {
        id: "parent", type: "paragraph", props: {},
        children: [
          { id: "child1", type: "audio", props: { url: targetUrl }, children: [] },
        ],
      },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual(["child1"]);
  });

  it("URL が一致しないブロックは含まない", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: "https://other.com/img.png" } },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual([]);
  });

  it("メディア以外のブロック型（paragraph 等）はスキップする", () => {
    const blocks = [
      { id: "b1", type: "paragraph", props: { url: targetUrl } },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual([]);
  });

  it("pdf / file ブロック型も対象になる", () => {
    const blocks = [
      { id: "b1", type: "pdf", props: { url: targetUrl } },
      { id: "b2", type: "file", props: { url: targetUrl } },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual(["b1", "b2"]);
  });

  it("空のブロック配列では空配列を返す", () => {
    expect(findBlockIdsByMediaUrl([], targetUrl)).toEqual([]);
  });
});

describe("updateBlockNameByUrl", () => {
  const targetUrl = "https://example.com/image.png";

  it("URL が一致するブロックの props.name を更新する", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: targetUrl, name: "old.png" } },
      { id: "b2", type: "paragraph", props: {} },
    ];
    const changed = updateBlockNameByUrl(blocks, targetUrl, "new.png");
    expect(changed).toBe(true);
    expect(blocks[0].props.name).toBe("new.png");
  });

  it("子ブロックも再帰的に更新する", () => {
    const blocks = [
      {
        id: "parent", type: "paragraph", props: {},
        children: [
          { id: "child1", type: "audio", props: { url: targetUrl, name: "old.mp3" }, children: [] },
        ],
      },
    ];
    const changed = updateBlockNameByUrl(blocks, targetUrl, "new.mp3");
    expect(changed).toBe(true);
    expect(blocks[0].children[0].props.name).toBe("new.mp3");
  });

  it("URL が一致しない場合は false を返し変更しない", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: "https://other.com/img.png", name: "other.png" } },
    ];
    const changed = updateBlockNameByUrl(blocks, targetUrl, "new.png");
    expect(changed).toBe(false);
    expect(blocks[0].props.name).toBe("other.png");
  });

  it("複数ブロックを一括更新できる", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: targetUrl, name: "old.png" } },
      { id: "b2", type: "video", props: { url: targetUrl, name: "old.mp4" } },
    ];
    const changed = updateBlockNameByUrl(blocks, targetUrl, "renamed");
    expect(changed).toBe(true);
    expect(blocks[0].props.name).toBe("renamed");
    expect(blocks[1].props.name).toBe("renamed");
  });
});
