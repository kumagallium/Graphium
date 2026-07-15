import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { takeSnapshot } from "./snapshot-store";
import { findSnapshotsReferencingAsset } from "./snapshot-refs";

/** readAppData / writeAppData だけを in-memory で実装した最小プロバイダ */
function makeProvider(): StorageProvider {
  const store = new Map<string, unknown>();
  return {
    readAppData: async (k: string) => (store.has(k) ? store.get(k) : null),
    writeAppData: async (k: string, v: unknown) => {
      store.set(k, v);
    },
  } as unknown as StorageProvider;
}

function makeDoc(blocks: any[], extra: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 5,
    title: "テストノート",
    pages: [
      {
        id: "p1",
        title: "テストノート",
        blocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

const IMAGE_URL = "https://cdn.example/img-123.png";
const ASSET = { fileId: "img-123", url: IMAGE_URL };

describe("findSnapshotsReferencingAsset", () => {
  it("画像ブロックを含む版を検出する", async () => {
    const provider = makeProvider();
    const doc = makeDoc([
      { id: "b1", type: "image", props: { url: IMAGE_URL }, content: [] },
    ]);
    await takeSnapshot(provider, "note-1", doc);

    const refs = await findSnapshotsReferencingAsset(provider, ["note-1"], ASSET);
    expect(refs).toHaveLength(1);
    expect(refs[0].noteId).toBe("note-1");
    expect(refs[0].version).toBe(1);
  });

  it("参照していない版は数えない", async () => {
    const provider = makeProvider();
    await takeSnapshot(provider, "note-1", makeDoc([
      { id: "b1", type: "paragraph", content: [{ type: "text", text: "画像なし" }] },
    ]));

    const refs = await findSnapshotsReferencingAsset(provider, ["note-1"], ASSET);
    expect(refs).toHaveLength(0);
  });

  it("doc-level 参照（sourcePdfFileId）でも検出する", async () => {
    const provider = makeProvider();
    await takeSnapshot(provider, "note-1", makeDoc(
      [{ id: "b1", type: "paragraph", content: [] }],
      { sourcePdfFileId: "pdf-9" },
    ));

    const refs = await findSnapshotsReferencingAsset(provider, ["note-1"], {
      fileId: "pdf-9",
      url: "https://cdn.example/pdf-9.pdf",
    });
    expect(refs).toHaveLength(1);
  });

  it("複数ノートの版を横断して数える", async () => {
    const provider = makeProvider();
    const withImage = makeDoc([{ id: "b1", type: "image", props: { url: IMAGE_URL }, content: [] }]);
    await takeSnapshot(provider, "note-1", withImage);
    await takeSnapshot(provider, "note-2", withImage);
    await takeSnapshot(provider, "note-3", makeDoc([{ id: "b1", type: "paragraph", content: [] }]));

    const refs = await findSnapshotsReferencingAsset(
      provider,
      ["note-1", "note-2", "note-3", "note-no-snapshots"],
      ASSET,
    );
    expect(refs.map((r) => r.noteId).sort()).toEqual(["note-1", "note-2"]);
  });
});
