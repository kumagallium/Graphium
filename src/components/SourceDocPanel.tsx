// 派生元ノート読み取り専用パネル + ユーティリティ関数

import type { ProvNoteDocument } from "../lib/google-drive";
import { useT } from "../i18n";
import { t as tStatic } from "../i18n";

// ブロック内容からタイトル文字列を抽出する
// テキスト系ブロック → テキスト内容、画像/動画/ファイル → ファイル名
export function extractBlockTitle(block: any): string {
  if (!block) return "";
  const MAX_LEN = 50;

  // テキスト系ブロック（heading, paragraph, bulletListItem, numberedListItem など）
  if (Array.isArray(block.content)) {
    const text = block.content
      .map((c: any) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    if (text) return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text;
  }

  // 画像・動画・音声・ファイルブロック → ファイル名を取得
  if (block.props) {
    // name プロパティ（ファイルブロック）またはURL からファイル名を抽出
    const name = block.props.name;
    if (name) return name;

    const url = block.props.url;
    if (url) {
      try {
        const pathname = new URL(url).pathname;
        const filename = pathname.split("/").pop();
        if (filename) return decodeURIComponent(filename);
      } catch {
        // URL パース失敗時はそのまま
      }
    }

    // caption があればそれを使う
    const caption = block.props.caption;
    if (caption) return caption.length > MAX_LEN ? caption.slice(0, MAX_LEN) + "…" : caption;
  }

  // テーブルブロック → 最初のセルのテキスト
  if (block.type === "table" && block.content?.rows?.[0]?.cells?.[0]) {
    const cell = block.content.rows[0].cells[0];
    const cellContent = cell.content ?? cell;
    if (Array.isArray(cellContent)) {
      const text = cellContent
        .map((c: any) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();
      if (text) return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text;
    }
  }

  return "";
}

// ブロックからテキストを抽出する簡易レンダラー
function renderBlockText(block: any): string {
  if (!block) return "";
  // content が InlineContent の配列の場合
  if (Array.isArray(block.content)) {
    return block.content
      .map((c: any) => (c.type === "text" ? c.text : c.type === "mention" ? `@${c.props?.id || ""}` : ""))
      .join("");
  }
  // テーブルの場合
  if (block.type === "table" && block.content?.rows) {
    return tStatic("common.table");
  }
  return "";
}

export function SourceDocPanel({ doc }: { doc: ProvNoteDocument }) {
  const t = useT();
  return (
    <div className="p-4 space-y-3">
      <div className="text-xs font-semibold text-muted-foreground">{t("derive.sourceNote")}</div>
      <h3 className="text-sm font-bold text-foreground">{doc.title}</h3>
      <div className="space-y-2">
        {doc.pages[0]?.blocks?.map((block: any, i: number) => (
          <div
            key={block.id || i}
            className="text-xs text-foreground/80 bg-background rounded p-2 border border-border"
          >
            {renderBlockText(block)}
          </div>
        ))}
      </div>
    </div>
  );
}
