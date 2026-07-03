// 添付サフィックスの組み立て/除去のラウンドトリップを固定する

import { describe, expect, it } from "vitest";
import {
  buildAttachmentSuffix,
  formatAttachmentTitle,
  stripAttachmentSuffix,
} from "./attachment-suffix";

describe("attachment-suffix", () => {
  it("組み立て→除去で元の質問文に戻る（ラウンドトリップ）", () => {
    const question = "この実験の考察は妥当？";
    const content = question + buildAttachmentSuffix([
      { id: "n1", title: "実験ノートA" },
      { id: "w1", title: "考察まとめ", isWiki: true },
    ]);
    expect(content).toBe("この実験の考察は妥当？\n\n📎 実験ノートA, 🤖 考察まとめ");
    expect(stripAttachmentSuffix(content)).toBe(question);
  });

  it("複数行の質問文でも末尾のサフィックスだけを除去する", () => {
    const question = "前提:\n- A\n- B\n\nこれで正しい？";
    const content = question + buildAttachmentSuffix([{ id: "n1", title: "メモ" }]);
    expect(stripAttachmentSuffix(content)).toBe(question);
  });

  it("サフィックスが無い content はそのまま返す", () => {
    expect(stripAttachmentSuffix("普通の質問")).toBe("普通の質問");
  });

  it("本文途中の 📎 行は除去しない（末尾のみ）", () => {
    const content = "📎 という記号について\n\n📎 メモ";
    expect(stripAttachmentSuffix(content)).toBe("📎 という記号について");
  });

  it("Wiki 添付は 🤖 プレフィックス付きでフォーマットされる", () => {
    expect(formatAttachmentTitle({ id: "w", title: "T", isWiki: true })).toBe("🤖 T");
    expect(formatAttachmentTitle({ id: "n", title: "T" })).toBe("T");
  });
});
