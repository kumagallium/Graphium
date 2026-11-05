// RFC 3161（Time-Stamp Protocol）の要求の組み立てと応答の検証。
//
// 画面（WebView）と sidecar（Node）の両方で動く（どちらも WebCrypto がある）。
// - sidecar: 要求を組んで局へ送り、応答を軽く確かめる（状態・nonce・ハッシュ）
// - 画面: 封印ファイルの全文と同梱のルート証明書で、署名まで含めて検証する
// 検証時刻は受領書の genTime を使う（pkijs が TSTInfo のときに自動でそうする）ので、
// TSA の証明書が期限切れになった後でも、発行時に有効だった受領書は検証できる。

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_TSTINFO = "1.2.840.113549.1.9.16.1.4";

/** 応答の大きさの上限（解析器を巨大な入力で突かれないため） */
export const MAX_TSR_BYTES = 64 * 1024;

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("hex ではありません");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array | ArrayBuffer): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(u).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 先頭の 0x00（符号のための詰め物）を落として比べる */
function stripLeadingZeros(hex: string): string {
  return hex.replace(/^(?:00)+(?=..)/, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * 要求（TimeStampReq）を組む。ハッシュは SHA-256 の hex（64 文字）。
 * nonce は 8 バイトの乱数。応答に同じ値が返ることを確かめる（取り違え・使い回し防止）。
 */
export function buildTimeStampRequest(
  sha256Hex: string,
  nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(8)),
): { der: Uint8Array; nonceHex: string } {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) throw new Error("SHA-256 の hex（小文字 64 文字）を渡してください");
  // 先頭ビットが立つと負の数になるので落とす
  const n = new Uint8Array(nonce);
  n[0] &= 0x7f;
  if (n[0] === 0) n[0] = 1;
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID_SHA256 }),
      hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(hexToBytes(sha256Hex)) }),
    }),
    certReq: true,
    nonce: new asn1js.Integer({ valueHex: toArrayBuffer(n) }),
  });
  return { der: new Uint8Array(req.toSchema().toBER(false)), nonceHex: bytesToHex(n) };
}

export interface InspectedTsr {
  /** 0 = granted, 1 = grantedWithMods。それ以外は拒否 */
  status: number;
  genTime: Date;
  /** 受領書が証明しているハッシュ（hex） */
  imprintHex: string;
  hashOid: string;
  nonceHex: string | null;
  serialHex: string;
}

/** 応答を解析して中身を取り出す（署名の検証はしない）。壊れていれば例外 */
export function inspectTimeStampResponse(der: Uint8Array): InspectedTsr {
  if (der.byteLength === 0 || der.byteLength > MAX_TSR_BYTES) throw new Error("応答の大きさが不正です");
  const asn = asn1js.fromBER(toArrayBuffer(der));
  if (asn.offset === -1) throw new Error("応答を解析できません");
  const resp = new pkijs.TimeStampResp({ schema: asn.result });
  const status = resp.status.status;
  if (!resp.timeStampToken) throw new Error(`局が拒否しました（status ${status}）`);
  const signed = new pkijs.SignedData({ schema: resp.timeStampToken.content });
  if (signed.encapContentInfo.eContentType !== OID_TSTINFO) throw new Error("受領書の種類が違います");
  const eContent = signed.encapContentInfo.eContent;
  if (!eContent) throw new Error("受領書に中身がありません");
  const tstAsn = asn1js.fromBER(toArrayBuffer(new Uint8Array(eContent.getValue())));
  if (tstAsn.offset === -1) throw new Error("受領書の中身を解析できません");
  const tst = new pkijs.TSTInfo({ schema: tstAsn.result });
  return {
    status,
    genTime: tst.genTime,
    imprintHex: bytesToHex(tst.messageImprint.hashedMessage.valueBlock.valueHexView),
    hashOid: tst.messageImprint.hashAlgorithm.algorithmId,
    nonceHex: tst.nonce ? stripLeadingZeros(bytesToHex(tst.nonce.valueBlock.valueHexView)) : null,
    serialHex: bytesToHex(tst.serialNumber.valueBlock.valueHexView),
  };
}

/**
 * 送り先から返ってきた応答が、送った要求への正しい答えかを確かめる（署名の検証の前段）。
 * sidecar で使う。通らない応答は保存しない。
 */
export function checkResponseMatchesRequest(
  der: Uint8Array,
  expected: { sha256Hex: string; nonceHex: string },
): InspectedTsr {
  const info = inspectTimeStampResponse(der);
  if (info.status !== 0 && info.status !== 1) throw new Error(`局が拒否しました（status ${info.status}）`);
  if (info.hashOid !== OID_SHA256) throw new Error("ハッシュの方式が違います");
  if (info.imprintHex !== expected.sha256Hex) throw new Error("受領書のハッシュが送ったものと違います");
  if (info.nonceHex !== stripLeadingZeros(expected.nonceHex)) throw new Error("受領書の nonce が送ったものと違います");
  return info;
}

function certificateFromPem(pem: string): pkijs.Certificate {
  const b64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  const asn = asn1js.fromBER(toArrayBuffer(base64ToBytes(b64)));
  if (asn.offset === -1) throw new Error("ルート証明書を解析できません");
  return new pkijs.Certificate({ schema: asn.result });
}

export interface TsrVerification {
  ok: boolean;
  genTime: Date | null;
  /** 失敗の理由（ok のときは undefined） */
  message?: string;
}

/**
 * 受領書を署名まで検証する。
 * data は時刻証明の対象そのもの（封印ファイルの UTF-8 バイト列）。
 * 検証時刻は genTime（期限切れ後の受領書も、発行時に有効なら通る）。
 */
export async function verifyTimeStampResponse(
  der: Uint8Array,
  data: Uint8Array,
  trustedRootPems: string[],
): Promise<TsrVerification> {
  let info: InspectedTsr;
  try {
    info = inspectTimeStampResponse(der);
  } catch (e) {
    return { ok: false, genTime: null, message: e instanceof Error ? e.message : String(e) };
  }
  try {
    const asn = asn1js.fromBER(toArrayBuffer(der));
    const resp = new pkijs.TimeStampResp({ schema: asn.result });
    const signed = new pkijs.SignedData({ schema: resp.timeStampToken!.content });
    const result = await signed.verify({
      signer: 0,
      data: toArrayBuffer(data),
      trustedCerts: trustedRootPems.map(certificateFromPem),
      checkChain: true,
      extendedMode: true,
    });
    const ok = typeof result === "boolean" ? result : !!result.signatureVerified && result.code === 14;
    if (!ok) {
      const message = typeof result === "boolean" ? "署名を確かめられません" : result.message || "署名を確かめられません";
      return { ok: false, genTime: info.genTime, message };
    }
    return { ok: true, genTime: info.genTime };
  } catch (e) {
    const message = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
    return { ok: false, genTime: info.genTime, message };
  }
}
