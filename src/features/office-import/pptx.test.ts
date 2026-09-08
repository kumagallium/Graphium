// @vitest-environment jsdom
// readPptx のテスト
//
// fflate の zipSync で最小の .pptx（スライド 2 枚＋画像 1 枚）を組み立て、
// スライド順・文字抽出・画像抽出・非対応形式のスキップ数を検証する。

import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readPptx } from "./pptx";

const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function slideXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS_P} ${NS_A}>
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>${text}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function buildPptx(): Uint8Array {
  // presentation.xml では slide2 → slide1 の順に並べ、「slideN.xml の数値順」ではなく
  // 「sldIdLst の並び順」が優先されることを検証できるようにする
  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS_P} ${NS_R}>
  <p:sldIdLst>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`;

  return zipSync({
    "ppt/presentation.xml": strToU8(presentationXml),
    "ppt/_rels/presentation.xml.rels": strToU8(relsXml),
    "ppt/slides/slide1.xml": strToU8(slideXml("Slide One")),
    "ppt/slides/slide2.xml": strToU8(slideXml("Slide Two")),
    "ppt/media/image1.png": new Uint8Array([1, 2, 3, 4]),
    "ppt/media/image2.xyz": new Uint8Array([5, 6]), // 未知拡張子 → スキップ
  });
}

describe("readPptx", () => {
  it("sldIdLst の並び順でスライドを返す（slideN.xml の数値順ではない）", async () => {
    const result = await readPptx(buildPptx());
    expect(result.slides).toEqual([
      { index: 1, text: "Slide Two" },
      { index: 2, text: "Slide One" },
    ]);
  });

  it("ppt/media の画像を拾い、未知拡張子はスキップ数に数える", async () => {
    const result = await readPptx(buildPptx());
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ name: "image1.png", mimeType: "image/png" });
    expect(result.skippedImages).toBe(1);
  });

  it("presentation.xml.rels が無いとき slideN.xml の数値順にフォールバックする", async () => {
    const bytes = zipSync({
      "ppt/slides/slide2.xml": strToU8(slideXml("Second")),
      "ppt/slides/slide1.xml": strToU8(slideXml("First")),
    });
    const result = await readPptx(bytes);
    expect(result.slides).toEqual([
      { index: 1, text: "First" },
      { index: 2, text: "Second" },
    ]);
  });
});
