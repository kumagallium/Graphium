// URL 全文翻訳の前段ヘルパー（純粋関数・重い依存なし）
//
// translate-service.ts は pdfjs（react-pdf 経由）を import するため、
// テスト環境では DOMMatrix 未定義で読み込めない。言語判定・チャンク分割の
// 純粋ロジックはここに分離し、単体テストから直接 import できるようにする。

/**
 * 言語コードの基底サブタグ（"en-US" → "en"）が一致するか。
 * URL 本文が既に表示言語のとき、無駄な翻訳を確認するために使う。
 * どちらかが空 / null のときは「判定不能」とみなし false（翻訳を妨げない）。
 */
export function isSameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.split("-")[0].toLowerCase() === b.split("-")[0].toLowerCase();
}

/**
 * プレーンテキストを段落境界（空行）で max 文字程度のチャンクに分割する。
 * 単一段落が max を超える場合はその段落だけで 1 チャンクにする（途中で切らない）。
 */
export function chunkTextByParagraph(text: string, maxChars: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + 2 + p.length > maxChars) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
