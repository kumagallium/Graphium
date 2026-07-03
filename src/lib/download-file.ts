// ファイルをユーザーのディスクに保存するヘルパ。
//
// Web 版: <a download> でブラウザのダウンロードに任せる。
// Tauri 版: WKWebView は <a download> を尊重せず blob URL に遷移してしまい、
//           React の UI ごと消えるため、dialog.save() + 自前の Rust コマンドで
//           ネイティブ保存する。
import { isTauri } from "./platform";

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (isTauri()) {
    // セキュリティ: 保存先の選択とディスク書き込みは Rust 側の
    // save_bytes_with_dialog に一本化する。JS からは保存先パスを一切
    // 指定せず、ファイル名の初期候補だけ渡す。ダイアログを開き、ユーザーが
    // 選んだパスに書き込むところまで Rust が行う（任意パス書き込みの排除）。
    const { invoke } = await import("@tauri-apps/api/core");
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // バイト→base64（btoa は引数長が大きいと RangeError になるのでチャンク化）
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    const content_base64 = btoa(binary);
    // 戻り値 false はユーザーがダイアログをキャンセルした場合（従来と同じ挙動）。
    await invoke<boolean>("save_bytes_with_dialog", {
      suggestedName: filename,
      contentBase64: content_base64,
    });
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
