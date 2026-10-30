// ──────────────────────────────────────────────
// グラフ（Cytoscape）のノードに置く種類アイコン。
//
// 以前はラベルの先頭に絵文字（📄 🔗 など）を付けて見分けていたが、アプリの他の場所は
// lucide のアイコンなので、同じ絵を SVG（data URI）にしてノードの背景に置く。
// 画像 / 動画のサムネイルを background-image で置く仕組みと同じ経路。
//
// Cytoscape は React コンポーネントを描けず SVG 文字列が要る。lucide-react を
// renderToStaticMarkup で文字列化すると react-dom/server がバンドルに入るので、
// 必要な数個のアイコンの形（path）だけをここ 1 か所に定数で持つ（葉モジュール）。
// アイコンの形は lucide（ISC License, https://lucide.dev/license）から。
// ──────────────────────────────────────────────

export type GraphNodeIconKind =
  | "pdf"
  | "document"
  | "url"
  | "chat"
  | "memo"
  | "image"
  | "video"
  | "audio"
  | "wiki"
  | "shared"
  | "proposal";

/** アイコン選択に必要な最小限のフィールド（NoteNode から渡せる） */
export type GraphNodeIconInput = {
  external?: "pdf" | "url" | "document" | "chat" | "memo" | "media";
  mediaType?: string;
  isWiki?: boolean;
  sharedKind?: "shared" | "proposal";
};

/** ノードの種類からアイコンの種類を選ぶ。アイコンを置かないノード（通常ノート）は undefined。 */
export function graphNodeIconKind(n: GraphNodeIconInput): GraphNodeIconKind | undefined {
  if (n.external === "media") {
    return n.mediaType === "video" ? "video" : n.mediaType === "audio" ? "audio" : "image";
  }
  if (n.external) return n.external;
  if (n.sharedKind) return n.sharedKind;
  if (n.isWiki) return "wiki";
  return undefined;
}

/** lucide の 24x24 アイコンの中身（SVG 要素の文字列） */
const ICON_BODY: Record<GraphNodeIconKind, string> = {
  // file-text
  pdf:
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  // file-pen
  document:
    '<path d="M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z"/>',
  // link
  url: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  // message-square
  chat: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  // sticky-note
  memo: '<path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/>',
  // image
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  // video
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  // music
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  // bot
  wiki: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  // users
  shared: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  // lightbulb
  proposal:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
};

/** 色は # を含む 16 進などの安全な CSS 色だけ通す（data URI に埋め込むため） */
function safeColor(color: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : "#6e7378";
}

/** アイコンの SVG 文字列（lucide と同じ stroke 描画。stroke は指定色） */
export function graphNodeIconSvg(kind: GraphNodeIconKind, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${safeColor(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_BODY[kind]}</svg>`
  );
}

/** Cytoscape の background-image に渡す data URI */
export function graphNodeIconDataUri(kind: GraphNodeIconKind, color: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(graphNodeIconSvg(kind, color))}`;
}

/**
 * アイコンの色。外部ソースは白地に枠と同じ灰系で描く（背景が灰色だと読めないため
 * graphNodeIconNeedsLightFill で白地にする）。色付きのノード（Knowledge / 共有 / 提案）は
 * 塗りの上に白で描く。
 */
export function graphNodeIconStroke(kind: GraphNodeIconKind, borderColor: string): string {
  return graphNodeIconNeedsLightFill(kind) ? borderColor : "#ffffff";
}

/** 外部ソース（出典・素材）のアイコンは白地に置く */
export function graphNodeIconNeedsLightFill(kind: GraphNodeIconKind): boolean {
  return kind !== "wiki" && kind !== "shared" && kind !== "proposal";
}
