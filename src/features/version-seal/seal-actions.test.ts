import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { StorageProvider } from "../../lib/storage/types";
import { listSnapshots } from "../version-snapshots/snapshot-store";
import { sha256HexOfText } from "./manifest";
import { bytesToBase64 } from "./rfc3161";
import { attachRfc3161 } from "./receipts";
import { summarizeSeals } from "./seal-actions";
import { sealKey } from "./seal-store";

const here = dirname(fileURLToPath(import.meta.url));
const tsr = new Uint8Array(readFileSync(join(here, "__fixtures__/freetsa-sample.tsr")));
// 実際の受領書が証明している中身
const sealText = readFileSync(join(here, "__fixtures__/freetsa-sample-data.txt"), "utf8");

/** 封印済みの版を 1 つ持ち、本物の受領書を付けたプロバイダ */
async function providerWithReceipt(text = sealText) {
  const store = new Map<string, string>();
  const provider = {
    readAppData: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    writeAppData: async (k: string, v: unknown) => {
      store.set(k, JSON.stringify(v));
    },
  } as unknown as StorageProvider;
  await provider.writeAppData!(sealKey("s1"), sealText);
  await provider.writeAppData!("snapshot-index:n1", [
    {
      id: "s1",
      noteId: "n1",
      version: 1,
      savedAt: "2026-11-05T05:00:00.000Z",
      contentHash: "x",
      seal: { sealedAt: "2026-11-05T05:10:00.000Z", sealHash: await sha256HexOfText(sealText), sealIndex: 1, receipts: [] },
    },
  ]);
  await attachRfc3161(provider, "n1", "s1", { post: async () => ({ status: 200, json: { tsr: bytesToBase64(tsr) } }) });
  if (text !== sealText) {
    // 受領書はそのままに、封印ファイルとメタだけ別の中身にする（別の版の受領書が付いている状態）
    await provider.writeAppData!(sealKey("s1"), text);
    const idx = (await provider.readAppData!("snapshot-index:n1")) as any[];
    idx[0].seal.sealHash = await sha256HexOfText(text);
    await provider.writeAppData!("snapshot-index:n1", idx);
  }
  return { provider, store };
}

describe("summarizeSeals（履歴の行の表示）", () => {
  it("検証できた受領書の時刻を「証明」として出す", async () => {
    const { provider } = await providerWithReceipt();
    const metas = await listSnapshots(provider, "n1");
    const out = await summarizeSeals(provider, metas);
    expect(out.s1).toEqual({ provenAt: "2026-11-05T05:10:35.000Z", pending: 0 });
  });

  it("別の中身の受領書は、時刻が読めても「証明」に数えない", async () => {
    const { provider } = await providerWithReceipt(sealText + "改ざん");
    const metas = await listSnapshots(provider, "n1");
    const out = await summarizeSeals(provider, metas);
    expect(out.s1.provenAt).toBeUndefined();
    expect(out.s1.problem).toBeUndefined();
  });

  it("封印ファイルが合わなければ、問題として出し、時刻も出さない", async () => {
    const { provider } = await providerWithReceipt();
    await provider.writeAppData!(sealKey("s1"), sealText + "x");
    const metas = await listSnapshots(provider, "n1");
    const out = await summarizeSeals(provider, metas);
    expect(out.s1).toEqual({ pending: 0, problem: true });
  });

  it("壊れた受領書は数えない", async () => {
    const { provider } = await providerWithReceipt();
    const [meta] = await listSnapshots(provider, "n1");
    await provider.writeAppData!(meta.seal!.receipts[0].receiptKey, bytesToBase64(new Uint8Array([1, 2, 3])));
    const out = await summarizeSeals(provider, [meta]);
    expect(out.s1.provenAt).toBeUndefined();
  });
});
