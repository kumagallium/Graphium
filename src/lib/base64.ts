// バイト列 ⇄ base64
//
// `binary += String.fromCharCode(bytes[i])` で 1 バイトずつ文字列を伸ばすと、JavaScriptCore は
// 連結のたびにロープ（連結木）のノードを作る。数十 MB のファイルでは 1 千万個を超え、
// メモリが十数 GB に膨らんで数分間メインスレッドを止める（投入口で動画を取り込んだときに
// 実際に起きた）。ここでは 32 KB ずつ `String.fromCharCode.apply` で平らな文字列にして、
// 最後に一度だけつなぐ。`btoa` に渡す前の文字列は 1 本になるので、量に比例した時間で済む。

const CHUNK = 0x8000;

/** バイト列を base64 文字列にする。大きなファイルでも線形時間・線形メモリ */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    // apply の引数上限（数万）に収まる大きさで切る。subarray はコピーしない
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(""));
}

/** base64 文字列をバイト列に戻す */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
