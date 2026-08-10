// 貼付直後の画像 File を OCR に直接渡すための短命レジストリ
//
// 自動 OCR は保存後の URL からプロバイダ経由で画像を読み戻す。デスクトップでは
// これが invoke の Base64 往復（数 MB の文字列転送）になり、ドラッグ操作と
// 重なると WebView のプロセス間通信が宙吊りになって UI 全体が固まる事例があった。
// 貼付時には File 実体が手元にあるので、アップロード成功時にここへ預けておき、
// 自動 OCR が URL の代わりに使う。読み戻しの転送そのものを無くすのが目的。

/** 自動 OCR に拾われなかった分を溜め込まないための上限（古い順に破棄） */
const MAX_ENTRIES = 8;

// Map は挿入順を保持するので、先頭 = 最古
const files = new Map<string, File>();

/** アップロード直後の画像 File を URL に紐付けて預ける（画像以外は無視） */
export function registerPendingOcrFile(url: string, file: File): void {
  if (!url || !file.type.startsWith("image/")) return;
  // 同一 URL の再登録は最新を残す（挿入順も新しい側へ更新）
  files.delete(url);
  files.set(url, file);
  while (files.size > MAX_ENTRIES) {
    const oldest = files.keys().next().value;
    if (oldest === undefined) break;
    files.delete(oldest);
  }
}

/** URL に対応する File を取り出す（1 回きり・取り出したら消える） */
export function takePendingOcrFile(url: string): File | undefined {
  const f = files.get(url);
  if (f) files.delete(url);
  return f;
}
