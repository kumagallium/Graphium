import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { StorageProvider } from "../../lib/storage/types";
import { listSnapshots } from "../version-snapshots/snapshot-store";
import { sha256HexOfText } from "./manifest";
import { bytesToBase64 } from "./rfc3161";
import { attachRfc3161, checkReceipts } from "./receipts";
import { sealKey } from "./seal-store";

const here = dirname(fileURLToPath(import.meta.url));
const tsr = new Uint8Array(readFileSync(join(here, "__fixtures__/freetsa-sample.tsr")));
// 実際の受領書が証明している中身。封印ファイルの文字列としてそのまま置く
const sealText = readFileSync(join(here, "__fixtures__/freetsa-sample-data.txt"), "utf8");

async function makeSealedProvider() {
  const store = new Map<string, string>();
  const provider = {
    readAppData: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    writeAppData: async (k: string, v: unknown) => {
      store.set(k, JSON.stringify(v));
    },
  } as unknown as StorageProvider;
  const sealHash = await sha256HexOfText(sealText);
  await provider.writeAppData!(sealKey("s1"), sealText);
  await provider.writeAppData!("snapshot-index:n1", [
    {
      id: "s1",
      noteId: "n1",
      version: 1,
      savedAt: "2026-11-05T05:00:00.000Z",
      contentHash: "x",
      seal: { sealedAt: "2026-11-05T05:10:00.000Z", sealHash, sealIndex: 1, receipts: [] },
    },
  ]);
  return { provider, store, sealHash };
}

const ok = (b64: string) => async () => ({ status: 200, json: { tsr: b64 } });

describe("attachRfc3161", () => {
  it("局の応答を検証してから保存し、確定にする", async () => {
    const { provider, sealHash } = await makeSealedProvider();
    let sentHash = "";
    const res = await attachRfc3161(provider, "n1", "s1", {
      post: async (_url, body: any) => {
        sentHash = body.hash;
        return { status: 200, json: { tsr: bytesToBase64(tsr) } };
      },
    });
    // 送るのはハッシュだけ
    expect(sentHash).toBe(sealHash);
    expect(res).toEqual({ status: "confirmed", genTime: new Date("2026-11-05T05:10:35.000Z") });
    const [meta] = await listSnapshots(provider, "n1");
    expect(meta.seal?.receipts).toMatchObject([{ kind: "rfc3161", status: "confirmed" }]);
    const checks = await checkReceipts(provider, meta);
    expect(checks[0]).toMatchObject({ ok: true });
    expect(checks[0].provenAt?.toISOString()).toBe("2026-11-05T05:10:35.000Z");
  });

  it("届かなければ pending にして、あとで付け直せる", async () => {
    const { provider } = await makeSealedProvider();
    const first = await attachRfc3161(provider, "n1", "s1", {
      post: async () => {
        throw new Error("offline");
      },
    });
    expect(first.status).toBe("pending");
    let [meta] = await listSnapshots(provider, "n1");
    expect(meta.seal?.receipts).toMatchObject([{ status: "pending" }]);
    const second = await attachRfc3161(provider, "n1", "s1", { post: ok(bytesToBase64(tsr)) });
    expect(second.status).toBe("confirmed");
    [meta] = await listSnapshots(provider, "n1");
    // pending を置き換え、受領書は 1 件のまま
    expect(meta.seal?.receipts).toHaveLength(1);
    expect(meta.seal?.receipts[0].status).toBe("confirmed");
  });

  it("検証できない受領書は保存しない", async () => {
    const { provider, store } = await makeSealedProvider();
    // 封印ファイルを差し替えると、受領書の中身と合わなくなる
    store.set(sealKey("s1"), JSON.stringify(sealText + "x"));
    const res = await attachRfc3161(provider, "n1", "s1", { post: ok(bytesToBase64(tsr)) });
    expect(res.status).toBe("pending");
    expect([...store.keys()].some((k) => k.startsWith("seal-receipt-") && store.get(k)!.length > 100)).toBe(false);
  });

  it("ルートが無い環境では unsupported", async () => {
    const { provider } = await makeSealedProvider();
    const res = await attachRfc3161(provider, "n1", "s1", { post: async () => ({ status: 404, json: null }) });
    expect(res.status).toBe("unsupported");
  });

  it("確定済みなら送り直さない", async () => {
    const { provider } = await makeSealedProvider();
    await attachRfc3161(provider, "n1", "s1", { post: ok(bytesToBase64(tsr)) });
    let called = false;
    const again = await attachRfc3161(provider, "n1", "s1", {
      post: async () => {
        called = true;
        return { status: 500, json: null };
      },
    });
    expect(called).toBe(false);
    expect(again.status).toBe("confirmed");
  });
});
