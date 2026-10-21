// 知見抽出に渡す既存の知見一覧（予算・短い番号・関係の深い順）の unit test
import { describe, it, expect } from "vitest";
import {
  buildExistingClaimIndex,
  resolveExistingClaimRef,
  MIN_EXISTING_INDEX_TOKENS,
} from "./ingest-existing-index.ts";
import { parseIngesterOutput, type ExistingWikiInfo } from "./wiki-ingester.ts";

const claim = (id: string, title: string): ExistingWikiInfo => ({ id, title, kind: "claim" });

describe("buildExistingClaimIndex", () => {
  it("知見だけを送られた順に c1, c2, … で載せる（topic・summary・atom は載せない）", () => {
    const index = buildExistingClaimIndex([
      { id: "t", title: "話題", kind: "topic" },
      claim("a", "知見 A"),
      { id: "s", title: "要約", kind: "summary" },
      claim("b", "知見 B"),
    ], "");
    expect(index.text).toBe("- c1: 知見 A\n- c2: 知見 B");
    expect(index.shown).toBe(2);
    expect(index.omitted).toBe(0);
    expect(index.refToId.get("c2")).toBe("b");
  });

  it("予算を超えると本文と関係の深い知見から載せ、載せなかった数を返す", () => {
    const filler = Array.from({ length: 400 }, (_, i) => claim(`f${i}`, `無関係な話題についての長めの知見その${i}番目の文章`));
    const target = claim("hit", "熱電変換材料のゼーベック係数");
    const index = buildExistingClaimIndex([...filler, target], "本稿では熱電変換材料のゼーベック係数を測った", MIN_EXISTING_INDEX_TOKENS);
    expect(index.omitted).toBeGreaterThan(0);
    expect(index.shown + index.omitted).toBe(401);
    // 関係の深い知見が先頭に来る（番号は送られた順のまま = c401）
    expect(index.text.split("\n")[0]).toBe("- c401: 熱電変換材料のゼーベック係数");
    expect(resolveExistingClaimRef("c401", index)).toBe("hit");
  });

  it("予算が負でも最低限の量は載せる", () => {
    const index = buildExistingClaimIndex([claim("a", "知見 A")], "", -10_000);
    expect(index.shown).toBe(1);
  });
});

describe("resolveExistingClaimRef", () => {
  const index = buildExistingClaimIndex([claim("uuid-a", "知見 A")], "");
  it("番号・#付き・元の id を受け、一覧に無いものは undefined", () => {
    expect(resolveExistingClaimRef("c1", index)).toBe("uuid-a");
    expect(resolveExistingClaimRef("#c1", index)).toBe("uuid-a");
    expect(resolveExistingClaimRef("uuid-a", index)).toBe("uuid-a");
    expect(resolveExistingClaimRef("c99", index)).toBeUndefined();
  });
});

describe("parseIngesterOutput と番号の解決", () => {
  const index = buildExistingClaimIndex([claim("uuid-a", "知見 A")], "");
  const out = (w: Record<string, unknown>) => parseIngesterOutput(JSON.stringify({ wikis: [{
    kind: "claim", title: "新しい知見", sections: [{ heading: "", content: "本文" }], ...w,
  }] }), ["本文"], index)[0];

  it("統合先と内部の裏づけの番号を元の id に戻す", () => {
    const w = out({
      suggestedAction: "merge", mergeTargetId: "c1",
      backing: [{ source: "internal-claim", citation: "同じ仕組み", internalClaimId: "c1" }],
    });
    expect(w.suggestedAction).toBe("merge");
    expect(w.mergeTargetId).toBe("uuid-a");
    expect(w.backing?.[0]?.internalClaimId).toBe("uuid-a");
  });

  it("一覧に無い番号への統合は新規作成に倒す", () => {
    const w = out({ suggestedAction: "merge", mergeTargetId: "c42" });
    expect(w.suggestedAction).toBe("create");
    expect(w.mergeTargetId).toBeUndefined();
  });
});
