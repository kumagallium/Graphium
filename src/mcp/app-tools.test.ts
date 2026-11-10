// 会話内プレビューに添える画像（resolvePreviewImages）のテスト。
// ユーザーの実 vault には触らず、一時ディレクトリの media/ を使う。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePreviewImages } from "./app-tools";
import type { NotePreview, PreviewBlock } from "./note-preview";

const image = (blockId: string, mediaId?: string, extra: Partial<PreviewBlock> = {}): PreviewBlock =>
  ({ kind: "media", mediaType: "image", name: `${blockId}.png`, blockId, ...(mediaId ? { mediaId } : {}), ...extra }) as PreviewBlock;

const previewOf = (blocks: PreviewBlock[]): NotePreview => ({
  noteId: "n",
  title: "t",
  blocks,
  truncated: false,
});

describe("resolvePreviewImages", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-preview-images-"));
    mkdirSync(join(root, "media"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("手元の画像を data URL にする（手順の中の画像も拾う）", () => {
    writeFileSync(join(root, "media", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(root, "media", "b.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    const preview = previewOf([
      image("i1", "a"),
      { kind: "step", order: 1, runs: [], children: [image("i2", "b")] },
    ]);
    const images = resolvePreviewImages(preview, root);
    expect(images.i1).toBe(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`);
    expect(images.i2?.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("SVG・見つからない素材・外のサイト・不正な id は入れない", () => {
    writeFileSync(join(root, "media", "s.svg"), "<svg onload=alert(1)></svg>");
    const preview = previewOf([
      image("svg", "s"),
      image("missing", "nope"),
      image("remote", undefined, { remoteHost: "example.com" } as Partial<PreviewBlock>),
      image("bad", "../etc/passwd"),
    ]);
    expect(resolvePreviewImages(preview, root)).toEqual({});
  });

  it("1 枚 2 MiB を超える画像は入れない", () => {
    writeFileSync(join(root, "media", "big.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
    writeFileSync(join(root, "media", "small.png"), Buffer.alloc(10));
    const images = resolvePreviewImages(previewOf([image("big", "big"), image("small", "small")]), root);
    expect(Object.keys(images)).toEqual(["small"]);
  });
});
