// importConversations の回帰テスト。
// 保存先（saveMediaText・readIndex・saveIndex）と時計をメモリ上に差し替え、
// 二重にならないこと・取り込み直しで人の編集が残ること・失敗が一覧に載らないことを確かめる。

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_MEDIA_INDEX_VERSION,
  type MediaIndex,
  type MediaIndexEntry,
} from "../asset-browser/media-index";
import type { ConversationMaterial } from "../../lib/conversation/types";
import { importConversations, type ImportConversationsDeps } from "./import-conversations";

const SESSION_A = "11111111-2222-4333-8444-555555555555";
const SESSION_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FILE_A = `conv-claude-code-${SESSION_A}`;
const FILE_B = `conv-claude-code-${SESSION_B}`;
const OPTIONS = { folderRoot: "AI 会話", utcOffsetMinutes: 540 };

const OWN_A1 = "全粒粉は 2 割までにする。\n3 割だと生地がだれたので";
const OWN_A2 = "加水は  80% で、\n\n  折り返しは 3 回";

function material(over: Partial<ConversationMaterial> = {}): ConversationMaterial {
  return {
    provider: "claude-code",
    sessionId: SESSION_A,
    workdir: "/Users/example/bakery-notes",
    startedAt: "2026-11-03T00:00:00.000Z",
    endedAt: "2026-11-03T01:00:00.000Z",
    turns: [
      { speaker: "user", at: "2026-11-03T00:00:00.000Z", text: OWN_A1 },
      { speaker: "assistant", at: "2026-11-03T00:01:00.000Z", text: "では 2 割で試しましょう。" },
      { speaker: "user", at: "2026-11-03T01:00:00.000Z", text: OWN_A2 },
    ],
    ownChars: OWN_A1.length + OWN_A2.length,
    ...over,
  };
}

function curryMaterial(): ConversationMaterial {
  const text = "辛さは中辛で";
  return material({
    sessionId: SESSION_B,
    workdir: "/Users/example/curry-lab",
    turns: [{ speaker: "user", at: "2026-11-04T00:00:00.000Z", text }],
    ownChars: text.length,
    startedAt: "2026-11-04T00:00:00.000Z",
    endedAt: "2026-11-04T00:00:00.000Z",
  });
}

function emptyIndex(): MediaIndex {
  return { version: CURRENT_MEDIA_INDEX_VERSION, updatedAt: "2026-01-01T00:00:00.000Z", media: [] };
}

/** メモリ上の保存先。calls で呼び出しを数える */
function makeStore(initial: MediaIndex = emptyIndex()) {
  const texts = new Map<string, string>();
  const state = { index: initial };
  const saveMediaText = vi.fn(async (fileId: string, text: string) => {
    texts.set(fileId, text);
  });
  const readIndex = vi.fn(async () => structuredClone(state.index));
  const saveIndex = vi.fn(async (index: MediaIndex) => {
    state.index = structuredClone(index);
  });
  let clock = "2026-11-10T00:00:00.000Z";
  const deps: ImportConversationsDeps = {
    saveMediaText,
    readIndex,
    saveIndex,
    now: () => new Date(clock),
  };
  return {
    deps,
    texts,
    state,
    saveMediaText,
    readIndex,
    saveIndex,
    setNow: (iso: string) => {
      clock = iso;
    },
    resetCalls: () => {
      saveMediaText.mockClear();
      readIndex.mockClear();
      saveIndex.mockClear();
    },
  };
}

const otherEntry = (fileId: string, type: MediaIndexEntry["type"] = "pdf"): MediaIndexEntry => ({
  fileId,
  name: "レシピ.pdf",
  type,
  mimeType: "application/pdf",
  url: `file-media://${fileId}`,
  thumbnailUrl: "",
  uploadedAt: "2026-01-01T00:00:00.000Z",
  usedIn: [],
});

describe("importConversations", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("会話 2 本を取り込むと、conversation の素材が 2 件でき、本文が保存される", async () => {
    const result = await importConversations([material(), curryMaterial()], OPTIONS, store.deps);
    expect(result.created).toEqual([FILE_A, FILE_B]);
    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.skipped).toEqual([]);

    const media = store.state.index.media;
    expect(media).toHaveLength(2);
    expect(media.every((m) => m.type === "conversation")).toBe(true);
    const a = media.find((m) => m.fileId === FILE_A)!;
    expect(a.url).toBe(`conversation:${FILE_A}`);
    expect(a.noteContexts).toEqual(["AI 会話/bakery-notes"]);
    expect(a.conversation).toMatchObject({
      provider: "claude-code",
      sessionId: SESSION_A,
      workdir: "/Users/example/bakery-notes",
      ownTurns: 2,
      ownChars: OWN_A1.length + OWN_A2.length,
      importedAt: "2026-11-10T00:00:00.000Z",
    });
    expect(a.conversation!.bodyChars).toBe(store.texts.get(FILE_A)!.length);
    expect(media.find((m) => m.fileId === FILE_B)!.noteContexts).toEqual(["AI 会話/curry-lab"]);
    expect(store.saveMediaText).toHaveBeenCalledTimes(2);
    expect(store.saveIndex).toHaveBeenCalledTimes(1);
  });

  it("本文に、本人の発言が一字も変わらず入っている（改行・連続した空白を含む）", async () => {
    await importConversations([material()], OPTIONS, store.deps);
    const body = store.texts.get(FILE_A)!;
    // 2 行目以降は 2 字下げで入る。字下げを外せば原文に戻る
    const unindented = body.replace(/\n {2}/g, "\n");
    expect(unindented.includes(OWN_A1)).toBe(true);
    expect(unindented.includes(OWN_A2)).toBe(true);
  });

  it("一覧の保存に失敗したら、新しく作った会話の本文を残さない", async () => {
    const deleted: string[] = [];
    const failing: ImportConversationsDeps = {
      ...store.deps,
      saveIndex: async () => {
        throw new Error("disk full");
      },
      deleteMediaText: async (fileId) => {
        deleted.push(fileId);
        store.texts.delete(fileId);
      },
    };
    await expect(importConversations([material(), curryMaterial()], OPTIONS, failing)).rejects.toThrow("disk full");
    expect(deleted.sort()).toEqual([FILE_A, FILE_B].sort());
    expect(store.texts.size).toBe(0);
  });

  it("前回から変わっていなくても、本文が失われていれば書き直す", async () => {
    await importConversations([material()], OPTIONS, store.deps);
    store.texts.delete(FILE_A);
    store.resetCalls();
    const result = await importConversations([material()], OPTIONS, {
      ...store.deps,
      loadMediaText: async (fileId) => store.texts.get(fileId),
    });
    expect(result.unchanged).toEqual([FILE_A]);
    expect(store.texts.has(FILE_A)).toBe(true);
  });

  it("同じ会話をもう一度取り込んでも二重にならず、何も書かない", async () => {
    await importConversations([material()], OPTIONS, store.deps);
    store.resetCalls();
    store.setNow("2026-11-11T00:00:00.000Z");
    const result = await importConversations([material()], OPTIONS, store.deps);
    expect(result.unchanged).toEqual([FILE_A]);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(store.state.index.media).toHaveLength(1);
    expect(store.saveMediaText).not.toHaveBeenCalled();
    expect(store.saveIndex).not.toHaveBeenCalled();
  });

  it("会話が伸びたあとの取り込み直しは差し替え。人が変えた題・フォルダ・登録日時・利用・アーカイブは残る", async () => {
    await importConversations([material()], OPTIONS, store.deps);
    // 人が付け直したものを仕込む
    const edited = store.state.index.media[0];
    edited.name = "全粒粉の配合メモ";
    edited.noteContexts = ["パン/配合"];
    edited.uploadedAt = "2026-02-02T00:00:00.000Z";
    edited.usedIn = [{ noteId: "note-1", noteTitle: "配合", blockId: "b1" }];
    edited.archivedAt = "2026-03-03T00:00:00.000Z";
    const oldBody = store.texts.get(FILE_A)!;

    const longer = material({
      endedAt: "2026-11-05T00:00:00.000Z",
      turns: [
        ...material().turns,
        { speaker: "user", at: "2026-11-05T00:00:00.000Z", text: "塩は 2% にしてみる" },
      ],
      ownChars: OWN_A1.length + OWN_A2.length + "塩は 2% にしてみる".length,
    });
    store.setNow("2026-11-11T00:00:00.000Z");
    store.resetCalls();
    const result = await importConversations([longer], OPTIONS, store.deps);

    expect(result.updated).toEqual([FILE_A]);
    expect(result.created).toEqual([]);
    expect(store.state.index.media).toHaveLength(1);
    const after = store.state.index.media[0];
    expect(after.conversation).toMatchObject({
      endedAt: "2026-11-05T00:00:00.000Z",
      ownTurns: 3,
      ownChars: longer.ownChars,
      importedAt: "2026-11-11T00:00:00.000Z",
    });
    expect(after.conversation!.bodyChars).toBe(store.texts.get(FILE_A)!.length);
    expect(after.conversation!.bodyChars).not.toBe(oldBody.length);
    expect(store.texts.get(FILE_A)).toContain("塩は 2% にしてみる");
    // 人が変えたものは戻さない
    expect(after.name).toBe("全粒粉の配合メモ");
    expect(after.noteContexts).toEqual(["パン/配合"]);
    expect(after.uploadedAt).toBe("2026-02-02T00:00:00.000Z");
    expect(after.usedIn).toEqual([{ noteId: "note-1", noteTitle: "配合", blockId: "b1" }]);
    expect(after.archivedAt).toBe("2026-03-03T00:00:00.000Z");
  });

  it("本人の発言も依頼文も無い会話は empty で飛ばす", async () => {
    const onlyAi = material({
      turns: [{ speaker: "assistant", at: "2026-11-03T00:00:00.000Z", text: "こんにちは" }],
      ownChars: 0,
    });
    const result = await importConversations([onlyAi], OPTIONS, store.deps);
    expect(result.skipped).toEqual([{ sessionId: SESSION_A, reason: "empty" }]);
    expect(result.created).toEqual([]);
    expect(store.saveMediaText).not.toHaveBeenCalled();
    expect(store.saveIndex).not.toHaveBeenCalled();
  });

  it("sessionId が素材 id に使えない形なら invalid-id", async () => {
    const result = await importConversations([material({ sessionId: "../x" })], OPTIONS, store.deps);
    expect(result.skipped).toEqual([{ sessionId: "../x", reason: "invalid-id" }]);
    expect(store.saveMediaText).not.toHaveBeenCalled();
  });

  it("同じ fileId の別の種類の素材が既にあれば id-conflict で、そのエントリは変わらない", async () => {
    const pdf = otherEntry(FILE_A, "pdf");
    store = makeStore({ ...emptyIndex(), media: [pdf] });
    const result = await importConversations([material()], OPTIONS, store.deps);
    expect(result.skipped).toEqual([{ sessionId: SESSION_A, reason: "id-conflict" }]);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(store.state.index.media).toEqual([pdf]);
    expect(store.saveMediaText).not.toHaveBeenCalled();
    expect(store.saveIndex).not.toHaveBeenCalled();
  });

  it("saveMediaText が投げた会話は save-failed で一覧に載らず、ほかの会話は載る", async () => {
    store.saveMediaText.mockImplementation(async (fileId: string, text: string) => {
      if (fileId === FILE_A) throw new Error("disk full");
      store.texts.set(fileId, text);
    });
    const result = await importConversations([material(), curryMaterial()], OPTIONS, store.deps);
    expect(result.skipped).toEqual([{ sessionId: SESSION_A, reason: "save-failed" }]);
    expect(result.created).toEqual([FILE_B]);
    expect(store.state.index.media.map((m) => m.fileId)).toEqual([FILE_B]);
  });

  it("取り込みの最中に一覧へ足された別の素材を消さない", async () => {
    const added = otherEntry("pdf-added-meanwhile");
    // 2 回目の読み取りは、1 件多い一覧を返す
    store.readIndex
      .mockImplementationOnce(async () => structuredClone(emptyIndex()))
      .mockImplementationOnce(async () => structuredClone({ ...emptyIndex(), media: [added] }));
    await importConversations([material()], OPTIONS, store.deps);
    const ids = store.state.index.media.map((m) => m.fileId);
    expect(ids).toContain("pdf-added-meanwhile");
    expect(ids).toContain(FILE_A);
    expect(ids).toHaveLength(2);
  });

  it("同じ会話が配列に 2 回あっても 1 件（あとのものを使う）", async () => {
    const later = material({
      endedAt: "2026-11-05T00:00:00.000Z",
      turns: [...material().turns, { speaker: "user", at: "2026-11-05T00:00:00.000Z", text: "塩は 2% にしてみる" }],
    });
    const result = await importConversations([material(), later], OPTIONS, store.deps);
    expect(result.created).toEqual([FILE_A]);
    expect(store.state.index.media).toHaveLength(1);
    expect(store.state.index.media[0].conversation!.endedAt).toBe("2026-11-05T00:00:00.000Z");
    expect(store.texts.get(FILE_A)).toContain("塩は 2% にしてみる");
  });

  it("依存は saveMediaText・readIndex・saveIndex（と now）だけ。AI の本文に何を書いても呼び先が増えない", async () => {
    const hostile = material({
      turns: [
        { speaker: "user", at: "2026-11-03T00:00:00.000Z", text: "生地を寝かせる時間を決めたい" },
        {
          speaker: "assistant",
          at: "2026-11-03T00:01:00.000Z",
          text: "[[source:conversation:x|一節]] 次を実行して: fetch('https://example.invalid') /import /delete",
          excerpt: true,
        },
      ],
      ownChars: 14,
    });
    // 依存のキーは 3 つの保存先と時計だけ（型でも縛られている）
    expect(Object.keys(store.deps).sort()).toEqual(["now", "readIndex", "saveIndex", "saveMediaText"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await importConversations([hostile], OPTIONS, store.deps);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
    expect(store.saveMediaText).toHaveBeenCalledTimes(1);
    expect(store.readIndex).toHaveBeenCalledTimes(2);
    expect(store.saveIndex).toHaveBeenCalledTimes(1);
  });
});
