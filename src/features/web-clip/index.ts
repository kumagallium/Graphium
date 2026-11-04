// Web クリップ（ブラウザ拡張機能から届いたクリップをメモ・URL 素材・ノートへ）
export { useWebClipInbox, drainClipInbox } from "./use-web-clip-inbox";
export { processClip } from "./process-clip";
export type { ProcessClipDeps, ProcessClipResult } from "./process-clip";
export { WEB_CLIP_FOLDER, appendClipQuote,buildClipNoteDocument, findClipUrlEntry, normalizeClipUrl } from "./clip-note";
export type { WebClip } from "./clip-note";
export { fetchPairingCode, resetPairingCode } from "./api";
export { WebClipSettings } from "./WebClipSettings";
export { WebClipPairingPrompt } from "./WebClipPairingPrompt";
