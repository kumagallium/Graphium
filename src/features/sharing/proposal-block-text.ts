// 「変更の提案」の差分表示用: ブロック 1 個を読めるテキストにする。
//
// エディタ（BlockNote）を実体化せずに読める形にしたいので、MCP 用の軽量
// Markdown 化（src/mcp/note-text.ts）をそのまま借りる。往復変換の忠実さは
// 目的ではなく、「どこが変わったか」が人に読めれば足りる。
//
// 差分エンジンの規則に合わせて 2 つだけ手を入れる:
//   - children は平坦化して別項目として並べるので、ここでは自分自身だけを出す
//   - 媒体ブロックの url は比較対象外（共有側は shared-blob: に置き換わるため必ず違う）。
//     比べないものを表示だけするとノイズになるので、名前が無い媒体は url を出さない

import { blocksToMarkdown } from "../../mcp/note-text";

/** url を比較対象から外す媒体ブロック（auto-blob.ts の MEDIA_TYPES と同じ） */
export const MEDIA_BLOCK_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

/**
 * ブロック 1 個を Markdown 断片にする（子ブロックは含めない）。
 * 中身を持たないブロック（chart / calc 等）は空文字を返す。呼び出し側は
 * 「（ブロックの設定が変わりました）」のような一行に置き換える。
 */
export function blockToReadableText(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const b = block as Record<string, any>;
  let solo: Record<string, any> = b;
  if (Array.isArray(b.children) && b.children.length > 0) solo = { ...solo, children: [] };
  if (MEDIA_BLOCK_TYPES.has(b.type) && b.props && typeof b.props === "object") {
    solo = { ...solo, props: { ...b.props, url: "" } };
  }
  return blocksToMarkdown([solo]).trim();
}
