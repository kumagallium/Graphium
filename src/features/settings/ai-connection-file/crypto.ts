// 配るファイルのキーをパスフレーズで暗号化する（WebCrypto の PBKDF2-SHA256 → AES-GCM 256）。
//
// 守るのは「ファイルだけを手に入れた人に、キーが読めない」こと。パスフレーズはファイルとは
// 別の経路（口頭など）で渡す前提。読み込んだあとのキーは、今の保存先（macOS は Keychain、
// Windows とブラウザは平文）に入るので、そこから先はこの暗号化の範囲外。

import { base64ToBytes, bytesToBase64 } from "@/lib/base64";
import type { EncryptedKey } from "./format";

/** OWASP（2023）の PBKDF2-HMAC-SHA256 の目安 */
export const DEFAULT_ITERATIONS = 600_000;
/** パスフレーズの下限（短すぎると総当たりで解ける） */
export const MIN_PASSPHRASE_LENGTH = 8;

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  // 日本語のパスフレーズは OS や IME で合成の形（NFC / NFD）が変わることがあるので、そろえてから使う
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * 暗号文を接続先に結び付ける値（AES-GCM の追加認証データ）。
 * ファイルの送り先（apiBase）だけを書き換えると復号に失敗するので、
 * 書き換えたファイルでキーが別の先へ送られることを防ぐ
 */
export function keyBinding(provider: string, apiBase: string | null): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`graphium-ai-connection/v1\n${provider}\n${(apiBase ?? "").trim()}`);
}

/** WebCrypto は ArrayBuffer を持つ配列を求めるので写す */
const toBytes = (b64: string): Uint8Array<ArrayBuffer> => new Uint8Array(base64ToBytes(b64));

export async function encryptKey(
  apiKey: string,
  passphrase: string,
  binding: Uint8Array<ArrayBuffer>,
  iterations = DEFAULT_ITERATIONS,
): Promise<EncryptedKey> {
  if (passphrase.normalize("NFC").length < MIN_PASSPHRASE_LENGTH) throw new Error("passphraseTooShort");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: binding }, key, new TextEncoder().encode(apiKey)));
  return {
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(data),
  };
}

/** パスフレーズが違う・ファイルが壊れている・送り先が書き換えられているときは "wrongPassphrase" を投げる（どれかは区別できない） */
export async function decryptKey(enc: EncryptedKey, passphrase: string, binding: Uint8Array<ArrayBuffer>): Promise<string> {
  try {
    const key = await deriveKey(passphrase, toBytes(enc.salt), enc.iterations);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toBytes(enc.iv), additionalData: binding }, key, toBytes(enc.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("wrongPassphrase");
  }
}
