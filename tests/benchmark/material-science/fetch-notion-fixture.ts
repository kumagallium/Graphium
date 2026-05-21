// Notion ページから benchmark fixture の input.txt を取得する。
//
// 用途: benchmark fixture を増やすとき、論文 Methods 段落を Notion で管理している
// 場合に「論文からの参考部分」見出し以下の paragraph テキストを抜き出して
// `fixtures/<slug>.input.txt` に書き出す。
//
// 認証は worktree の .env から NOTION_TOKEN を読む。token は Notion 統合
// (Integration) のもので、対象ページを統合に Share してから使う。
// 公開 Notion API: https://developers.notion.com/reference/intro
//
// 使い方:
//   pnpm test:benchmark:fetch-notion <notion-url-or-id> <slug> [--section "見出し"]
//
// 例:
//   pnpm test:benchmark:fetch-notion \
//     https://www.notion.so/.../1fa97d4ef44280ff9504e54f45b75439 \
//     10-1002__advs-201600035__fe1xnb0-75ti0-25sb_composition-variation

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const DEFAULT_SECTION = "論文からの参考部分";
const NOTION_API_VERSION = "2022-06-28";

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: any;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.slug) {
    console.error("Usage: tsx fetch-notion-fixture.ts <notion-url-or-id> <slug> [--section <heading>]");
    process.exit(1);
  }

  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    console.error("NOTION_TOKEN が .env に設定されていません。");
    console.error("Notion で integration を作って token を取得し、対象ページにその integration を share してから再実行してください。");
    process.exit(2);
  }

  const pageId = normalizePageId(args.url);
  if (!pageId) {
    console.error(`URL から page id を取り出せませんでした: ${args.url}`);
    process.exit(3);
  }

  const section = args.section ?? DEFAULT_SECTION;
  console.log(`Fetching Notion page ${pageId}, section "${section}" ...`);

  const blocks = await fetchAllBlockChildren(pageId, token);
  console.log(`  retrieved ${blocks.length} top-level blocks`);

  const extracted = extractSectionText(blocks, section);
  if (!extracted) {
    console.error(`section "${section}" が見つからない、または直下に paragraph がありません。`);
    console.error("Notion ページに該当見出しがあるか、integration が page に share されているか確認してください。");
    process.exit(4);
  }

  mkdirSync(FIXTURES_DIR, { recursive: true });
  const outputPath = join(FIXTURES_DIR, `${args.slug}.input.txt`);
  writeFileSync(outputPath, extracted + "\n");
  console.log(`Wrote ${outputPath} (${extracted.length} chars).`);
}

function parseArgs(argv: string[]): { url?: string; slug?: string; section?: string } {
  const out: { url?: string; slug?: string; section?: string } = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--section") out.section = argv[++i];
    else positional.push(argv[i]);
  }
  out.url = positional[0];
  out.slug = positional[1];
  return out;
}

/**
 * Notion URL から page id を取り出す。
 * URL 例: https://www.notion.so/sakurainternetrc/title-slug-1fa97d4ef44280ff9504e54f45b75439?source=...
 * 末尾の 32 hex char を UUID 形式（8-4-4-4-12）に整形する。
 * 直接 page id (uuid) も受け付ける。
 */
function normalizePageId(input: string): string | null {
  // すでに UUID 形式
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(input)) return input.toLowerCase();

  // 32 hex（dash 無し）
  if (/^[0-9a-f]{32}$/i.test(input)) {
    return formatAsUuid(input.toLowerCase());
  }

  // URL から末尾の 32 hex を抽出
  const match = input.match(/([0-9a-f]{32})(?:\?|$|#)/i);
  if (match) {
    return formatAsUuid(match[1].toLowerCase());
  }
  return null;
}

function formatAsUuid(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}

/**
 * ページ直下のすべての block を取得する（pagination 対応）。
 */
async function fetchAllBlockChildren(pageId: string, token: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let startCursor: string | undefined;
  do {
    const params = new URLSearchParams();
    if (startCursor) params.set("start_cursor", startCursor);
    params.set("page_size", "100");
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?${params}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_API_VERSION,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Notion API ${res.status}: ${text.slice(0, 400)}`);
    }
    const data = (await res.json()) as { results: NotionBlock[]; next_cursor: string | null; has_more: boolean };
    blocks.push(...data.results);
    startCursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (startCursor);
  return blocks;
}

/**
 * 指定見出し直下の paragraph テキストを連結して返す。
 *
 * - heading_1 / heading_2 / heading_3 のいずれかで text に sectionTitle を **含む** 見出しを探す
 * - その次の heading_* が現れるまでの paragraph / numbered_list_item / bulleted_list_item / quote
 *   等のテキストを順に拾う
 * - toggle / table 等の入れ子ブロックは無視（has_children のものは中身を再帰しない、必要時に拡張）
 */
function extractSectionText(blocks: NotionBlock[], sectionTitle: string): string {
  const HEADING_TYPES = new Set(["heading_1", "heading_2", "heading_3"]);
  const TEXT_BLOCK_TYPES = new Set([
    "paragraph",
    "numbered_list_item",
    "bulleted_list_item",
    "quote",
    "to_do",
    "callout",
  ]);

  let inSection = false;
  const collected: string[] = [];

  for (const block of blocks) {
    if (HEADING_TYPES.has(block.type)) {
      const headingText = readBlockText(block);
      if (!inSection && headingText.includes(sectionTitle)) {
        inSection = true;
        continue;
      }
      if (inSection) {
        // 次の見出しでセクション終了
        break;
      }
    }
    if (inSection && TEXT_BLOCK_TYPES.has(block.type)) {
      const text = readBlockText(block).trim();
      if (text) collected.push(text);
    }
  }

  return collected.join("\n\n");
}

/** block.<type>.rich_text の plain_text を連結する */
function readBlockText(block: NotionBlock): string {
  const inner = block[block.type];
  if (!inner || typeof inner !== "object") return "";
  const richText = (inner as { rich_text?: Array<{ plain_text?: string }> }).rich_text;
  if (!Array.isArray(richText)) return "";
  return richText.map((rt) => rt.plain_text ?? "").join("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
