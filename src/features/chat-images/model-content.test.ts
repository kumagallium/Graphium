import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildModelMessages, clearOcrCacheForTest, MAX_HISTORY_IMAGES } from "./model-content";

const img = (id: string, name?: string) => ({ ref: `media-text:chatimg_${id}`, mimeType: "image/jpeg", ...(name ? { name } : {}) });
const load = async (ref: string) => (ref.endsWith("missing") ? null : `data:image/jpeg;base64,${ref.slice(-3)}`);

describe("buildModelMessages", () => {
  beforeEach(() => clearOcrCacheForTest());

  it("画像の無い会話は文字列のまま", async () => {
    const out = await buildModelMessages(
      [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }],
      { acceptsImages: true, loadImage: load, readText: async () => "" },
    );
    expect(out).toEqual([{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }]);
  });

  it("読めるモデルには画像パートを付ける", async () => {
    const out = await buildModelMessages(
      [{ role: "user", content: "what is this", images: [img("abc")] }],
      { acceptsImages: true, loadImage: load, readText: async () => "" },
    );
    expect(out[0].content).toEqual([
      { type: "text", text: "what is this" },
      { type: "image", image: "abc", mediaType: "image/jpeg" },
    ]);
  });

  it("読めないモデルには OCR の文字を本文に添える（同じ画像は読み直さない）", async () => {
    const readText = vi.fn(async () => "Flour 500 g");
    const turns = [{ role: "user" as const, content: "read", images: [img("abc", "recipe.png")] }];
    const deps = { acceptsImages: false, loadImage: load, readText };
    const out = await buildModelMessages(turns, deps);
    await buildModelMessages(turns, deps);
    expect(readText).toHaveBeenCalledTimes(1);
    expect(typeof out[0].content).toBe("string");
    expect(out[0].content).toContain("Image 1 (recipe.png)");
    expect(out[0].content).toContain("Flour 500 g");
  });

  it("読み取りに失敗した画像は覚えず、次のターンで読み直す", async () => {
    let calls = 0;
    const readText = async () => {
      calls++;
      if (calls === 1) throw new Error("timeout");
      return "Salt 10 g";
    };
    const turns = [{ role: "user" as const, content: "q", images: [img("abc")] }];
    const first = await buildModelMessages(turns, { acceptsImages: false, loadImage: load, readText });
    const second = await buildModelMessages(turns, { acceptsImages: false, loadImage: load, readText });
    expect(first[0].content).toContain("failed this time");
    expect(second[0].content).toContain("Salt 10 g");
  });

  it("文字が読めなかった・手元に無い画像は注記だけ", async () => {
    const out = await buildModelMessages(
      [{ role: "user", content: "q", images: [img("abc"), img("missing")] }],
      { acceptsImages: false, loadImage: load, readText: async () => "" },
    );
    expect(out[0].content).toContain("no text could be read");
    expect(out[0].content).toContain("not available on this device");
  });

  it("画像は新しいものから上限枚数まで", async () => {
    const turns = Array.from({ length: 5 }, (_, i) => ({
      role: "user" as const,
      content: `t${i}`,
      images: [img(`a${i}0`), img(`a${i}1`)],
    }));
    const out = await buildModelMessages(turns, { acceptsImages: true, loadImage: load, readText: async () => "" });
    const sent = out.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === "image") : []));
    expect(sent).toHaveLength(MAX_HISTORY_IMAGES);
    // 最初のターンの 2 枚が外れて注記になる
    expect(out[0].content).toContain("not sent again");
    expect(Array.isArray(out[4].content)).toBe(true);
  });
});
