// 出典照合（Source check, v1） — 知見の claimHash 計算。
//
// title + 本文テキストのハッシュ。照合時点の値を SourceCheckProfile.claimHash に刻んでおき、
// 現在の本文から再計算した値と食い違えば「本文が変わった（照合結果が古い）」と UI で出せる。
//
// 既存のハッシュユーティリティ（src/lib/storage/shared/hash.ts の computeBlobHash、
// team-shared-storage で使っている SHA-256）を再利用する。区切りに 0x1F（Unit Separator）を
// 挟むのは、team-shared-storage の hash.ts が meta/body 境界に使っているのと同じ手法
// （"" と "x" のような境界のずれを防ぐ）。

import type { GraphiumDocument } from "../../lib/document-types";
import { computeBlobHash } from "../../lib/storage/shared/hash";

const UNIT_SEPARATOR = "";

/** title + 本文から claimHash（"sha256:<hex>"）を計算する */
export async function computeClaimHash(title: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${title}${UNIT_SEPARATOR}${body}`);
  return computeBlobHash(bytes);
}

/**
 * claimHash に入れる本文テキスト（照合した時点の本文の指紋）。照合時の記録（build-statements.ts）
 * と「照合後に本文が変わったか」の判定（use-source-check.ts）の両方が必ずこれを使う。
 *
 * 抽出のしかたを変えると、本文を触っていない照合済みページまで一斉に「本文が変わった」
 * 扱いになる。そのため AI に渡す本文（wiki-service の extractPlainTextFromDoc。上付き・下付き・
 * 数式・リンクの文字を保つ）とは分け、v1 の抽出をここに固定する。v1 の癖 — リンクが
 * "[object Object]" になる・数式や上付き下付きを見ない・新形式の表セルを読まない — も
 * そのまま残す（直すと既存の照合結果が古くなる）。指紋としては「前と同じか」が分かれば足りる。
 */
export function claimHashBody(doc: GraphiumDocument): string {
  const page = doc.pages[0];
  if (!page) return "";
  const lines: string[] = [];
  for (const block of page.blocks || []) {
    const text = v1BlockText(block);
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

function v1BlockText(block: any): string {
  let text = v1InlineText(block.content);
  if (text) return text;

  if (block.props?.text) return block.props.text;

  if (block.children?.length) {
    text = block.children
      .map((child: any) => v1BlockText(child))
      .filter(Boolean)
      .join(", ");
    if (text) return text;
  }

  return "";
}

function v1InlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text ?? c.content ?? "").join("");
  }
  if (content.type === "tableContent" && Array.isArray(content.rows)) {
    return content.rows
      .map((row: any) =>
        (row.cells ?? [])
          .map((cell: any) => v1InlineText(cell))
          .join(" ")
      )
      .join(" ")
      .trim();
  }
  return "";
}
