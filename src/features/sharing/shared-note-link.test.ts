// shared-note-link（共有エントリ id → 手元のノート id）のテスト。
//
// ここで守りたいこと:
//   1. 共有した時点の控えが当たれば、ノートを 1 件も読まずに引ける
//   2. 控えが無ければ走査で探し、見つかったら控えを書く（次から走査しない）
//   3. 控えのノートが手元から消えていたら走査に落ちる
//   4. 読めないノート・書けない appData で探索ごと止めない

import { describe, it, expect } from "vitest";

import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import {
  findNoteBySharedId,
  loadSharedNoteLink,
  resolveSharedNoteId,
  saveSharedNoteLink,
} from "./shared-note-link";

/** readAppData / writeAppData だけを持つ最小のプロバイダ（fork-base.test と同じ作り） */
function fakeProvider(store = new Map<string, unknown>()) {
  const provider = {
    async readAppData(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async writeAppData(key: string, data: unknown) {
      store.set(key, data);
    },
  } as unknown as StorageProvider;
  return { provider, store };
}

/** sharedRef だけを持つ最小のノート */
function noteDoc(sharedId?: string): GraphiumDocument {
  return {
    version: 6,
    title: "測定手順",
    pages: [],
    ...(sharedId
      ? { sharedRef: { id: sharedId, type: "note" as const, sharedAt: "2026-01-01T00:00:00Z", hash: "sha256:x" } }
      : {}),
  } as unknown as GraphiumDocument;
}

describe("saveSharedNoteLink / loadSharedNoteLink", () => {
  it("控えた対応をそのまま読み戻す", async () => {
    const { provider } = fakeProvider();
    await saveSharedNoteLink("shared-1", "note-a", provider);
    const link = await loadSharedNoteLink("shared-1", provider);
    expect(link?.noteId).toBe("note-a");
    expect(link?.sharedId).toBe("shared-1");
    expect(link?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("共有エントリごとに別のキーで持つ", async () => {
    const { provider, store } = fakeProvider();
    await saveSharedNoteLink("shared-1", "note-a", provider);
    await saveSharedNoteLink("shared-2", "note-b", provider);
    expect(store.size).toBe(2);
    expect((await loadSharedNoteLink("shared-2", provider))?.noteId).toBe("note-b");
  });

  it("キーに Windows で使えない文字を混ぜない", async () => {
    const { provider, store } = fakeProvider();
    await saveSharedNoteLink("shared:1/x", "note-a", provider);
    for (const key of store.keys()) expect(key).not.toMatch(/[:\\/]/);
    expect((await loadSharedNoteLink("shared:1/x", provider))?.noteId).toBe("note-a");
  });

  it("控えが無い / 壊れていれば null", async () => {
    const { provider, store } = fakeProvider();
    expect(await loadSharedNoteLink("missing", provider)).toBeNull();
    store.set("shared-note-link-broken", { sharedId: "broken" });
    expect(await loadSharedNoteLink("broken", provider)).toBeNull();
  });

  it("書けなくても呼び出し側を止めない", async () => {
    const provider = {
      async readAppData() {
        return null;
      },
      async writeAppData() {
        throw new Error("disk full");
      },
    } as unknown as StorageProvider;
    await expect(saveSharedNoteLink("shared-1", "note-a", provider)).resolves.toBeUndefined();
  });
});

describe("findNoteBySharedId", () => {
  const docs: Record<string, GraphiumDocument> = {
    "note-a": noteDoc(),
    "note-b": noteDoc("shared-1"),
    "note-c": noteDoc("shared-2"),
  };
  const loadNote = async (id: string) => docs[id] ?? null;

  it("sharedRef が一致するノートを返す", async () => {
    expect(await findNoteBySharedId("shared-1", ["note-a", "note-b", "note-c"], loadNote)).toBe(
      "note-b",
    );
  });

  it("見つかった時点で読むのをやめる", async () => {
    const read: string[] = [];
    const counting = async (id: string) => {
      read.push(id);
      return docs[id] ?? null;
    };
    await findNoteBySharedId("shared-1", ["note-a", "note-b", "note-c"], counting);
    expect(read).toEqual(["note-a", "note-b"]);
  });

  it("読めないノートは飛ばして続ける", async () => {
    const throwing = async (id: string) => {
      if (id === "note-a") throw new Error("読めません");
      return docs[id] ?? null;
    };
    expect(await findNoteBySharedId("shared-1", ["note-a", "note-b"], throwing)).toBe("note-b");
  });

  it("どれも指していなければ null", async () => {
    expect(await findNoteBySharedId("shared-9", ["note-a", "note-b"], loadNote)).toBeNull();
  });
});

describe("resolveSharedNoteId", () => {
  const docs: Record<string, GraphiumDocument> = {
    "note-a": noteDoc(),
    "note-b": noteDoc("shared-1"),
  };

  it("控えがあればノートを 1 件も読まない", async () => {
    const { provider } = fakeProvider();
    await saveSharedNoteLink("shared-1", "note-b", provider);
    const read: string[] = [];
    const noteId = await resolveSharedNoteId("shared-1", {
      noteIds: ["note-a", "note-b"],
      loadNote: async (id) => {
        read.push(id);
        return docs[id] ?? null;
      },
      provider,
    });
    expect(noteId).toBe("note-b");
    expect(read).toEqual([]);
  });

  it("控えが無ければ走査して探し、見つけた対応を控える", async () => {
    const { provider, store } = fakeProvider();
    const noteId = await resolveSharedNoteId("shared-1", {
      noteIds: ["note-a", "note-b"],
      loadNote: async (id) => docs[id] ?? null,
      provider,
    });
    expect(noteId).toBe("note-b");
    expect((await loadSharedNoteLink("shared-1", provider))?.noteId).toBe("note-b");
    expect(store.size).toBe(1);
  });

  it("控えのノートが手元に無ければ走査に落ちる", async () => {
    const { provider } = fakeProvider();
    // 別の端末で共有した控えが同期されてきた想定（そのノートはこの端末に無い）
    await saveSharedNoteLink("shared-1", "note-gone", provider);
    const noteId = await resolveSharedNoteId("shared-1", {
      noteIds: ["note-a", "note-b"],
      loadNote: async (id) => docs[id] ?? null,
      hasNote: (id) => id in docs,
      provider,
    });
    expect(noteId).toBe("note-b");
  });

  it("どこにも無ければ null（呼び出し側が案内を出す）", async () => {
    const { provider } = fakeProvider();
    const noteId = await resolveSharedNoteId("shared-9", {
      noteIds: ["note-a", "note-b"],
      loadNote: async (id) => docs[id] ?? null,
      provider,
    });
    expect(noteId).toBeNull();
  });
});
