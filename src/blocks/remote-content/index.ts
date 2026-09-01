// ノート本文の外部メディアゲート。
//
// 「他人から受け取ったノートを開いただけで、差出人に IP と開いた時刻が渡る」を
// 既定にしないための仕組み一式。詳細は gated-media-spec.ts と store.ts を参照。

export {
  gatedMediaBlockEntries,
  gatedImageBlock,
  gatedVideoBlock,
  gatedAudioBlock,
} from "./gated-media-spec";
export { RemoteContentBar } from "./RemoteContentBar";
export { RemoteImportToast } from "./RemoteImportToast";
export { useRemoteImageImport, type RemoteImportToastState } from "./use-remote-image-import";
export {
  isRemoteContentAllowed,
  allowRemoteContentFor,
  refreshRemoteContentGate,
  useRemoteContentGate,
  useRemoteContentAllowed,
  useRemoteContentScope,
  editorRemoteScope,
  setEditorRemoteScope,
  REMOTE_CONTENT_CHANGED_EVENT,
} from "./store";
