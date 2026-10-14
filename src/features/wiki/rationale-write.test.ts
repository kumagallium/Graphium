import { describe, it, expect, vi } from "vitest";
import { takeSnapshot } from "../version-snapshots/snapshot-store";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  isRegularNoteId,
  pickRationaleTargets,
  buildRationaleParagraphText,
  appendParagraphToDoc,
  writeRationaleToWiki,
  rationaleAppendKey,
  pickPendingTargets,
  submitRationale,
} from "./rationale-write";

vi.mock("../version-snapshots/snapshot-store", () => ({
  takeSnapshot: vi.fn(async () => ({ status: "created" })),
}));

const meta = (rationale: string | null, from: string[]) =>
  ({
    derivedFromNotes: from,
    decisionFrame: { triggerClaimIds: [], action: "A", rationale, reviewState: "confirmed" },
  }) as any;

describe("isRegularNoteId", () => {
  it("prefix 無しだけ true", () => {
    expect(isRegularNoteId("abc-123")).toBe(true);
    for (const p of ["pdf:x", "document:x", "url:x", "chat:x", "memo:x"]) {
      expect(isRegularNoteId(p)).toBe(false);
    }
    expect(isRegularNoteId("")).toBe(false);
  });
});

describe("pickRationaleTargets", () => {
  it("理由 null かつ通常ノート出典のものだけ。追記先は起動元を優先", () => {
    const r = pickRationaleTargets(
      [
        { id: "w1", title: "T1", wikiMeta: meta(null, ["pdf:a", "n1", "n2"]) },
        { id: "w2", title: "T2", wikiMeta: meta("書いてある", ["n1"]) },
        { id: "w3", title: "T3", wikiMeta: meta(null, ["pdf:a"]) },
        { id: "w4", title: "T4", wikiMeta: { derivedFromNotes: ["n1"] } as any },
      ],
      "n2",
    );
    expect(r).toEqual([{ wikiId: "w1", title: "T1", action: "A", targetNoteId: "n2" }]);
  });
  it("起動元が出典に無ければ最初の通常ノート", () => {
    const r = pickRationaleTargets([{ id: "w1", title: "T1", wikiMeta: meta(null, ["n1", "n2"]) }], "zzz");
    expect(r[0].targetNoteId).toBe("n1");
  });
});

describe("段落の組み立て", () => {
  it("ラベル + 本文", () => {
    expect(buildRationaleParagraphText("題", "理由")).toContain("題");
    expect(buildRationaleParagraphText("題", "理由")).toMatch(/理由$/);
  });
  it("末尾に段落を足し、元の doc は変えない", () => {
    const doc = { pages: [{ id: "p", title: "", blocks: [{ id: "b" }] }], modifiedAt: "x" } as unknown as GraphiumDocument;
    const next = appendParagraphToDoc(doc, "hi");
    expect(next.pages[0].blocks).toHaveLength(2);
    expect(next.pages[0].blocks[1].type).toBe("paragraph");
    expect(doc.pages[0].blocks).toHaveLength(1);
  });
});

describe("writeRationaleToWiki", () => {
  const doc = { wikiMeta: meta(null, ["n1"]) } as unknown as GraphiumDocument;
  it("rationale を入力そのままで保存する", async () => {
    const save = vi.fn(async () => true);
    await writeRationaleToWiki(
      { provider: {} as any, getCachedDoc: () => doc, loadDoc: async () => null, handleSaveWikiFile: save },
      "w1",
      "短い",
    );
    expect((save.mock.calls[0] as any)[1].wikiMeta.decisionFrame.rationale).toBe("短い");
  });
  it("書いた理由は rationaleBy: human で、reviewState は変えず、mergeFrame で再生成に消されない", async () => {
    const save = vi.fn(async () => true);
    const ex = { wikiMeta: { ...meta(null, ["n1"]), decisionFrame: { triggerClaimIds: [], action: "A", rationale: null, reviewState: "extracted" } } } as unknown as GraphiumDocument;
    await writeRationaleToWiki(
      { provider: {} as any, getCachedDoc: () => ex, loadDoc: async () => null, handleSaveWikiFile: save },
      "w1",
      "人の理由",
    );
    const saved = (save.mock.calls[0] as any)[1].wikiMeta;
    expect(saved.decisionFrame.reviewState).toBe("extracted");
    expect(saved.decisionFrame.rationaleBy).toBe("human");
    const { mergeFrame } = await import("./merge-frame");
    const incoming = { derivedFromNotes: ["n1"], decisionFrame: { triggerClaimIds: [], action: "A", rationale: null, reviewState: "extracted" } } as any;
    expect(mergeFrame(saved, incoming).decisionFrame?.rationale).toBe("人の理由");
  });
  it("false が続けば例外", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => false);
    const p = writeRationaleToWiki(
      { provider: {} as any, getCachedDoc: () => doc, loadDoc: async () => null, handleSaveWikiFile: save },
      "w1",
      "x",
    );
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(save).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
  it("版を frame_backfill / force で取り、保存より前に取る", async () => {
    const order: string[] = [];
    (takeSnapshot as any).mockClear();
    (takeSnapshot as any).mockImplementationOnce(async () => {
      order.push("snapshot");
      return { status: "created" };
    });
    const save = vi.fn(async () => {
      order.push("save");
      return true;
    });
    const provider = {} as any;
    await writeRationaleToWiki(
      { provider, getCachedDoc: () => doc, loadDoc: async () => null, handleSaveWikiFile: save },
      "w1",
      "x",
    );
    const call = (takeSnapshot as any).mock.calls[0];
    expect(call[0]).toBe(provider);
    expect(call[1]).toBe("w1");
    expect(call[4]).toBe("frame_backfill");
    expect(call[5]).toBe(true);
    expect(order).toEqual(["snapshot", "save"]);
  });
  it("2 回目で保存できれば成功", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const p = writeRationaleToWiki(
      { provider: {} as any, getCachedDoc: () => doc, loadDoc: async () => null, handleSaveWikiFile: save },
      "w1",
      "x",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it("decisionFrame が無ければ例外（保存しない）", async () => {
    const save = vi.fn(async () => true);
    const bare = { wikiMeta: { derivedFromNotes: ["n1"] } } as unknown as GraphiumDocument;
    await expect(
      writeRationaleToWiki(
        { provider: {} as any, getCachedDoc: () => bare, loadDoc: async () => null, handleSaveWikiFile: save },
        "w1",
        "x",
      ),
    ).rejects.toThrow("decisionFrame not found");
    expect(save).not.toHaveBeenCalled();
  });
  it("キャッシュに無ければ loadDoc で読む", async () => {
    const save = vi.fn(async () => true);
    const loadDoc = vi.fn(async () => doc);
    await writeRationaleToWiki(
      { provider: {} as any, getCachedDoc: () => undefined, loadDoc, handleSaveWikiFile: save },
      "w1",
      "x",
    );
    expect(loadDoc).toHaveBeenCalledWith("wiki:w1");
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("再送信・再提示の保護", () => {
  it("追記キーは入力文ごとに変わる（直した文は別追記）", () => {
    expect(rationaleAppendKey("w", "n", "A")).not.toBe(rationaleAppendKey("w", "n", "B"));
    expect(rationaleAppendKey("w", "n", "A")).toBe(rationaleAppendKey("w", "n", "A"));
  });
  it("書き込み済み（rationale あり）の判断は再提示されない", () => {
    const done = { id: "w1", title: "t", wikiMeta: meta("書いた", ["n1"]) };
    const todo = { id: "w2", title: "t", wikiMeta: meta(null, ["n1"]) };
    expect(pickPendingTargets([done, todo]).map((x) => x.wikiId)).toEqual(["w2"]);
  });
});

describe("reviewState の扱い", () => {
  it("inferred の frame に理由を書いても inferred のまま・他欄は保つ", async () => {
    const doc = {
      wikiMeta: {
        decisionFrame: { triggerClaimIds: ["t"], action: "A", rationale: null, reviewState: "inferred" },
      },
    } as unknown as GraphiumDocument;
    const save = vi.fn(async () => true);
    await writeRationaleToWiki(
      { provider: {} as any, getCachedDoc: () => doc, loadDoc: async () => null, handleSaveWikiFile: save },
      "w1",
      "理由",
    );
    const saved = (save.mock.calls[0] as any[])[1] as GraphiumDocument;
    expect(saved.wikiMeta!.decisionFrame).toMatchObject({
      rationale: "理由",
      rationaleBy: "human",
      reviewState: "inferred",
      triggerClaimIds: ["t"],
    });
  });
});

describe("submitRationale", () => {
  const baseDoc = () =>
    ({ pages: [{ id: "p", title: "", blocks: [] }], modifiedAt: "x" }) as unknown as GraphiumDocument;
  const mk = (over: Partial<Parameters<typeof submitRationale>[0]> = {}) => ({
    isActiveNote: () => false,
    insertParagraphViaEditor: vi.fn(() => true),
    loadNoteDoc: vi.fn(async () => baseDoc()),
    saveNoteDoc: vi.fn(async () => {}),
    writeWiki: vi.fn(async () => {}),
    appended: new Set<string>(),
    ...over,
  });
  const target = { wikiId: "w1", title: "T", action: "A", targetNoteId: "n-sub" };

  it("知見側だけ失敗して再送信しても段落は 1 回", async () => {
    const deps = mk({ writeWiki: vi.fn().mockRejectedValueOnce(new Error("wiki")).mockResolvedValueOnce(undefined) });
    await expect(submitRationale(deps, target, "理由")).rejects.toThrow("wiki");
    expect(deps.appended.size).toBe(1);
    await submitRationale(deps, target, "理由");
    expect(deps.saveNoteDoc).toHaveBeenCalledTimes(1);
    expect(deps.writeWiki).toHaveBeenCalledTimes(2);
    expect(deps.appended.size).toBe(0);
  });
  it("アクティブ文書ならエディタ経由。挿入が false なら保存経路へ落ちる", async () => {
    const ok = mk({ isActiveNote: () => true });
    await submitRationale(ok, { ...target, targetNoteId: "n-ed1" }, "x");
    expect(ok.insertParagraphViaEditor).toHaveBeenCalledTimes(1);
    expect(ok.saveNoteDoc).not.toHaveBeenCalled();
    const ng = mk({ isActiveNote: () => true, insertParagraphViaEditor: vi.fn(() => false) });
    await submitRationale(ng, { ...target, targetNoteId: "n-ed2" }, "x");
    expect(ng.loadNoteDoc).toHaveBeenCalledWith("n-ed2");
    expect(ng.saveNoteDoc).toHaveBeenCalledTimes(1);
  });
  it("非アクティブは loadNoteDoc → saveNoteDoc（末尾に段落）", async () => {
    const deps = mk();
    await submitRationale(deps, { ...target, targetNoteId: "n-inactive" }, "x");
    expect(deps.insertParagraphViaEditor).not.toHaveBeenCalled();
    expect(deps.loadNoteDoc).toHaveBeenCalledWith("n-inactive");
    const saved = ((deps.saveNoteDoc as any).mock.calls[0] as any[])[1] as GraphiumDocument;
    expect(saved.pages[0].blocks).toHaveLength(1);
  });
  it("同一ノートへの 2 件は並走せず順序が保たれる", async () => {
    const log: string[] = [];
    const slow = mk({
      loadNoteDoc: vi.fn(async () => {
        log.push("a-load");
        await new Promise((r) => setTimeout(r, 20));
        return baseDoc();
      }),
      writeWiki: vi.fn(async () => {
        log.push("a-wiki");
      }),
    });
    const fast = mk({
      loadNoteDoc: vi.fn(async () => {
        log.push("b-load");
        return baseDoc();
      }),
      writeWiki: vi.fn(async () => {
        log.push("b-wiki");
      }),
    });
    const t = { ...target, targetNoteId: "n-serial" };
    await Promise.all([
      submitRationale(slow, t, "a"),
      submitRationale(fast, { ...t, wikiId: "w2" }, "b"),
    ]);
    expect(log).toEqual(["a-load", "a-wiki", "b-load", "b-wiki"]);
  });
  it("先行が失敗しても後続は止まらない", async () => {
    const t = { ...target, targetNoteId: "n-fail" };
    const bad = mk({ loadNoteDoc: vi.fn(async () => null) });
    const good = mk();
    const p1 = submitRationale(bad, t, "a");
    const p2 = submitRationale(good, { ...t, wikiId: "w2" }, "b");
    await expect(p1).rejects.toThrow();
    await expect(p2).resolves.toBeUndefined();
  });
});
