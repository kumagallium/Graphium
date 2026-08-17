// 横断検索の hybrid 化（埋め込み ∪ 語彙 → RRF、ノート本文・素材の断片）のテスト
// - fuseWikiSections: 両系統に居るセクションが最上位、片方だけの候補も残る、id 規約が揃う
// - formatRetrievedContext: [#N] が <knowledge> と <notes> で連番、予算で切れる、
//   orphan wiki（titleMap に無い・title 空）は飛ばす、断片は 700 字で切る
// - getSourceTitleToRefMap: 注入した断片のタイトル → note:/asset: 参照が引ける（Wiki 同名は Wiki 優先）

import { describe, expect, it } from "vitest";
import type { LexicalHit } from "../lexical-search";
import type { SearchResult } from "../../lib/embedding-store";
import {
  formatRetrievedContext,
  fuseWikiSections,
  getSourceTitleToRefMap,
  setWikiTitleMap,
  type RetrievedPassage,
} from "./retriever";

const dense = (documentId: string, sectionId: string, score: number, text = `${documentId}/${sectionId}`): SearchResult => ({
  documentId,
  sectionId,
  score,
  text,
});
const lex = (sourceId: string, chunkId: string, score: number, title = "T", kind: LexicalHit["kind"] = "wiki"): LexicalHit => ({
  id: `${kind}:${sourceId}:${chunkId}`,
  kind,
  sourceId,
  chunkId,
  title,
  text: `${sourceId}/${chunkId} text`,
  score,
  terms: [],
});

describe("fuseWikiSections", () => {
  it("両系統で上位のセクションが最上位になり、片方だけの候補も残る", () => {
    const out = fuseWikiSections(
      [dense("w1", "s1", 0.9), dense("w2", "lead", 0.8), dense("w3", "s3", 0.5)],
      [lex("w2", "lead", 12), lex("w1", "s1", 10), lex("w4", "s4", 3)],
      10,
    );
    const ids = out.map((p) => `${p.sourceId}:${p.chunkId}`);
    expect(ids.slice(0, 2).sort()).toEqual(["w1:s1", "w2:lead"]);
    expect(ids).toContain("w3:s3");
    expect(ids).toContain("w4:s4");
    expect(out.every((p) => p.kind === "wiki")).toBe(true);
  });

  it("埋め込みが空でも語彙だけで返る（逆も同じ）。topK で切る", () => {
    expect(fuseWikiSections([], [lex("w1", "a", 5), lex("w1", "b", 4)], 1).map((p) => p.chunkId)).toEqual(["a"]);
    expect(fuseWikiSections([dense("w9", "z", 0.4)], [], 5).map((p) => p.sourceId)).toEqual(["w9"]);
    expect(fuseWikiSections([], [], 5)).toEqual([]);
  });

  it("本文は埋め込み側の text を優先し、語彙だけの候補は語彙側の text とタイトルを持つ", () => {
    const out = fuseWikiSections([dense("w1", "s1", 0.9, "dense text")], [lex("w1", "s1", 1, "Title A"), lex("w2", "s2", 1, "Title B")], 5);
    expect(out.find((p) => p.sourceId === "w1")?.text).toBe("dense text");
    expect(out.find((p) => p.sourceId === "w2")).toMatchObject({ title: "Title B", text: "w2/s2 text" });
  });
});

describe("formatRetrievedContext", () => {
  const wikiTitles = new Map([["w1", "デシケーター運用"], ["w2", "焼結条件"]]);

  it("[#N] が <knowledge> と <notes> で連番になり、種類ラベルが付く", () => {
    setWikiTitleMap(wikiTitles);
    const wiki: RetrievedPassage[] = [
      { kind: "wiki", sourceId: "w1", chunkId: "lead", title: "", text: "乾燥剤は 2 週間で交換", score: 1 },
      { kind: "wiki", sourceId: "w2", chunkId: "s1", title: "", text: "SPS 800℃", score: 0.9 },
    ];
    const passages: RetrievedPassage[] = [
      { kind: "note", sourceId: "n1", chunkId: "b1", title: "試薬 X の保管", text: "湿度 60% 以上で劣化", score: 5 },
      { kind: "asset", sourceId: "a1", chunkId: "c0", title: "manual.pdf", text: "PPMS TTO", score: 4 },
    ];
    const out = formatRetrievedContext(wiki, passages, "- **デシケーター運用**: 抜粋");
    expect(out).toContain('[#1 | "デシケーター運用"]');
    expect(out).toContain('[#2 | "焼結条件"]');
    expect(out).toContain('[#3 | "試薬 X の保管"] (note)');
    expect(out).toContain('[#4 | "manual.pdf"] (asset)');
    expect(out.indexOf("<knowledge>")).toBeLessThan(out.indexOf("<notes>"));
    expect(out).toContain("<wiki-index>");
    // 参照マップに note:/asset: が入り、Wiki は id のまま
    const refs = getSourceTitleToRefMap();
    expect(refs.get("試薬 X の保管")).toBe("note:n1");
    expect(refs.get("manual.pdf")).toBe("asset:a1");
    expect(refs.get("デシケーター運用")).toBe("w1");
  });

  it("titleMap に無く title も空の wiki（orphan）は飛ばし、番号は詰める", () => {
    setWikiTitleMap(wikiTitles);
    const wiki: RetrievedPassage[] = [
      { kind: "wiki", sourceId: "gone", chunkId: "lead", title: "", text: "orphan", score: 1 },
      { kind: "wiki", sourceId: "w2", chunkId: "s1", title: "", text: "SPS", score: 0.9 },
    ];
    const out = formatRetrievedContext(wiki, [], undefined);
    expect(out).not.toContain("orphan");
    expect(out).toContain('[#1 | "焼結条件"]');
  });

  it("語彙側だけの wiki は自分の title で入る", () => {
    setWikiTitleMap(new Map());
    const out = formatRetrievedContext(
      [{ kind: "wiki", sourceId: "wX", chunkId: "lead", title: "語彙で見つけた", text: "本文", score: 1 }],
      [],
      undefined,
    );
    expect(out).toContain('[#1 | "語彙で見つけた"]');
  });

  it("断片は 1 件 700 字で切り、合計予算を超えたら以降を落とす", () => {
    setWikiTitleMap(new Map());
    const long = "あ".repeat(1000);
    const passages: RetrievedPassage[] = [
      { kind: "note", sourceId: "n1", chunkId: "b1", title: "一", text: long, score: 3 },
      { kind: "note", sourceId: "n2", chunkId: "b2", title: "二", text: long, score: 2 },
      { kind: "note", sourceId: "n3", chunkId: "b3", title: "三", text: long, score: 1 },
    ];
    const out = formatRetrievedContext([], passages, undefined);
    expect(out).toContain('[#1 | "一"]');
    expect(out).toContain('[#2 | "二"]');
    // 700 + 700 で 1600 の予算に達し、三は入らない
    expect(out).not.toContain('[#3 | "三"]');
    expect(out).toContain(`${"あ".repeat(700)}…`);
  });

  it("何も無ければ null 相当を返す", () => {
    setWikiTitleMap(new Map());
    expect(formatRetrievedContext([], [], undefined)).toBeNull();
  });
});
