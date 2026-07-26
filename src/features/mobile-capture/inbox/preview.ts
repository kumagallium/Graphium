// 受信箱アイテム（まだ取り込んでいない FS 上のファイル）を、素材サイドピーク
// （MaterialSidePeek / MediaPreview）でそのままプレビューするための transient エントリ。
//
// 受信箱の目的は「取り込む前の取捨選択」なので、大きく見られることが本質的な機能。
// ただし未取り込みファイルは MediaIndexEntry ではない（media index にもストレージ
// プロバイダにも実体が無い）ため、専用のピークを新規に作らず、メモピーク
// （asset-browser の buildMemoPeekEntry）と同じ流儀で「その場限りの MediaIndexEntry」を
// 組んで既存ピークに流す。media index には保存しない。
//
// url には**メモリ上の blob URL** を入れる。MediaPreview 側は
//   - image  : ResolvedImage が provider 解決に失敗した URL をそのまま <img src> に使う
//   - pdf    : PdfViewer が blob:/data: をそのまま使う
//   - video / audio : BlobMediaPlayer が blob:/data: をそのまま使う
// ので、バイト列がプロバイダに無いままでも表示・再生できる。

import type { MediaIndexEntry, MediaType } from "../../asset-browser/media-index";
import { mimeFromExtension } from "./mime";
import type { CaptureRef } from "./types";

/**
 * ピークで使う MediaType。image / video / audio / pdf 以外はすべて "other" に倒す。
 *
 * docx 等を "document" にしないのは、DocumentViewer が
 * `provider.getMediaBlobUrl(fileId)` でストレージプロバイダからバイト列を取りに行く
 * 実装だから。未取り込みファイルはプロバイダに存在せず必ず失敗するので、
 * 「.docx なのに .docx のみ対応と言われる」誤解を招くより、ファイル情報表示
 * （MediaPreview の default = 汎用アイコン + ピークの footer）に倒す方が正直。
 */
export function inboxPeekMediaType(mime: string | null): MediaType {
  if (!mime) return "other";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

/**
 * 受信箱アイテム + 読み込み済み blob URL から、ピーク表示専用の MediaIndexEntry を組む。
 *
 * fileId の `inbox:` プレフィックスはピークの外に出ない（media index にも
 * リンク・来歴にも書かない）。blobUrl が空文字のときは「まだ読み込み中」で、
 * 呼び出し側が本体表示を差し替える前提。
 */
export function buildInboxPeekEntry(ref: CaptureRef, blobUrl: string): MediaIndexEntry {
  const mime = mimeFromExtension(ref.name);
  return {
    fileId: `inbox:${ref.name}`,
    name: ref.name,
    type: inboxPeekMediaType(mime),
    mimeType: mime ?? "application/octet-stream",
    url: blobUrl,
    thumbnailUrl: "",
    uploadedAt: ref.modifiedAt ?? "",
    usedIn: [],
  };
}
