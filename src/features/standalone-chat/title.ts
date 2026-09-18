// ノートに紐づかないチャットの「題」を、いつ付けるかの判定。
//
// 題は最初のやり取り（最初の user メッセージ + 最初の assistant 応答）が
// そろった直後にだけ AI に付けさせる。以降の送信では付け直さない。

/**
 * このターンで題を生成すべきかどうかを判定する。
 *
 * - すでに題が付いている会話には付け直さない
 * - このターンの前に既存メッセージがある（= 最初のやり取りではない）場合は付けない
 */
export function shouldGenerateChatTitle(params: {
  existingTitle: string | undefined;
  baseMessageCount: number;
}): boolean {
  return !params.existingTitle && params.baseMessageCount === 0;
}
