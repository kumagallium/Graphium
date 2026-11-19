// 「置き場のファイルをリンク」の結果を、画面に出す短い知らせにする。

import type { MediaIndexEntry, MediaType } from "../asset-browser/media-index";
import { displayTypeOf, isInMediaList } from "./display-type";

type Translate = (key: string, params?: Record<string, string>) => string;

/** まとめてリンクした結果（件数の内訳） */
export type LinkFilesOutcome = {
  linked: MediaIndexEntry[];
  existing: MediaIndexEntry[];
  /** どの置き場の中でもなかった件数 */
  outside: number;
  /** 届かなかった・ファイルでなかった件数 */
  failed: number;
};

/** Rust が「選んだ件数が多すぎる」ときに返すエラーの接頭辞。後ろに上限が付く */
export const PLACE_PICK_TOO_MANY_PREFIX = "PLACE_PICK_TOO_MANY:";

/** 知らせに出す一覧の名前。PDF は左の一覧では「ドキュメント」に入る */
function listTypeOf(entry: MediaIndexEntry): MediaType {
  const type = displayTypeOf(entry);
  return type === "pdf" ? "document" : type;
}

/** 1 件だけ選んだときの知らせ。開いている一覧に入ったなら何も出さない */
function singleNotice(outcome: LinkFilesOutcome, listType: MediaType, t: Translate): string | null {
  if (outcome.outside === 1) return t("linkedFile.outsidePlace");
  if (outcome.failed === 1) return t("linkedFile.skippedFailed", { count: "1" });
  const entry = outcome.linked[0] ?? outcome.existing[0];
  if (!entry || isInMediaList(entry, listType)) return null;
  // 開いている一覧と違う種類の一覧に入ったときは、切り替えずに短く知らせる
  return t("linkedFile.listedIn", { type: t(`asset.type.${listTypeOf(entry)}`) });
}

/** リンクした件数を種類ごとに数えた文（例: ドキュメント 3・データ 9） */
function kindsText(entries: MediaIndexEntry[], t: Translate): string {
  const counts = new Map<MediaType, number>();
  for (const entry of entries) {
    const type = listTypeOf(entry);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts]
    .map(([type, count]) => t("linkedFile.kindCount", { type: t(`asset.type.${type}`), count: String(count) }))
    .join(t("linkedFile.kindSeparator"));
}

/** リンクの結果の知らせ。知らせることが無ければ null */
export function linkFilesNotice(outcome: LinkFilesOutcome, listType: MediaType, t: Translate): string | null {
  const { linked, existing, outside, failed } = outcome;
  if (linked.length + existing.length + outside + failed === 1) return singleNotice(outcome, listType, t);
  const parts: string[] = [];
  if (linked.length > 0) {
    parts.push(t("linkedFile.linkedMany", { count: String(linked.length), kinds: kindsText(linked, t) }));
  }
  if (existing.length > 0) parts.push(t("linkedFile.skippedExisting", { count: String(existing.length) }));
  if (outside > 0) parts.push(t("linkedFile.skippedOutside", { count: String(outside) }));
  if (failed > 0) parts.push(t("linkedFile.skippedFailed", { count: String(failed) }));
  return parts.length > 0 ? parts.join(" ") : null;
}

/** リンクに失敗したときの知らせ。選びすぎは、直し方の分かる案内に置き換える */
export function linkFilesErrorNotice(err: unknown, t: Translate): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith(PLACE_PICK_TOO_MANY_PREFIX)) {
    return t("linkedFile.tooMany", { max: message.slice(PLACE_PICK_TOO_MANY_PREFIX.length) });
  }
  return t("linkedFile.linkFailed", { message });
}
