import { describe, expect, it, vi } from "vitest";
import type { GraphiumDocument, SourceCheckProfile } from "../../lib/document-types";
import { saveSourceCheckChange, saveSourceCheckResult, saveSourceCheckResults, type SaveSourceCheckDeps } from "./save";

function claimDoc(title: string): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-11-19T00:00:00.000Z",
    modifiedAt: "2026-11-19T00:00:00.000Z",
    wikiMeta: { kind: "claim", derivedFromNotes: [], derivedFromChats: [] },
  } as unknown as GraphiumDocument;
}

const profile = { verdict: "supported", checkedAt: "2026-11-19T00:00:00.000Z" } as unknown as SourceCheckProfile;

/** 保存の口: 最初の n 回は「ほかの保存の最中」として false を返し、そのあとは書く */
function makeDeps(busyTimes: number, start: GraphiumDocument) {
  const store = new Map<string, GraphiumDocument>([["wiki:w1", start]]);
  const writes: GraphiumDocument[] = [];
  let busy = busyTimes;
  const deps: SaveSourceCheckDeps = {
    getCachedDoc: (id) => store.get(id),
    loadDoc: async (id) => store.get(id) ?? null,
    saveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
      if (busy > 0) {
        busy -= 1;
        return false;
      }
      store.set(`wiki:${wikiId}`, doc);
      writes.push(doc);
      return true;
    }),
    activeFileId: "wiki:w1",
    reopenActiveWikiFile: vi.fn(),
    retryDelayMs: 0,
  };
  return { deps, store, writes };
}

describe("saveSourceCheckResult", () => {
  it("ほかの保存の最中で断られても、待ってやり直して判定を残す", async () => {
    const { deps, store } = makeDeps(2, claimDoc("全粒粉は 2 割までにする"));
    await saveSourceCheckResult("w1", profile, deps);
    expect(store.get("wiki:w1")?.wikiMeta?.sourceCheck).toEqual(profile);
    expect(deps.saveWikiFile).toHaveBeenCalledTimes(3);
    expect(deps.reopenActiveWikiFile).toHaveBeenCalledWith("w1");
  });

  it("やり直すたびに最新の文書から作るので、待つあいだの保存を巻き戻さない", async () => {
    const { deps, store } = makeDeps(1, claimDoc("古い題"));
    const save = deps.saveWikiFile;
    let first = true;
    deps.saveWikiFile = async (wikiId, doc) => {
      if (first) {
        first = false;
        // 断られたあいだに、エディタの保存が新しい題を書いた
        store.set("wiki:w1", claimDoc("新しい題"));
      }
      return save(wikiId, doc);
    };
    await saveSourceCheckResult("w1", profile, deps);
    expect(store.get("wiki:w1")?.title).toBe("新しい題");
    expect(store.get("wiki:w1")?.wikiMeta?.sourceCheck).toEqual(profile);
  });

  it("最後まで書けなければ、黙らずに失敗を知らせる", async () => {
    const { deps, store } = makeDeps(100, claimDoc("題"));
    await expect(saveSourceCheckResult("w1", profile, deps)).rejects.toThrow(/w1/);
    expect(store.get("wiki:w1")?.wikiMeta?.sourceCheck).toBeUndefined();
    expect(deps.reopenActiveWikiFile).not.toHaveBeenCalled();
  });
});

describe("saveSourceCheckResults", () => {
  it("1 件が書けなくても残りは保存し、最後に書けなかったものを知らせる", async () => {
    const store = new Map<string, GraphiumDocument>([
      ["wiki:w1", claimDoc("一つ目")],
      ["wiki:w2", claimDoc("二つ目")],
    ]);
    const deps: SaveSourceCheckDeps = {
      getCachedDoc: (id) => store.get(id),
      loadDoc: async (id) => store.get(id) ?? null,
      saveWikiFile: async (wikiId, doc) => {
        if (wikiId === "w1") return false;
        store.set(`wiki:${wikiId}`, doc);
        return true;
      },
      retryDelayMs: 0,
    };
    const profiles = new Map([
      ["w1", profile],
      ["w2", profile],
    ]);
    await expect(saveSourceCheckResults(profiles, deps)).rejects.toThrow(/w1/);
    expect(store.get("wiki:w2")?.wikiMeta?.sourceCheck).toEqual(profile);
    expect(store.get("wiki:w1")?.wikiMeta?.sourceCheck).toBeUndefined();
  });
});

describe("saveSourceCheckChange", () => {
  it("変える必要が無いときは書かない", async () => {
    const { deps, writes } = makeDeps(0, claimDoc("題"));
    expect(await saveSourceCheckChange("w1", () => null, deps)).toBe(false);
    expect(writes).toHaveLength(0);
    expect(deps.reopenActiveWikiFile).not.toHaveBeenCalled();
  });
});
