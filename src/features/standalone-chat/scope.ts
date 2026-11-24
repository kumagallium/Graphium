// ノートに紐づかないチャット（standalone chat）の「渡す範囲」。
//
// ノート内チャットと Composer は external / internal / notes の 3 値だが、
// ノートに紐づかないチャットは常にノートとナレッジを横断して探すので、
// 「ノート内参照（引用したものだけ）」は成立しない。ここでは
//   - 外部参照（external）: 手元のノート・ナレッジに加えて Web 検索を強制する
//   - 内部参照（internal）: 手元のノート・ナレッジを横断して探す（既定）
//   - 使い方（help）: 利用者の記録は読まず、同梱のマニュアルだけを根拠に
//     「Graphium でできるか・どうやるか」に答える
// の 3 値を出し、notes が渡ってきたら internal に読み替える。

import type { GroundingScope } from "../../lib/grounding-scope";

/** ノートに紐づかないチャットで選べる渡す範囲（チップの並び順） */
export const STANDALONE_CHAT_SCOPES: readonly GroundingScope[] = ["external", "internal", "help"];

/** 既定は内部参照。横断検索は常に行うので、従来の挙動と同じ */
export const DEFAULT_STANDALONE_CHAT_SCOPE: GroundingScope = "internal";

/**
 * スコープを、ノートに紐づかないチャットで成立する値に読み替える。
 * notes（ノート内参照）はこのチャットでは意味を持たないので internal に寄せる。
 * undefined（未指定）は既定の internal。
 */
export function toStandaloneChatScope(scope: GroundingScope | undefined): GroundingScope {
  if (scope === "external" || scope === "help") return scope;
  return DEFAULT_STANDALONE_CHAT_SCOPE;
}
