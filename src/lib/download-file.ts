// ファイルをユーザーのディスクに保存するヘルパ。
//
// Web 版: <a download> でブラウザのダウンロードに任せる。
// Tauri 版: WKWebView は <a download> を尊重せず blob URL に遷移してしまい、
//           React の UI ごと消えるため、dialog.save() + 自前の Rust コマンドで
//           ネイティブ保存する。
import { isTauri } from "./platform";

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (isTauri()) {
    const [{ save }, { invoke }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/api/core"),
    ]);
    const ext = filename.includes(".") ? filename.split(".").pop()! : undefined;
    const path = await save({
      defaultPath: filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!path) return; // ユーザーがキャンセル
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // バイト→base64（btoa は引数長が大きいと RangeError になるのでチャンク化）
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    const content_base64 = btoa(binary);
    await invoke("save_bytes_to_path", { path, contentBase64: content_base64 });
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
