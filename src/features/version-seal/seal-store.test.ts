import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import {
  deleteSnapshot,
  listSnapshots,
  renameSnapshot,
  SealedSnapshotError,
  takeSnapshot,
} from "../version-snapshots/snapshot-store";
import {
  buildSealManifest,
  collectSealMediaRefs,
  sha256HexOfText,
} from "./manifest";
import {
  checkSealChain,
  checkSealLocally,
  loadSealText,
  NotSealableError,
  sealKey,
  sealSnapshot,
} from "./seal-store";

/**
 * appData を in-memory で持つ最小プロバイダ。
 * filesystem プロバイダと同じく、書くときに JSON 文字列にして読むときに戻す
 * （封印ファイルの文字列が往復で変わらないことを確かめるため）。
 */
function makeProvider(media: Record<string, string> = {}) {
  const store = new Map<string, string>();
  const mediaBytes = new Map(Object.entries(media).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  const provider = {
    readAppData: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    writeAppData: async (k: string, v: unknown) => {
      store.set(k, JSON.stringify(v));
    },
    readMediaBytes: async (id: string, max?: number) => {
      const b = mediaBytes.get(id);
      if (!b) return undefined;
      if (max !== undefined && b.byteLength > max) return undefined;
      return b;
    },
    extractFileId: (url: string) => (url.startsWith("media://") ? url.slice("media://".length) : null),
  } as unknown as StorageProvider;
  return { provider, store, mediaBytes };
}

function makeDoc(text: string, extraBlocks: any[] = []): GraphiumDocument {
  return {
    version: 5,
    title: "パン生地の発酵",
    pages: [
      {
        id: "p1",
        title: "パン生地の発酵",
        blocks: [
          { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] },
          ...extraBlocks,
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-11-01T00:00:00.000Z",
    modifiedAt: "2026-11-01T00:00:00.000Z",
  } as unknown as GraphiumDocument;
}

const author = { name: "テスト" };

describe("sealSnapshot", () => {
  it("封印ファイルを保存し、版のメタに要約を書く", async () => {
    const { provider } = makeProvider();
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("一次発酵 60 分"));
    const res = await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author });
    expect(res.status).toBe("sealed");
    const [stored] = await listSnapshots(provider, "n1");
    expect(stored.seal?.sealIndex).toBe(1);
    const text = await loadSealText(provider, meta.id);
    expect(text).not.toBeNull();
    // 保存を往復しても文字列は変わらず、ハッシュがメタと一致する
    expect(await sha256HexOfText(text!)).toBe(stored.seal?.sealHash);
    const parsed = JSON.parse(text!);
    expect(parsed.format).toBe("graphium-seal/1");
    expect(parsed.prevSealHash).toBeNull();
  });

  it("2 つ目の封印は 1 つ目のハッシュを覚えている（連鎖）", async () => {
    const { provider } = makeProvider();
    const a = await takeSnapshot(provider, "n1", makeDoc("v1"));
    const b = await takeSnapshot(provider, "n1", makeDoc("v2"));
    await sealSnapshot(provider, { noteId: "n1", snapshotId: a.meta.id, author });
    await sealSnapshot(provider, { noteId: "n1", snapshotId: b.meta.id, author });
    const metas = await listSnapshots(provider, "n1");
    const second = JSON.parse((await loadSealText(provider, b.meta.id))!);
    expect(second.sealIndex).toBe(2);
    expect(second.prevSealHash).toBe(metas[0].seal?.sealHash);
    expect((await checkSealChain(provider, "n1")).problems).toEqual([]);
  });

  it("同じ版をもう一度封印しても変わらない", async () => {
    const { provider } = makeProvider();
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("v1"));
    await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author });
    const again = await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author });
    expect(again.status).toBe("already_sealed");
  });

  it("同じ版を同時に封印しても、保存された封印ファイルとメタのハッシュがずれない", async () => {
    const { provider } = makeProvider();
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("v1"));
    let t = 0;
    // sealedAt を変えて、2 本の封印ファイルの文面を別物にする
    const now = () => new Date(Date.UTC(2026, 10, 9, 0, 0, t++));
    const [a, b] = await Promise.all([
      sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author, now }),
      sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author, now }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["already_sealed", "sealed"]);
    const [m] = await listSnapshots(provider, "n1");
    const text = await loadSealText(provider, meta.id);
    expect(await sha256HexOfText(text!)).toBe(m.seal!.sealHash);
    expect((await checkSealLocally(provider, m)).manifestIntact).toBe(true);
  });

  it("AI が自動で残した版は封印できない", async () => {
    const { provider } = makeProvider();
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("v1"), undefined, "ai_rewrite");
    await expect(
      sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author }),
    ).rejects.toBeInstanceOf(NotSealableError);
  });

  it("封印した版は削除も改名もできない", async () => {
    const { provider } = makeProvider();
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("v1"));
    await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author });
    await expect(deleteSnapshot(provider, "n1", meta.id)).rejects.toBeInstanceOf(SealedSnapshotError);
    await expect(renameSnapshot(provider, "n1", meta.id, "提出版")).rejects.toBeInstanceOf(SealedSnapshotError);
    expect(await listSnapshots(provider, "n1")).toHaveLength(1);
  });
});

describe("素材", () => {
  const imageBlock = { id: "img1", type: "image", props: { url: "media://f-image" }, content: [], children: [] };

  it("素材の中身のハッシュを封印ファイルに入れ、変わったら分かる", async () => {
    const { provider, mediaBytes } = makeProvider({ "f-image": "元の画像" });
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("v1", [imageBlock]));
    const res = await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author });
    if (res.status !== "sealed") throw new Error("sealed のはず");
    expect(res.manifest.media).toHaveLength(1);
    expect(res.manifest.media[0]).toMatchObject({ fileId: "f-image", blockIds: ["img1"] });
    expect(res.manifest.media[0].sha256).toMatch(/^sha256:[0-9a-f]{64}$/);

    const [sealed] = await listSnapshots(provider, "n1");
    expect((await checkSealLocally(provider, sealed)).media[0].status).toBe("same");
    mediaBytes.set("f-image", new TextEncoder().encode("差し替えた画像"));
    expect((await checkSealLocally(provider, sealed)).media[0].status).toBe("changed");
    mediaBytes.delete("f-image");
    expect((await checkSealLocally(provider, sealed)).media[0].status).toBe("missing");
  });

  it("上限を超える素材はハッシュを諦めて理由を残す", async () => {
    const { provider } = makeProvider({ "f-image": "0123456789" });
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("v1", [imageBlock]));
    const res = await sealSnapshot(provider, {
      noteId: "n1",
      snapshotId: meta.id,
      author,
      maxMediaBytes: 4,
    });
    if (res.status !== "sealed") throw new Error("sealed のはず");
    expect(res.manifest.media[0].sha256).toBeUndefined();
    expect(res.manifest.media[0].unhashedReason).toBe("unreadable");
  });

  it("URL だけの参照は対象外、doc 直下の参照は拾う", () => {
    const doc = makeDoc("v1", [
      imageBlock,
      { id: "bm", type: "bookmark", props: { url: "https://example.com" }, content: [], children: [] },
    ]) as any;
    doc.sourcePdfFileId = "f-pdf";
    doc.citedAssetFileIds = ["url:https://example.com", "f-cited"];
    const refs = collectSealMediaRefs(doc, (u) => (u.startsWith("media://") ? u.slice(8) : null));
    expect([...refs.keys()].sort()).toEqual(["f-cited", "f-image", "f-pdf"]);
    expect([...refs.get("f-image")!]).toEqual(["img1"]);
  });
});

describe("改ざんと連鎖の穴", () => {
  it("封印ファイルを書き換えると検出する", async () => {
    const { provider, store } = makeProvider();
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("v1"));
    await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author });
    const text = JSON.parse(store.get(sealKey(meta.id))!) as string;
    store.set(sealKey(meta.id), JSON.stringify(text.replace("v1", "v9")));
    const [sealed] = await listSnapshots(provider, "n1");
    expect((await checkSealLocally(provider, sealed)).manifestIntact).toBe(false);
    expect((await checkSealChain(provider, "n1")).problems).toEqual([
      { kind: "tampered", sealIndex: 1, snapshotId: meta.id },
    ]);
  });

  it("途中の封印を消すと穴が分かる", async () => {
    const { provider, store } = makeProvider();
    const ids: string[] = [];
    for (const t of ["v1", "v2", "v3"]) {
      const { meta } = await takeSnapshot(provider, "n1", makeDoc(t));
      await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author });
      ids.push(meta.id);
    }
    // 画面を通さずに、版のメタから 2 番目を消した場合
    const key = "snapshot-index:n1";
    const metas = JSON.parse(store.get(key)!) as any[];
    store.set(key, JSON.stringify(metas.filter((m) => m.id !== ids[1])));
    expect((await checkSealChain(provider, "n1")).problems).toEqual([
      { kind: "gap", afterIndex: 1, beforeIndex: 3 },
    ]);
  });

  it("封印ファイルが消えていたら落ちずに知らせる", async () => {
    const { provider, store } = makeProvider();
    const { meta } = await takeSnapshot(provider, "n1", makeDoc("v1"));
    await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author });
    store.delete(sealKey(meta.id));
    const [sealed] = await listSnapshots(provider, "n1");
    expect((await checkSealLocally(provider, sealed)).found).toBe(false);
    expect((await checkSealChain(provider, "n1")).problems[0].kind).toBe("missing_file");
  });
});

describe("版のメタの書き込みを直列化する", () => {
  it("Web Locks があれば、ノートごとの名前で端末全体の列に並べる（別のタブとも共有）", async () => {
    const names: string[] = [];
    const nav = globalThis.navigator as any;
    const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let tail = Promise.resolve();
    const fakeLocks = {
      // 同じ名前の要求を 1 本ずつ流す（本物の Web Locks と同じ振る舞いの最小形）
      request: <T,>(name: string, cb: () => Promise<T>) => {
        names.push(name);
        const run = tail.then(cb);
        tail = run.then(() => undefined, () => undefined);
        return run;
      },
    };
    Object.defineProperty(globalThis, "navigator", { value: { ...(nav ?? {}), locks: fakeLocks }, configurable: true });
    try {
      const { provider } = makeProvider();
      await Promise.all([1, 2, 3].map((i) => takeSnapshot(provider, "n1", makeDoc(`v${i}`))));
      expect(await listSnapshots(provider, "n1")).toHaveLength(3);
      expect(new Set(names)).toEqual(new Set(["graphium-snapshot-index-n1"]));
    } finally {
      if (had) Object.defineProperty(globalThis, "navigator", had);
      else delete (globalThis as any).navigator;
    }
  });

  it("同時に版を残しても取りこぼさない", async () => {
    const { provider } = makeProvider();
    await Promise.all(
      ["a", "b", "c", "d"].map((t) => takeSnapshot(provider, "n1", makeDoc(t), undefined, undefined, true)),
    );
    const metas = await listSnapshots(provider, "n1");
    expect(metas.map((m) => m.version)).toEqual([1, 2, 3, 4]);
  });
});

describe("buildSealManifest", () => {
  it("同じ入力なら同じハッシュになる", async () => {
    const input = {
      noteId: "n1",
      snapshotId: "s1",
      version: 1,
      snapshotSavedAt: "2026-11-05T00:00:00.000Z",
      sealedAt: "2026-11-05T00:01:00.000Z",
      sealIndex: 1,
      prevSealHash: null,
      author: null,
      document: makeDoc("v1"),
      media: [],
    };
    const a = await buildSealManifest(input);
    const b = await buildSealManifest(input);
    expect(a.sealHash).toBe(b.sealHash);
    expect(a.text.startsWith('{"format":"graphium-seal/1","noteId":"n1"')).toBe(true);
  });
});
