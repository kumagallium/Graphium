import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { MAX_REQUEST_IMAGES, prepareChatImages } from "./chat-images";

const image = (data = "aGVsbG8=", mediaType = "image/jpeg") => ({ type: "image" as const, image: data, mediaType });

describe("prepareChatImages", () => {
  it("文字だけの会話はそのまま", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }];
    expect(prepareChatImages(msgs, true)).toEqual(msgs);
  });

  it("読めるモデルには base64 の画像を通す", () => {
    const out = prepareChatImages([{ role: "user", content: [{ type: "text", text: "q" }, image()] }], true);
    expect(out[0].content).toEqual([{ type: "text", text: "q" }, image()]);
  });

  it("URL・data URL・未知の形式は通さない", () => {
    const out = prepareChatImages(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "q" },
            image("https://example.com/a.png"),
            image("data:image/png;base64,aGVsbG8="),
            image("aGVsbG8=", "image/svg+xml"),
          ],
        } as ModelMessage,
      ],
      true,
    );
    expect(typeof out[0].content).toBe("string");
    expect(out[0].content).toContain("could not be passed");
  });

  it("user 以外のパート配列は文字だけ残す", () => {
    const out = prepareChatImages(
      [{ role: "assistant", content: [{ type: "text", text: "a" }, { type: "file", data: "https://example.com/x", mediaType: "image/png" }] } as ModelMessage],
      true,
    );
    expect(out[0]).toEqual({ role: "assistant", content: "a" });
  });

  it("読めないモデルには注記に置き換える", () => {
    const out = prepareChatImages([{ role: "user", content: [{ type: "text", text: "q" }, image()] }], false);
    expect(out[0].content).toBe("q\n\n[An image was attached, but the AI model in use cannot see images]");
  });

  it("枚数の上限を超えた分は落とす", () => {
    const many = Array.from({ length: MAX_REQUEST_IMAGES + 2 }, () => image());
    const out = prepareChatImages([{ role: "user", content: [{ type: "text", text: "q" }, ...many] }], true);
    const parts = out[0].content as { type: string }[];
    expect(parts.filter((p) => p.type === "image")).toHaveLength(MAX_REQUEST_IMAGES);
  });
});
