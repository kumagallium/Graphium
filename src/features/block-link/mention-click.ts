// @メンション（青文字の @ラベル）をクリックしたときの「行き先の解決」と「ピークへの振り分け」。
//
// メインエディタ（note-app）とサイドピーク（index-table/side-peek）は同じクリックを
// それぞれ別に実装していて、片方だけ直す移植漏れを繰り返していた。サイドピークでは
// データ素材（data: = .txt / .csv / .dat）と画像（image:）が開かず、表の中の @素材 が
// 同じ表の別リンク（ノート）へ飛んでいた。解決と振り分けをここに集め、どちらの
// エディタも同じ関数を通す。

import type { GraphiumIndex } from "../navigation/index-file";
import {
  buildUrlPeekEntry,
  type MediaIndex,
  type MediaIndexEntry,
} from "../asset-browser/media-index";
import { parseExternalSource } from "../network-graph/external-source";
import { MENTIONABLE_ASSET_TYPES, resolveMentionTargetFromLinks } from "./mention-menu";

/** リンク記録のうち、解決に使う部分だけ */
type LinkLike = { sourceBlockId: string; targetNoteId?: string; type?: string };

/** 素材一覧の要素のうち、解決に使う部分だけ */
type AssetLike = Pick<MediaIndexEntry, "fileId" | "name" | "type">;

/** クリックされた @メンションの文脈 */
export type MentionAt = {
  /** 先頭の @ を除いた表示テキスト */
  mentionText: string;
  /** メンションが属するブロック ID（DOM の data-id）。表ならその表ブロック */
  blockId: string | null;
  /** 表のセル内か（表は 1 ブロックに全セルのメンションのリンクが並ぶ） */
  inTableCell: boolean;
};

/**
 * クリックされた要素が @メンション（エディタ内の青文字 `@ラベル`）なら、その文脈を返す。
 * 見出しへの参照（`@#`）とエディタ外の青文字は null。
 *
 * 青文字の内側に別のスタイルの span が重なることがあり、そのときクリックの target は
 * 内側の span になる。表の先頭列は保存のたびに行の同一性（tableRowIdentity）が
 * 付くので必ずこうなる — target 自身だけを見ていた頃は、先頭列の @メンションが
 * どの表でも押せなかった。外側の青文字まで遡って見る。
 */
export function readMentionAt(el: HTMLElement): MentionAt | null {
  const span = el.closest<HTMLElement>('[data-style-type="textColor"][data-value="blue"]');
  if (!span || !span.closest(".bn-editor")) return null;
  const text = span.textContent?.trim();
  if (!text || !text.startsWith("@") || text.startsWith("@#")) return null;
  return {
    mentionText: text.slice(1),
    blockId: span.closest("[data-id]")?.getAttribute("data-id") ?? null,
    inTableCell: span.closest("td, th") !== null,
  };
}

/**
 * 素材名に一致する素材の外部ソース ID（"data:<fileId>" 等）をすべて返す。
 * macOS のファイル名は NFD で来ることがあるため NFC にそろえて比べる。
 * 装置の出力（data.txt 等）は同名の別ファイルが普通にあるので、1 件に決め打ちしない。
 */
export function assetIdsForName(
  media: ReadonlyArray<AssetLike> | null | undefined,
  name: string,
): string[] {
  if (!media) return [];
  const nfc = name.normalize("NFC");
  return media
    .filter((m) => MENTIONABLE_ASSET_TYPES.includes(m.type) && m.name.normalize("NFC") === nfc)
    .map((m) => `${m.type}:${m.fileId}`);
}

/**
 * タイトルからノート・知見を逆引きする（リンク記録の無い旧データや手で打った @タイトル 向け）。
 * インデックスに無ければファイル一覧、最後に 🤖 を剥がした知見タイトルで探す。
 */
export function findNoteByTitle(
  title: string,
  noteIndex: GraphiumIndex | null | undefined,
  files?: ReadonlyArray<{ id: string; name: string }>,
): { noteId: string; isWiki: boolean } | null {
  const found = noteIndex?.notes.find((n) => n.title === title);
  if (found) return { noteId: found.noteId, isWiki: found.source === "ai" };
  const file = files?.find((f) => f.name.replace(/\.(graphium|provnote)\.json$/, "") === title);
  if (file) return { noteId: file.id, isWiki: false };
  const cleanName = title.replace(/^🤖\s*/, "");
  const wikiEntry = noteIndex?.notes.find(
    (n) => n.source === "ai" && (n.title === title || n.title === cleanName),
  );
  if (wikiEntry) return { noteId: wikiEntry.noteId, isWiki: true };
  return null;
}

export type MentionClickInput = MentionAt & {
  /** そのエディタの linkStore.getAllLinks() */
  links: ReadonlyArray<LinkLike>;
  noteIndex: GraphiumIndex | null | undefined;
  /** 素材一覧（mediaIndex.media） */
  media: ReadonlyArray<AssetLike> | null | undefined;
  /** ノートのファイル一覧（タイトル逆引きの予備。持っていない画面では省略） */
  files?: ReadonlyArray<{ id: string; name: string }>;
  /** このノートが @ で引用した素材の fileId。リンク記録の無い同名素材を選ぶ決め手 */
  citedAssetFileIds?: readonly string[];
  /** 知見の派生元（wikiMeta.derivedFromNotes）。どれにも一致しない引用文の行き先 */
  derivedFromNotes?: readonly string[];
};

/**
 * クリックされた @ラベル の行き先を、ピークにそのまま渡せる ID で返す。
 *   - ノートの素 ID / "wiki:<id>"（知見）
 *   - 外部ソース ID（"data:<fileId>" / "pdf:<fileId>" / "url:<url>" など）
 * 解決できなければ null。
 */
export function resolveMentionClickTarget(input: MentionClickInput): string | null {
  const { mentionText, media } = input;

  // 1) 挿入時に記録したリンク。同名のノート・素材があっても厳密な ID に届く
  const fromLinks = resolveMentionTargetFromLinks(
    input.blockId,
    mentionText,
    input.links,
    input.noteIndex,
    (name) => assetIdsForName(media, name),
    { inTableCell: input.inTableCell },
  );
  if (fromLinks) {
    if (parseExternalSource(fromLinks.noteId)) return fromLinks.noteId;
    return fromLinks.isWiki ? `wiki:${fromLinks.noteId}` : fromLinks.noteId;
  }

  // 2) タイトルの逆引き
  const note = findNoteByTitle(mentionText, input.noteIndex, input.files);
  if (note) return note.isWiki ? `wiki:${note.noteId}` : note.noteId;

  // 3) 素材名の逆引き（リンク記録の無い @素材名）。同名が複数あれば、このノートが
  //    引用した素材を優先する
  const assetIds = assetIdsForName(media, mentionText);
  if (assetIds.length > 0) {
    const cited = input.citedAssetFileIds ?? [];
    return (
      assetIds.find((id) => cited.includes(parseExternalSource(id)?.key ?? "")) ?? assetIds[0]
    );
  }

  // 4) 知見の引用文（ノートにも素材にも一致しない）→ 派生元の文書・PDF。
  //    再生成で改名された旧タイトルの引用や、文書から抜いた引用文はここで源泉へ橋渡しする
  for (const sourceId of input.derivedFromNotes ?? []) {
    const ext = parseExternalSource(sourceId);
    if (
      (ext?.kind === "document" || ext?.kind === "pdf") &&
      media?.some((m) => m.fileId === ext.key)
    ) {
      return sourceId;
    }
  }
  return null;
}

export type PeekOpeners = {
  /** ノート・知見（"wiki:<id>"）をピークで開く */
  openNote: (peekId: string) => void;
  /** 素材（PDF・文書・データ・画像・URL）をピークで開く。素材ピークの無い画面では省略 */
  openMaterial?: (entry: MediaIndexEntry) => void;
  /** openMaterial が無い画面での URL の開き先（外部ブラウザ等）。省略時は開かない */
  openUrlFallback?: (url: string) => void;
  /** メモ（memo:<captureId>）を開く */
  openMemo?: (captureId: string) => void;
};

/**
 * 行き先 ID（ノートの素 ID / wiki: / 外部ソース ID）をピークへ振り分ける。開けたら true。
 * chat: / shared: のように開ける実体の無い ID と、素材一覧に無い素材は false（何もしない）。
 */
export function openPeekTarget(
  id: string,
  mediaIndex: MediaIndex | null | undefined,
  openers: PeekOpeners,
): boolean {
  const ext = parseExternalSource(id);
  if (!ext) {
    openers.openNote(id);
    return true;
  }
  switch (ext.kind) {
    case "url":
      if (openers.openMaterial) {
        openers.openMaterial(buildUrlPeekEntry(ext.key, mediaIndex ?? null));
        return true;
      }
      if (openers.openUrlFallback) {
        openers.openUrlFallback(ext.key);
        return true;
      }
      return false;
    case "pdf":
    case "document":
    case "data":
    case "image": {
      const entry = mediaIndex?.media.find((m) => m.fileId === ext.key);
      if (!entry || !openers.openMaterial) return false;
      openers.openMaterial(entry);
      return true;
    }
    case "memo":
      if (!openers.openMemo) return false;
      openers.openMemo(ext.key);
      return true;
    default:
      // chat: は元チャットへの参照キーを持たず、shared: は引用カード側の導線で開く
      return false;
  }
}
