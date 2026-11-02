import { describe, expect, it } from "vitest";

import { collectFolderScopeIds, isInFolder, normalizeFolderScope, type FolderScopeEntry } from "./folder-scope";

const note = (noteId: string, noteContexts?: string[], extra: Partial<FolderScopeEntry> = {}): FolderScopeEntry => ({
  noteId,
  source: "human",
  ...(noteContexts ? { noteContexts } : {}),
  ...extra,
});

const wiki = (noteId: string, wikiKind: string, extra: Partial<FolderScopeEntry> = {}): FolderScopeEntry => ({
  noteId,
  source: "ai",
  wikiKind,
  ...extra,
});

describe("normalizeFolderScope", () => {
  it("空白と末尾の / を落とし、空なら undefined", () => {
    expect(normalizeFolderScope("  AI 会話 / Graphium / ")).toBe("AI 会話/Graphium");
    expect(normalizeFolderScope("  ")).toBeUndefined();
    expect(normalizeFolderScope("/")).toBeUndefined();
    expect(normalizeFolderScope(undefined)).toBeUndefined();
  });
});

describe("isInFolder", () => {
  it("自身と子は入り、名前が前方一致するだけの別フォルダは入らない", () => {
    expect(isInFolder("AI 会話", "ai 会話")).toBe(true);
    expect(isInFolder("AI 会話/Graphium", "AI 会話")).toBe(true);
    expect(isInFolder("AI 会話まとめ", "AI 会話")).toBe(false);
    expect(isInFolder("AI 会話", "AI 会話/Graphium")).toBe(false);
  });
});

describe("collectFolderScopeIds", () => {
  it("フォルダ未指定なら null（絞らない）", () => {
    expect(collectFolderScopeIds([note("n1", ["A"])], undefined)).toBeNull();
    expect(collectFolderScopeIds([note("n1", ["A"])], " ")).toBeNull();
  });

  it("フォルダ内のノートと子フォルダのノートだけを入れる", () => {
    const ids = collectFolderScopeIds(
      [note("in", ["A"]), note("child", ["A/x"]), note("out", ["B"]), note("none")],
      "a",
    );
    expect([...ids!].sort()).toEqual(["child", "in"]);
  });

  it("ゴミ箱・アーカイブのノートは入れない", () => {
    const ids = collectFolderScopeIds(
      [note("live", ["A"]), note("trash", ["A"], { deletedAt: "x" }), note("arch", ["A"], { archivedAt: "x" })],
      "A",
    );
    expect([...ids!]).toEqual(["live"]);
  });

  it("知見 → トピック → 洞察と段を重ねて派生したナレッジまでたどる", () => {
    const ids = collectFolderScopeIds(
      [
        note("n1", ["A"]),
        note("n2", ["B"]),
        wiki("c1", "claim", { derivedFromNotes: ["n1"] }),
        wiki("c2", "claim", { derivedFromNotes: ["n2"] }),
        // 配列の順を逆にしても不動点までたどれること
        wiki("i1", "atom", { derivedFromClaims: ["t1"] }),
        wiki("t1", "topic", { derivedFromClaims: ["c1", "c2"] }),
        wiki("t2", "topic", { derivedFromClaims: ["c2"] }),
      ],
      "A",
    );
    expect([...ids!].sort()).toEqual(["c1", "i1", "n1", "t1"]);
  });

  it("資料から作ったトピック（derivedFromNotes にノート id）も入る", () => {
    const ids = collectFolderScopeIds(
      [note("n1", ["A"]), wiki("t1", "topic", { derivedFromNotes: ["n1", "media-1"] })],
      "A",
    );
    expect(ids!.has("t1")).toBe(true);
  });

  it("ナレッジ自身の noteContexts は見ない（フォルダツリーと同じ）", () => {
    const ids = collectFolderScopeIds([wiki("t1", "topic", { noteContexts: ["A"] })], "A");
    expect(ids!.size).toBe(0);
  });
});
