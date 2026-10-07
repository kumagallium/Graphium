// knowledge-check.ts（check_knowledge の本体）の回帰テスト。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkKnowledge, buildSnapshot } from "./knowledge-check";

function para(text: string) {
  return { id: `b-${text.length}`, type: "paragraph", content: [{ type: "text", text }], children: [] };
}

function wikiDoc(title: string, wikiMeta: Record<string, unknown>, body = "本文です") {
  return {
    version: 2,
    title,
    source: "ai",
    wikiMeta: { topicMarkdown: body, ...wikiMeta },
    pages: [{ id: "p", blocks: [para(body)] }],
  };
}

describe("checkKnowledge", () => {
  let root: string;

  const write = (dir: "notes" | "wiki", id: string, doc: object) =>
    writeFileSync(join(root, dir, `${id}.json`), JSON.stringify(doc));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-knowledge-check-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "wiki"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("孤立した知見と同名の重複トピックを日本語で返す（英語の suggestion は出さない）", () => {
    write("notes", "n1", { version: 2, title: "ノート", pages: [{ id: "p", blocks: [] }] });
    write("wiki", "c1", wikiDoc("ひとりぼっちの知見", { kind: "claim", derivedFromNotes: [] }));
    write("wiki", "t1", wikiDoc("焼結 温度", { kind: "topic", derivedFromNotes: ["n1"], derivedFromClaims: [] }));
    write("wiki", "t2", wikiDoc("焼結　温度", { kind: "topic", derivedFromNotes: ["n1"], derivedFromClaims: [] }));

    const out = checkKnowledge(root);
    expect(out).toContain("## 孤立（1 件）");
    expect(out).toContain("ひとりぼっちの知見");
    expect(out).toContain("## 同名の重複（1 件）");
    expect(out).toContain("merge_topics でまとめられます");
    expect(out).toContain("Graphium の手入れ画面");
    expect(out).not.toMatch(/Consider|Merge "/);
  });

  it("資料も知見も無いトピックは「空のページ」と自動アーカイブ候補に出る", () => {
    write("notes", "n1", { version: 2, title: "ノート", pages: [{ id: "p", blocks: [] }] });
    write("wiki", "t1", wikiDoc("空のトピック", { kind: "topic", derivedFromNotes: [], derivedFromClaims: [] }));
    const out = checkKnowledge(root);
    expect(out).toContain("## 空のページ（1 件）");
    expect(out).toContain("## 自動アーカイブ候補（1 件）");
  });

  it("引いているノートの一部がゴミ箱なら資料の欠落に出る", () => {
    mkdirSync(join(root, "appdata"), { recursive: true });
    write("notes", "n1", { version: 2, title: "生きている", pages: [{ id: "p", blocks: [] }] });
    write("notes", "n2", { version: 2, title: "捨てた", pages: [{ id: "p", blocks: [] }] });
    write("wiki", "t1", wikiDoc("二つ引くトピック", { kind: "topic", derivedFromNotes: ["n1", "n2"], derivedFromClaims: [] }));
    writeFileSync(
      join(root, "appdata", "note-index.json"),
      JSON.stringify({
        version: 30,
        notes: [
          { noteId: "n1", title: "生きている", source: "human" },
          { noteId: "n2", title: "捨てた", source: "human", deletedAt: "2026-10-01T00:00:00Z" },
          { noteId: "t1", title: "二つ引くトピック", source: "ai", wikiKind: "topic" },
        ],
      }),
    );
    const out = checkKnowledge(root);
    expect(out).toContain("## 資料の欠落（1 件）");
    expect(out).toContain("2 件のうち 1 件");
  });

  it("有効なノートが 1 件も無いと、資料の欠落と自動アーカイブは判定できないと書く", () => {
    write("wiki", "c1", wikiDoc("孤立", { kind: "claim", derivedFromNotes: [] }));
    const out = checkKnowledge(root);
    expect(out).toContain("判定できません");
    expect(out).toContain("## 孤立（1 件）");
  });

  it("ページが無ければその旨を返す", () => {
    expect(checkKnowledge(root)).toContain("点検するナレッジのページがありません");
  });

  it("buildSnapshot は topic のとき derivedFromClaims、atom のとき conflictsWith を持つ", () => {
    const topic = buildSnapshot("t", wikiDoc("T", { kind: "topic", derivedFromNotes: ["a"] }) as any, "2026-10-01T00:00:00Z");
    expect(topic?.derivedFromClaims).toEqual([]);
    expect(topic?.conflictsWith).toBeUndefined();
    const atom = buildSnapshot("a", wikiDoc("A", { kind: "atom", conflictsWith: ["x"] }) as any, "");
    expect(atom?.conflictsWith).toEqual(["x"]);
    expect(atom?.derivedFromClaims).toBeUndefined();
    expect(buildSnapshot("n", { title: "ノート", pages: [] } as any, "")).toBeNull();
  });
});
