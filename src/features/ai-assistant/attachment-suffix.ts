// 添付ノートの表示サフィックス（"\n\n📎 タイトル, ..."）の組み立てと除去。
// user メッセージの content には表示用にこのサフィックスを付けて保存し、
// 編集&再実行・回答の再生成では除去して生の質問文に戻す。
// 形式をここに一元化することで、組み立て側（note-app）と除去側（panel）の
// 正規表現ずれを防ぐ。

import type { ChatMessage } from "../../lib/document-types";

export type ChatAttachmentRef = NonNullable<ChatMessage["attachments"]>[number];

/** 添付 1 件の表示タイトル（Wiki は 🤖 プレフィックス付き） */
export function formatAttachmentTitle(a: ChatAttachmentRef): string {
  return a.isWiki ? `🤖 ${a.title}` : a.title;
}

/** content 末尾に付ける表示サフィックスを組み立てる */
export function buildAttachmentSuffix(attachments: ChatAttachmentRef[]): string {
  return `\n\n📎 ${attachments.map(formatAttachmentTitle).join(", ")}`;
}

/**
 * content 末尾の添付サフィックスを取り除いた生の質問文を返す。
 * 呼び出し側は message.attachments がある場合のみ使うこと
 * （添付参照の無い旧メッセージでは、ユーザーが本文に書いた 📎 行を
 * 誤って削らないよう content をそのまま使う）。
 */
export function stripAttachmentSuffix(content: string): string {
  return content.replace(/\n\n📎 [^\n]*$/, "");
}
