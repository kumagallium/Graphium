import { describe, expect, it } from "vitest";
import { computeClaimHash } from "./claim-hash";

describe("computeClaimHash", () => {
  it("sha256: プレフィックス付きの決定的な文字列を返す", async () => {
    const h1 = await computeClaimHash("タイトル", "本文");
    const h2 = await computeClaimHash("タイトル", "本文");
    expect(h1).toBe(h2);
    expect(h1.startsWith("sha256:")).toBe(true);
  });

  it("本文が変わればハッシュも変わる", async () => {
    const before = await computeClaimHash("タイトル", "本文A");
    const after = await computeClaimHash("タイトル", "本文B");
    expect(before).not.toBe(after);
  });

  it("タイトルが変わればハッシュも変わる", async () => {
    const before = await computeClaimHash("タイトルA", "本文");
    const after = await computeClaimHash("タイトルB", "本文");
    expect(before).not.toBe(after);
  });

  it("区切り文字を挟むことで title/body の境界が異なる組み合わせと衝突しない", async () => {
    // "AB" + "" と "A" + "B" のような境界のずれが、区切り無しの単純結合だと衝突しうる
    const a = await computeClaimHash("AB", "");
    const b = await computeClaimHash("A", "B");
    expect(a).not.toBe(b);
  });
});
