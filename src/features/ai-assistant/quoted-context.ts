// 引用チャット（テキスト選択・ブロック選択・ドラッグハンドルから開くチャット）で
// AI に送るユーザーメッセージの組み立て。
//
// 「引用＝議論の主題」「ノート本文＝背景」と役割を分けて渡す。本文を渡さないと、
// 指示語・略語・前提条件が引用の外にあるときに AI が推測で埋めるしかなくなり、
// 「一部を引用したほうがページ全体チャットより文脈が薄い」という逆転が起きる。
//
// 組み立てをこのモジュールに切り出しているのは、note-app.tsx のコンポーネント内では
// ユニットテストできないため（citation-normalize.ts と同じ流儀）。

export interface QuotedChatMessageParams {
  /** ノートタイトル。BlockNote document の外にあるメタデータなので明示的に渡す */
  title: string;
  /** 引用された Markdown（会話開始時のスナップショット） */
  quotedMarkdown: string;
  /** ノート本文の最新 Markdown。空なら背景セクションを省く */
  pageMarkdown: string;
  /** ユーザーの質問 */
  question: string;
  /**
   * 会話の初回か。継続時は引用を history 側の idx=0 で再注入して維持するので、
   * ここでは前置きしない（同じ引用を毎ターン二重に送らない）。
   */
  isFirstMessage: boolean;
}

/**
 * 引用チャットのユーザーメッセージを組み立てる。
 *
 * ノート本文は毎ターン最新を渡す前提（スナップショットにすると
 * 「直したので見てください」と続けたときに AI が編集前の本文しか見えない）。
 */
export function buildQuotedChatMessage({
  title,
  quotedMarkdown,
  pageMarkdown,
  question,
  isFirstMessage,
}: QuotedChatMessageParams): string {
  const quoted = quotedMarkdown.trim();
  const body = pageMarkdown.trim();
  // 引用がノート全文と一致する場合（全選択して引用した等）は同じ本文を二重に
  // 送ることになるので背景セクションを省く。
  const includeBody = body !== "" && body !== quoted;
  const parts: string[] = [];

  if (isFirstMessage) {
    parts.push(
      `ノート「${title}」内の以下の内容について質問があります。`,
      "",
      "---",
      quotedMarkdown,
      "---",
      "",
    );
  }

  if (includeBody) {
    parts.push(
      isFirstMessage
        ? `参考として、引用元のノート「${title}」の全文を添えます。背景の理解にだけ使ってください。回答の主題はあくまで上の引用部分です。`
        : `参考として、引用元のノート「${title}」の現在の最新の全文を添えます（あなたが前に見たものから編集されている場合があります）。背景の理解にだけ使ってください。回答の主題はあくまで最初に引用した部分です。`,
      "",
      "---",
      `ノートタイトル: ${title}`,
      "",
      body,
      "---",
      "",
    );
  }

  parts.push(question);
  return parts.join("\n");
}

/**
 * Wiki Retriever に渡す検索クエリ。
 *
 * 背景として同梱するノート本文までクエリに混ぜると embedding が希釈され、
 * 引用と無関係な Wiki を拾ってしまう。主題（引用＋質問）だけを検索に使う。
 */
export function buildQuotedRetrievalQuery(quotedMarkdown: string, question: string): string {
  return [quotedMarkdown.trim(), question].filter(Boolean).join("\n\n");
}
