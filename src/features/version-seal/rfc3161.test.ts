import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildTimeStampRequest,
  checkResponseMatchesRequest,
  inspectTimeStampResponse,
  verifyTimeStampResponse,
} from "./rfc3161";
import { findTsa } from "./tsa-registry";
import { sha256HexOfBytes } from "./manifest";

// 2026-11-05 に FreeTSA から実際に取得した受領書（要求は openssl ts -query -sha256 -cert -no_nonce）
const here = dirname(fileURLToPath(import.meta.url));
const tsr = new Uint8Array(readFileSync(join(here, "__fixtures__/freetsa-sample.tsr")));
const data = new Uint8Array(readFileSync(join(here, "__fixtures__/freetsa-sample-data.txt")));
const root = findTsa("freetsa")!.rootPem;

describe("RFC 3161", () => {
  it("要求を組める（SHA-256・certReq・nonce）", () => {
    const { der, nonceHex } = buildTimeStampRequest("a".repeat(64), new Uint8Array([0xff, 1, 2, 3, 4, 5, 6, 7]));
    expect(der.byteLength).toBeGreaterThan(40);
    // 先頭ビットは落として正の整数にする
    expect(nonceHex).toBe("7f01020304050607");
  });

  it("不正なハッシュは受け付けない", () => {
    expect(() => buildTimeStampRequest("xyz")).toThrow();
  });

  it("実際の受領書を解析できる", async () => {
    const info = inspectTimeStampResponse(tsr);
    expect(info.status).toBe(0);
    expect(info.imprintHex).toBe(await sha256HexOfBytes(data));
    expect(info.genTime.toISOString()).toBe("2026-11-05T05:10:35.000Z");
    expect(info.nonceHex).toBeNull();
  });

  it("同梱のルート証明書で署名まで検証できる", async () => {
    const res = await verifyTimeStampResponse(tsr, data, [root]);
    expect(res.message).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it("中身が 1 バイト違えば通らない", async () => {
    const tampered = new Uint8Array(data);
    tampered[0] ^= 1;
    expect((await verifyTimeStampResponse(tsr, tampered, [root])).ok).toBe(false);
  });

  it("別のルート証明書では通らない", async () => {
    // 自己署名の無関係な証明書の代わりに、空の信頼リストで確かめる
    expect((await verifyTimeStampResponse(tsr, data, [])).ok).toBe(false);
  });

  it("送ったハッシュ・nonce と違う応答は弾く", async () => {
    const hash = await sha256HexOfBytes(data);
    expect(() => checkResponseMatchesRequest(tsr, { sha256Hex: "0".repeat(64), nonceHex: "01" })).toThrow(/ハッシュ/);
    // このサンプルは nonce 無しで取ったので、nonce を付けた要求への答えとしては通らない
    expect(() => checkResponseMatchesRequest(tsr, { sha256Hex: hash, nonceHex: "01" })).toThrow(/nonce/);
  });

  it("壊れた応答・大きすぎる応答は弾く", () => {
    expect(() => inspectTimeStampResponse(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => inspectTimeStampResponse(new Uint8Array(70 * 1024))).toThrow(/大きさ/);
  });
});
