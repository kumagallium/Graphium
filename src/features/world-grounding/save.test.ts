import { describe, expect, it } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { saveWorldValidity, type SaveWorldValidityDeps } from "./save";

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

const validity = { verdict: "supported", checkedAt: "2026-11-19T00:00:00.000Z" } as never;

/** 保存の口: 最初の busy 回は「ほかの保存の最中」として false を返し、そのあとは書く */
function makeDeps(busy: number, start: GraphiumDocument) {
  const store = new Map<string, GraphiumDocument>([["wiki:w1", start]]);
  let left = busy;
  let calls = 0;
  const deps: SaveWorldValidityDeps = {
    getCachedDoc: (id) => store.get(id),
    loadDoc: async (id) => store.get(id) ?? null,
    saveWikiFile: async (wikiId, doc) => {
      calls += 1;
      if (left > 0) {
        left -= 1;
        return false;
      }
      store.set(`wiki:${wikiId}`, doc);
      return true;
    },
    retryDelayMs: 0,
  };
  return { deps, store, calls: () => calls };
}

describe("saveWorldValidity", () => {
  it("ほかの保存の最中で断られても、待ってやり直して判定を残す", async () => {
    const { deps, store, calls } = makeDeps(2, claimDoc("全粒粉は 2 割までにする"));
    expect(await saveWorldValidity("w1", () => validity, deps)).toBe(true);
    expect(store.get("wiki:w1")?.wikiMeta?.grounding?.validity).toEqual(validity);
    expect(calls()).toBe(3);
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
    await saveWorldValidity("w1", () => validity, deps);
    expect(store.get("wiki:w1")?.title).toBe("新しい題");
    expect(store.get("wiki:w1")?.wikiMeta?.grounding?.validity).toEqual(validity);
  });

  it("最後まで書けなければ、黙らずに失敗を知らせる", async () => {
    const { deps, store } = makeDeps(100, claimDoc("題"));
    await expect(saveWorldValidity("w1", () => validity, deps)).rejects.toThrow(/w1/);
    expect(store.get("wiki:w1")?.wikiMeta?.grounding).toBeUndefined();
  });

  it("判定を作らない（null）ときは書かない", async () => {
    const { deps, calls } = makeDeps(0, claimDoc("題"));
    expect(await saveWorldValidity("w1", () => null, deps)).toBe(false);
    expect(calls()).toBe(0);
  });
});
