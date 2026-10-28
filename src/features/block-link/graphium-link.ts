// 「リンクをコピー」で出す Graphium のリンク（…#note/<id> など）の形式規約。
//
// ノート・Knowledge・素材の 3 種類。どれも hash ルーター（hooks/use-hash-router.ts）の
// ルートそのものなので、外で開けばその画面が開き、Graphium の本文に単体で貼ると
// @ メニューで選んだときと同じ @リンクになる（貼り付け側は mention-insert.ts の
// tryConvertNoteLinkPaste）。
//
//   ノート      #note/<id>
//   Knowledge  #knowledge/<種別>/<id>（旧 #wiki/… と #note/wiki:<id> も受ける）
//   素材        #assets/<種類>/<fileId>

/** 貼り付けたリンクが指すもの */
export type GraphiumLinkTarget =
  | { kind: "note"; id: string }
  | { kind: "knowledge"; id: string }
  | { kind: "asset"; mediaType: string; fileId: string };

/** いま開いているアプリの URL に hash を付けたリンク */
function appLink(hash: string): string {
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

export function buildNoteLink(noteId: string): string {
  return appLink(`#note/${encodeURIComponent(noteId)}`);
}

export function buildKnowledgeLink(wikiKind: string, wikiId: string): string {
  return appLink(`#knowledge/${wikiKind}/${encodeURIComponent(wikiId)}`);
}

export function buildAssetLink(mediaType: string, fileId: string): string {
  return appLink(`#assets/${mediaType}/${encodeURIComponent(fileId)}`);
}

// ID の区切りは `/`・`#`・`?`（?peek= が付いていても本体だけを読む）
const SEG = "([^/\\s#?]+)";
const NOTE_RE = new RegExp(`#note/${SEG}`);
const KNOWLEDGE_RE = new RegExp(`#(?:knowledge|wiki)/${SEG}/${SEG}`);
const ASSET_RE = new RegExp(`#assets/${SEG}/${SEG}`);

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** 単体トークンが Graphium のリンクなら、その行き先を返す */
export function parseGraphiumLink(text: string): GraphiumLinkTarget | null {
  const note = NOTE_RE.exec(text);
  if (note) {
    const id = decode(note[1]);
    // Knowledge は #note/wiki:<id> でも表せる（全画面の遷移がこの形で URL に積む）
    return id.startsWith("wiki:") ? { kind: "knowledge", id: id.slice("wiki:".length) } : { kind: "note", id };
  }
  const knowledge = KNOWLEDGE_RE.exec(text);
  if (knowledge) return { kind: "knowledge", id: decode(knowledge[2]) };
  const asset = ASSET_RE.exec(text);
  if (asset) return { kind: "asset", mediaType: decode(asset[1]), fileId: decode(asset[2]) };
  return null;
}
