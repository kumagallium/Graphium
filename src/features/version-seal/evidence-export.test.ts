import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { takeSnapshot } from "../version-snapshots/snapshot-store";
import { collectEvidenceFiles, zipEvidence } from "./evidence-export";
import { sha256HexOfBytes } from "./manifest";
import { bytesToBase64 } from "./rfc3161";
import { sealSnapshot } from "./seal-store";

const here = dirname(fileURLToPath(import.meta.url));
const tsr = new Uint8Array(readFileSync(join(here, "__fixtures__/freetsa-sample.tsr")));

function makeProvider(media: Record<string, string>) {
  const store = new Map<string, string>();
  const mediaBytes = new Map(Object.entries(media).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  const provider = {
    readAppData: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    writeAppData: async (k: string, v: unknown) => {
      store.set(k, JSON.stringify(v));
    },
    readMediaBytes: async (id: string) => mediaBytes.get(id),
    extractFileId: (url: string) => (url.startsWith("media://") ? url.slice(8) : null),
  } as unknown as StorageProvider;
  return { provider, store, mediaBytes };
}

const doc = {
  version: 5,
  title: "パン生地の発酵",
  pages: [
    {
      id: "p1",
      title: "パン生地の発酵",
      blocks: [
        { id: "img1", type: "image", props: { url: "media://f-a", name: "dough.jpg" }, content: [], children: [] },
        { id: "img2", type: "image", props: { url: "media://f-b", name: "dough.jpg" }, content: [], children: [] },
      ],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as unknown as GraphiumDocument;

describe("証拠 zip", () => {
  it("封印ファイル・素材・受領書・ルート証明書・手順書を入れる。同名の素材もハッシュ名で分かれる", async () => {
    const { provider, store } = makeProvider({ "f-a": "生地 A", "f-b": "生地 B" });
    const { meta } = await takeSnapshot(provider, "n1", doc);
    await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author: { name: "テスト" } });
    // 書き出しは受領書を検証しない（保存時に検証済み）ので、受領書の置き場だけ用意する
    store.set("seal-receipt-x-1", JSON.stringify(bytesToBase64(tsr)));
    const idx = JSON.parse(store.get("snapshot-index:n1")!);
    idx[0].seal.receipts = [
      { kind: "rfc3161", endpoint: "https://freetsa.org/tsr", status: "confirmed", receiptKey: "seal-receipt-x-1", updatedAt: "" },
    ];
    store.set("snapshot-index:n1", JSON.stringify(idx));
    const ev = (await collectEvidenceFiles(provider, "n1", meta.id))!;
    const paths = Object.keys(ev.files).sort();
    expect(paths.filter((p) => p.startsWith("media/"))).toHaveLength(2);
    expect(paths).toContain("rfc3161/1.tsr");
    expect(paths).toContain("rfc3161/1-ca.pem");
    expect(paths).toContain("seal-manifest.json");
    expect(paths).toContain("VERIFY.md");
    expect(strFromU8(ev.files["VERIFY.md"])).toContain("openssl ts -verify -data seal-manifest.json -in rfc3161/1.tsr -CAfile rfc3161/1-ca.pem");
    expect(ev.omittedMedia).toEqual([]);
  });

  it("素材は今の中身が固定時と同じものだけ入れる", async () => {
    const { provider, mediaBytes } = makeProvider({ "f-a": "生地 A", "f-b": "生地 B" });
    const { meta } = await takeSnapshot(provider, "n1", doc);
    await sealSnapshot(provider, { noteId: "n1", snapshotId: meta.id, author: null });
    mediaBytes.set("f-b", new TextEncoder().encode("差し替え"));
    const ev = (await collectEvidenceFiles(provider, "n1", meta.id))!;
    const mediaPaths = Object.keys(ev.files).filter((p) => p.startsWith("media/"));
    expect(mediaPaths).toHaveLength(1);
    const hexA = await sha256HexOfBytes(new TextEncoder().encode("生地 A"));
    expect(mediaPaths[0]).toBe(`media/${hexA}.jpg`);
    expect(ev.omittedMedia).toMatchObject([{ fileId: "f-b", reason: "changed" }]);

    const { bytes, filename } = zipEvidence(ev);
    expect(filename).toMatch(/^graphium-seal-パン生地の発酵-1-\d{4}-\d{2}-\d{2}\.zip$/);
    const unzipped = unzipSync(bytes);
    // zip の中の封印ファイルは、保存した文字列とバイト単位で同じ
    expect(strFromU8(unzipped["seal-manifest.json"])).toBe(strFromU8(ev.files["seal-manifest.json"]));
    expect(strFromU8(unzipped["VERIFY.md"])).toContain("shasum -a 256 seal-manifest.json");
  });
});
