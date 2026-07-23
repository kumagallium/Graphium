// ブロック紐付きメモ用のブロック表示ラベル解決
//
// 「このメモはどのブロックに付いているか」を人間が読める短いテキストにする。
// テキスト系ブロックは本文抜粋、メディア系（画像・動画・ファイル等）は
// テキスト抽出が空になるため キャプション → ファイル名 の順で拾う。
//
// 用途は 2 つ（同じ関数を使うことで作成時と表示時の見え方を揃える）:
// - 作成時: sourceNote.blockText スナップショットの生成（side-menu の AddMemoMenuItem）
// - 表示時: Memos タブの ¶ チップのライブ解決（現在のブロック内容を優先表示し、
//   ブロックが削除された場合のみスナップショットにフォールバックする）

import { extractBlockText } from "../navigation/index-file";

/** メモの ¶ チップ・blockText スナップショットに使う表示ラベル（最大 80 文字） */
export function resolveMemoBlockLabel(block: any): string {
  if (!block) return "";
  const text = extractBlockText(block);
  if (text) return text.slice(0, 80);
  const props = block.props ?? {};
  if (typeof props.caption === "string" && props.caption) return props.caption.slice(0, 80);
  if (typeof props.name === "string" && props.name) return props.name.slice(0, 80);
  return "";
}
