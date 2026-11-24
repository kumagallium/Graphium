// bulkShare のテスト。share コアは share-note / share-knowledge のテストが
// 押さえているので、ここでは集計・継続・キャンセル・書き戻し失敗の扱いに絞る。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { bulkShare, orderPlansFirst, type BulkShareDeps, type BulkShareTarget } from "./bulk-share";
import type { GraphiumIndex } from "../navigation/index-file";
import { __setSharedLibraryLoaderForTest, refreshSharedLibrary } from "./shared-library-store";
import { t } from "../../i18n";
import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";
import type {
  MediaIndexEntry,
  MediaSharedRef,
} from "../asset-browser/media-index";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };

class FakeFs {
  entries = new Map<string, string>();
  /** key = hash → base64（素材の blob） */
  blobs = new Map<string, string>();
  /** key = fileId → base64（read_media_file の戻り値） */
  mediaFiles = new Map<string, string>();
  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case "shared_write":
          this.entries.set(`${args.entryType}/${args.id}`, args.content);
          return null;
        case "shared_read": {
          const v = this.entries.get(`${args.entryType}/${args.id}`);
          if (!v) throw new Error("not found");
          return v;
        }
        case "read_media_file": {
          const v = this.mediaFiles.get(args.fileId);
          if (!v) throw new Error(`media not found: ${args.fileId}`);
          return v;
        }
        case "shared_blob_write":
          this.blobs.set(args.hash, args.contentBase64);
          return null;
        case "shared_blob_exists":
          return this.blobs.has(args.hash);
        default:
          throw new Error(`unmocked: ${cmd}`);
      }
    });
  }
}

let fs: FakeFs;
beforeEach(() => {
  fs = new FakeFs();
  fs.install();
});

function makeNote(title: string): GraphiumDocument {
  return {
    version: 5,
    title,
    pages: [
      {
        id: "p1",
        title,
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hi" }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-05-04T00:00:00Z",
    modifiedAt: "2026-05-04T00:00:00Z",
  } as GraphiumDocument;
}

function makeWiki(title: string): GraphiumDocument {
  return {
    ...makeNote(title),
    source: "ai",
    wikiMeta: {
      kind: "claim",
      derivedFromNotes: [],
      derivedFromChats: [],
      generatedAt: "2026-05-04T00:00:00Z",
      generatedBy: { model: "m", version: "1" },
    },
  } as GraphiumDocument;
}

function makeDeps(overrides: Partial<BulkShareDeps> = {}): {
  deps: BulkShareDeps;
  savedNotes: Map<string, GraphiumDocument>;
  savedWikis: Map<string, GraphiumDocument>;
} {
  const notes = new Map<string, GraphiumDocument>([
    ["n1", makeNote("Note one")],
    ["n2", makeNote("Note two")],
  ]);
  const wikis = new Map<string, GraphiumDocument>([["w1", makeWiki("Claim one")]]);
  const savedNotes = new Map<string, GraphiumDocument>();
  const savedWikis = new Map<string, GraphiumDocument>();
  const deps: BulkShareDeps = {
    root: "/shared",
    author,
    loadNote: async (id) => notes.get(id) ?? null,
    saveNote: async (id, doc) => {
      savedNotes.set(id, doc);
    },
    loadKnowledge: async (id) => wikis.get(id) ?? null,
    saveKnowledge: async (id, doc) => {
      savedWikis.set(id, doc);
      return true;
    },
    ...overrides,
  };
  return { deps, savedNotes, savedWikis };
}

describe("bulkShare", () => {
  it("shares a mix of notes and knowledge, writing sharedRef back", async () => {
    const { deps, savedNotes, savedWikis } = makeDeps();
    const summary = await bulkShare(
      [
        { id: "n1", kind: "note" },
        { id: "w1", kind: "knowledge" },
      ],
      deps,
    );
    expect(summary.shared).toBe(2);
    expect(summary.updated).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.cancelled).toBe(false);
    expect(savedNotes.get("n1")?.sharedRef?.type).toBe("note");
    expect(savedWikis.get("w1")?.sharedRef?.type).toBe("knowledge");
  });

  it("continues past a missing document and reports it as failed", async () => {
    const { deps } = makeDeps();
    const summary = await bulkShare(
      [
        { id: "missing", kind: "note" },
        { id: "n2", kind: "note" },
      ],
      deps,
    );
    expect(summary.failed).toBe(1);
    expect(summary.shared).toBe(1);
    expect(summary.results[0].error).toMatch(/not found/i);
  });

  it("counts re-shares as updates", async () => {
    const { deps, savedNotes } = makeDeps();
    await bulkShare([{ id: "n1", kind: "note" }], deps);
    // 1 回目の sharedRef 付き doc を次回のロード結果にする
    const withRef = savedNotes.get("n1")!;
    const summary = await bulkShare([{ id: "n1", kind: "note" }], {
      ...deps,
      loadNote: async () => withRef,
    });
    expect(summary.updated).toBe(1);
    expect(summary.shared).toBe(0);
  });

  it("treats saveKnowledge returning false as a failure", async () => {
    const { deps } = makeDeps({ saveKnowledge: async () => false });
    const summary = await bulkShare([{ id: "w1", kind: "knowledge" }], deps);
    expect(summary.failed).toBe(1);
    expect(summary.results[0].error).toMatch(/sharedRef/);
  });

  it("stops at cancellation and reports partial results", async () => {
    let processed = 0;
    const { deps } = makeDeps({
      onProgress: () => {
        processed++;
      },
      isCancelled: () => processed >= 1,
    });
    const summary = await bulkShare(
      [
        { id: "n1", kind: "note" },
        { id: "n2", kind: "note" },
      ],
      deps,
    );
    expect(summary.cancelled).toBe(true);
    expect(summary.results).toHaveLength(1);
  });
});

// --- 素材（media）の一括共有 ---
// 単体経路（MaterialActionsMenu）と同じ振り分け（URL は reference / それ以外は
// blob 付き data-manifest）と、同じ実効フォルダが載ることを押さえる。

function makeMediaEntry(overrides: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return {
    fileId: "media-1",
    name: "photo.jpg",
    type: "image",
    mimeType: "image/jpeg",
    url: "file-media://media-1",
    thumbnailUrl: "",
    uploadedAt: "2026-05-04T00:00:00Z",
    usedIn: [],
    ...overrides,
  };
}

function makeMediaDeps(
  entries: MediaIndexEntry[],
  overrides: Partial<BulkShareDeps> = {},
): { deps: BulkShareDeps; savedRefs: Map<string, MediaSharedRef> } {
  const savedRefs = new Map<string, MediaSharedRef>();
  const base = makeDeps().deps;
  const deps: BulkShareDeps = {
    ...base,
    blobRoot: "/blobs",
    loadMedia: (fileId) => entries.find((e) => e.fileId === fileId) ?? null,
    saveMediaSharedRef: (entry, sharedRef) => {
      savedRefs.set(entry.fileId, sharedRef);
    },
    ...overrides,
  };
  return { deps, savedRefs };
}

describe("bulkShare — media", () => {
  it("shares a media file and writes the sharedRef back", async () => {
    fs.mediaFiles.set("media-1", btoa("image bytes"));
    const { deps, savedRefs } = makeMediaDeps([makeMediaEntry()]);
    const summary = await bulkShare([{ id: "media-1", kind: "media" }], deps);

    expect(summary.shared).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results[0].title).toBe("photo.jpg");
    expect(savedRefs.get("media-1")?.type).toBe("data-manifest");
    expect(savedRefs.get("media-1")?.blobHash).toMatch(/^sha256:/);
  });

  it("puts the effective folders (own ∪ derived from notes) on the shared entry", async () => {
    fs.mediaFiles.set("media-1", btoa("image bytes"));
    const entry = makeMediaEntry({
      noteContexts: ["材料X"],
      usedIn: [{ noteId: "n1", noteTitle: "Note one", blockId: "b1" }],
    });
    const { deps } = makeMediaDeps([entry], {
      noteFolderLookup: new Map([["n1", ["測定/XRD"]]]),
    });
    await bulkShare([{ id: "media-1", kind: "media" }], deps);

    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.noteContexts).toEqual(["材料X", "測定/XRD"]);
  });

  it("shares a URL bookmark as a reference (no blob root needed)", async () => {
    const entry = makeMediaEntry({
      fileId: "url-1",
      type: "url",
      name: "Some article",
      url: "https://example.com/a",
    });
    const { deps, savedRefs } = makeMediaDeps([entry], { blobRoot: undefined });
    const summary = await bulkShare([{ id: "url-1", kind: "media" }], deps);

    expect(summary.shared).toBe(1);
    expect(savedRefs.get("url-1")?.type).toBe("reference");
  });

  it("fails a non-URL asset when no blob root is configured", async () => {
    fs.mediaFiles.set("media-1", btoa("image bytes"));
    const { deps, savedRefs } = makeMediaDeps([makeMediaEntry()], { blobRoot: undefined });
    const summary = await bulkShare([{ id: "media-1", kind: "media" }], deps);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].error).toMatch(/large files folder/i);
    // 共有もしていない（shared 側に書かれていない）
    expect(fs.entries.size).toBe(0);
    expect(savedRefs.size).toBe(0);
  });

  it("reports a failed sharedRef write-back as a failure", async () => {
    fs.mediaFiles.set("media-1", btoa("image bytes"));
    const { deps } = makeMediaDeps([makeMediaEntry()], {
      saveMediaSharedRef: () => {
        throw new Error("index write failed");
      },
    });
    const summary = await bulkShare([{ id: "media-1", kind: "media" }], deps);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].error).toMatch(/index write failed/);
  });

  it("keeps going when an asset is missing from the index", async () => {
    fs.mediaFiles.set("media-1", btoa("image bytes"));
    const { deps, savedRefs } = makeMediaDeps([makeMediaEntry()]);
    const summary = await bulkShare(
      [
        { id: "gone", kind: "media" },
        { id: "media-1", kind: "media" },
      ],
      deps,
    );

    expect(summary.failed).toBe(1);
    expect(summary.shared).toBe(1);
    expect(savedRefs.has("media-1")).toBe(true);
  });
});

// --- §24: 共有コピーの AI チャット / 編集来歴 ---
// 剥がし自体は share-note のテストが押さえているので、ここでは deps の値が
// ノート / Knowledge の共有呼び出しまで届いているかだけを見る。

describe("bulkShare — includePrivateHistory の受け渡し", () => {
  const chats: NonNullable<GraphiumDocument["chats"]> = [
    {
      id: "chat-1",
      scopeBlockId: "b1",
      scopeType: "block",
      messages: [{ role: "user", content: "秘密のメモ", timestamp: "2026-05-04T00:00:00Z" }],
      createdAt: "2026-05-04T00:00:00Z",
      modifiedAt: "2026-05-04T00:00:00Z",
    },
  ];

  function withChats(doc: GraphiumDocument): GraphiumDocument {
    return { ...doc, chats, documentProvenance: { revisions: [], activities: [], agents: [] } };
  }

  /**
   * shared 側に書かれた body（GraphiumDocument JSON）を全件読む。
   * atob はバイト列を返すだけなので、日本語が化けないよう TextDecoder を通す。
   */
  function storedBodies(): GraphiumDocument[] {
    return [...fs.entries.values()].map((raw) => {
      const bytes = Uint8Array.from(atob(JSON.parse(raw).body_base64), (c) =>
        c.charCodeAt(0),
      );
      return JSON.parse(new TextDecoder().decode(bytes));
    });
  }

  it("未指定なら note / knowledge のどちらの共有 body にも残らない", async () => {
    const { deps } = makeDeps({
      loadNote: async () => withChats(makeNote("Note one")),
      loadKnowledge: async () => withChats(makeWiki("Claim one")),
    });
    const summary = await bulkShare(
      [
        { id: "n1", kind: "note" },
        { id: "w1", kind: "knowledge" },
      ],
      deps,
    );
    expect(summary.shared).toBe(2);
    for (const body of storedBodies()) {
      expect(body.chats).toBeUndefined();
      expect(body.documentProvenance).toBeUndefined();
    }
  });

  it("true を渡すと note / knowledge の共有 body に残る", async () => {
    const { deps } = makeDeps({
      includePrivateHistory: true,
      loadNote: async () => withChats(makeNote("Note one")),
      loadKnowledge: async () => withChats(makeWiki("Claim one")),
    });
    const summary = await bulkShare(
      [
        { id: "n1", kind: "note" },
        { id: "w1", kind: "knowledge" },
      ],
      deps,
    );
    expect(summary.shared).toBe(2);
    const bodies = storedBodies();
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.chats).toEqual(chats);
      expect(body.documentProvenance).toBeDefined();
    }
  });

  it("手元に書き戻す doc には chats が残る（true / false どちらでも）", async () => {
    const { deps, savedNotes } = makeDeps({
      loadNote: async () => withChats(makeNote("Note one")),
    });
    await bulkShare([{ id: "n1", kind: "note" }], deps);
    expect(savedNotes.get("n1")?.chats).toEqual(chats);
  });
});

describe("bulkShare（共有フォルダが複数あるとき）", () => {
  const ORG = "/shared";
  const DEPT = "/mnt/dept";
  const writeRoots = () =>
    invokeMock.mock.calls.filter((c) => c[0] === "shared_write").map((c) => (c[1] as { root: string }).root);
  const emptyByType = { note: [], knowledge: [], reference: [], "data-manifest": [], template: [], report: [], comment: [], proposal: [] };

  afterEach(() => {
    __setSharedLibraryLoaderForTest(null, { root: null });
  });

  it("新規は既定の共有先、再共有は共有コピーがあるフォルダへ書く", async () => {
    const { deps, savedNotes } = makeDeps();
    await bulkShare([{ id: "n1", kind: "note" }], deps);
    expect(writeRoots()).toEqual([ORG]);
    const withRef = savedNotes.get("n1")!;
    // 共有コピーは DEPT にある
    __setSharedLibraryLoaderForTest(
      async (root) => ({
        entries: {
          ...emptyByType,
          note: root === DEPT ? [{ id: withRef.sharedRef!.id, type: "note" } as never] : [],
        },
        errors: {},
      }),
      { roots: [ORG, DEPT] },
    );
    await refreshSharedLibrary();
    invokeMock.mockClear();
    fs.install();
    const summary = await bulkShare([{ id: "n1", kind: "note" }], { ...deps, loadNote: async () => withRef });
    expect(summary.updated).toBe(1);
    expect(writeRoots()).toEqual([DEPT]);
  });

  it("共有コピーの居場所が分からず、届かないフォルダがあるときは書かずに失敗させる", async () => {
    const { deps, savedNotes } = makeDeps();
    await bulkShare([{ id: "n1", kind: "note" }], deps);
    const withRef = savedNotes.get("n1")!;
    __setSharedLibraryLoaderForTest(
      async (root) => {
        if (root === DEPT) throw new Error("not mounted");
        return { entries: emptyByType, errors: {} };
      },
      { roots: [ORG, DEPT] },
    );
    await refreshSharedLibrary();
    invokeMock.mockClear();
    fs.install();
    const summary = await bulkShare([{ id: "n1", kind: "note" }], { ...deps, loadNote: async () => withRef });
    expect(summary.failed).toBe(1);
    expect(summary.results[0].error).toBe(t("share.failed.folderUnreachable"));
    expect(writeRoots()).toEqual([]);
  });
});

describe("bulkShare — リンクした素材", () => {
  it("リンクした素材は飛ばし、共有・失敗のどちらにも数えない", async () => {
    const linked = makeMediaEntry({
      fileId: "link-1",
      type: "url",
      name: "a.pdf",
      url: "graphium-place://place-1/docs/a.pdf",
    });
    const { deps, savedRefs } = makeMediaDeps([linked]);
    const summary = await bulkShare([{ id: "link-1", kind: "media" }], deps);

    expect(summary.shared).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.results).toHaveLength(0);
    expect(summary.skippedLinked).toBe(1);
    expect(fs.entries.size).toBe(0);
    expect(savedRefs.size).toBe(0);
  });
});

describe("bulkShare — 計画の行との対応", () => {
  const cell = (text: string, rowId?: string) => ({
    type: "tableCell",
    content: [{ type: "text", text, styles: rowId ? { tableRowIdentity: rowId } : {} }],
  });
  const makePlan = (): GraphiumDocument =>
    ({
      ...makeNote("Bread plan"),
      kind: "plan",
      pages: [
        {
          id: "p1",
          title: "Bread plan",
          blocks: [
            {
              id: "tbl-1",
              type: "table",
              content: {
                type: "tableContent",
                rows: [{ cells: [cell("Step")] }, { cells: [cell("@Knead", "row_a")] }],
              },
              children: [],
            },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
          tableMeta: { "tbl-1": { columns: { Step: ["note-link"] }, noteLinks: { "@Knead": "row1" } } },
        },
      ],
    }) as unknown as GraphiumDocument;
  const index = {
    version: 1,
    notes: [
      { noteId: "plan", title: "Bread plan", kind: "plan", modifiedAt: "2026-05-04T00:00:00Z", outgoingLinks: [{ targetNoteId: "row1" }] },
      { noteId: "row1", title: "Knead", kind: "note", modifiedAt: "2026-05-04T00:00:00Z", outgoingLinks: [] },
    ],
  } as unknown as GraphiumIndex;

  it("計画ノートを前に寄せる（それ以外の順は変えない）", () => {
    const targets: BulkShareTarget[] = [
      { id: "row1", kind: "note" },
      { id: "w1", kind: "knowledge" },
      { id: "plan", kind: "note" },
    ];
    expect(orderPlansFirst(targets, index).map((t) => t.id)).toEqual(["plan", "row1", "w1"]);
    expect(orderPlansFirst(targets, null)).toBe(targets);
  });

  it("計画と行のノートをまとめて共有すると、行のノートに計画の共有の id と行が添えられる", async () => {
    const notes = new Map<string, GraphiumDocument>([
      ["plan", makePlan()],
      ["row1", { ...makeNote("Knead"), derivedFromNoteId: "plan", derivedFromBlockId: "tbl-1" } as GraphiumDocument],
    ]);
    const { deps } = makeDeps({
      noteIndex: index,
      // 書き戻した sharedRef を次の読み出しで返す（行のノートが計画の共有の id を拾えるように）
      loadNote: async (id) => notes.get(id) ?? null,
      saveNote: async (id, doc) => {
        notes.set(id, doc);
      },
    });
    // 行のノートを先に渡しても、計画が先に共有される
    const summary = await bulkShare(
      [
        { id: "row1", kind: "note" },
        { id: "plan", kind: "note" },
      ],
      deps,
    );
    expect(summary.failed).toBe(0);
    const planSharedId = notes.get("plan")!.sharedRef!.id;
    const rowSharedId = notes.get("row1")!.sharedRef!.id;
    const entryOf = (id: string) =>
      [...fs.entries.values()].map((raw) => JSON.parse(raw).entry).find((e) => e.id === id);
    const rowEntry = entryOf(rowSharedId);
    expect(rowEntry.extra.planRow).toEqual({
      planIds: [planSharedId],
      tableBlockId: "tbl-1",
      rowId: "row_a",
      rowName: "Knead",
    });
    // 計画そのものには付かない
    expect("planRow" in entryOf(planSharedId).extra).toBe(false);
  });

  it("共有に出ていない計画の行のノートには何も添えない", async () => {
    const notes = new Map<string, GraphiumDocument>([
      ["plan", makePlan()],
      ["row1", { ...makeNote("Knead"), derivedFromNoteId: "plan" } as GraphiumDocument],
    ]);
    const { deps } = makeDeps({ noteIndex: index, loadNote: async (id) => notes.get(id) ?? null });
    await bulkShare([{ id: "row1", kind: "note" }], deps);
    const stored = JSON.parse([...fs.entries.values()][0]).entry;
    expect("planRow" in stored.extra).toBe(false);
  });
});
