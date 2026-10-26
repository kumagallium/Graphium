// ノートに紐づかないチャット（standalone chat）の一覧表示に必要な型
//
// 保存形式（永続化）とは別に、一覧表示に必要な分だけを持つ表示用の型。
// 保存・AI 呼び出しの実装は別途行う。

import type { ChatMessage } from "../../lib/document-types";
import type { GroundingScope } from "../../lib/grounding-scope";

/** 一覧の 1 行に表示する分だけの要約情報 */
export type StandaloneChatSummary = {
  id: string;
  /** AI が後から付ける短い題。未生成なら undefined */
  title?: string;
  /** 最初のユーザーメッセージ */
  firstQuestion: string;
  messageCount: number;
  /** ISO 文字列 */
  modifiedAt: string;
};

/** ノートに紐づかないチャットの本体（全文） */
export type StandaloneChat = {
  id: string;
  /** AI が後から付ける短い題。未生成なら undefined */
  title?: string;
  messages: ChatMessage[];
  /** 開始時に引用として添えたノート/ナレッジの id（⌘K から飛んできたとき） */
  attachedNoteIds?: string[];
  /** 直近の送信で使った「渡す範囲」（external / internal）。次の送信の既定になり、
   *  開き直したときもチップがこの値で立つ。未保存（旧データ）は internal 扱い */
  scope?: GroundingScope;
  createdAt: string;
  modifiedAt: string;
};
