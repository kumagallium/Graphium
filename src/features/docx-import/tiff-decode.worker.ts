// TIFF デコード用 Web Worker。細工された TIFF でデコードが返らなくても画面は固まらず、
// 呼び出し側が時間切れで terminate する。結果の RGBA は transfer で返す。
import { decodeTiffSync } from "./tiff-decode";

self.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
  let out: ReturnType<typeof decodeTiffSync> = null;
  try {
    out = decodeTiffSync(ev.data);
  } catch {
    out = null;
  }
  const transfer = out ? [out.rgba.buffer as ArrayBuffer] : [];
  (self as unknown as Worker).postMessage(out, transfer);
};
