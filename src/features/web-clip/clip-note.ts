// Web クリップの純関数（React・ストレージ非依存）。
//
// 1 つの URL に 1 つのノート（「Web クリップ」フォルダ）。選んだ範囲はメモになり、
// そのノートへ引用（quote ブロック＋ページの memoQuotes）として追記していく。
// ここは「どの URL 素材に当たるか」「メモの本文」「ノートの組み立て・追記」だけを決める。
// 設計: docs/internal/web-clip-design.md

import type { GraphiumDocument } from "../../lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import { buildMemoInsertBlock } from "../mobile-capture/memo-insert";
import type { CaptureEntry } from "../mobile-capture/capture-store";
import { buildMemoQuoteRef } from "../memo-quote/memo-quote";

/** sidecar の受け取り待ちから届くクリップ（server/routes/clip.ts の WebClip と同じ形） */
export type WebClip = {
  id: string;
  url: string;
  title: string;
  text?: string;
  doi?: string;
  clippedAt: string;
  receivedAt: string;
};

/** 同じページとみなさない追跡用のクエリ */
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref_src", "igshid"]);

/**
 * URL を照合用の形にそろえる。`#…` と追跡用クエリを外し、ホストを小文字に、末尾の `/` を落とす。
 * http(s) でなければ元の文字列をそのまま返す（照合が外れるだけで壊れない）。
 */
export function normalizeClipUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return raw.trim();
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
      u.searchParams.delete(key);
    }
  }
  const host = u.host.toLowerCase();
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "";
  const query = u.searchParams.toString();
  return `${u.protocol}//${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * クリップが当たる URL 素材を探す。DOI があれば DOI を優先（同じ論文の別 URL をまとめる）、
 * 無ければ正規化した URL で照合する。ゴミ箱などの区別は素材索引に無いので、見つかったものを返す。
 */
export function findClipUrlEntry(
  index: Pick<MediaIndex, "media"> | null | undefined,
  clip: Pick<WebClip, "url" | "doi">,
): MediaIndexEntry | undefined {
  const urls = (index?.media ?? []).filter((m) => m.type === "url");
  if (clip.doi) {
    const doi = clip.doi.toLowerCase();
    const byDoi = urls.find((m) => m.webClip?.doi?.toLowerCase() === doi);
    if (byDoi) return byDoi;
  }
  const key = normalizeClipUrl(clip.url);
  return urls.find((m) => normalizeClipUrl(m.url) === key);
}

/** 題が無いページはドメインで呼ぶ */
export function clipTitle(clip: Pick<WebClip, "url" | "title">): string {
  const title = clip.title.trim();
  if (title) return title;
  try {
    return new URL(clip.url).host;
  } catch {
    return clip.url;
  }
}

/**
 * メモの本文。既存の「出典付きメモ」の書式（`本文\n\n— 出典`）に揃える —
 * 引用ブロックにしたとき出典が控えめな字で後ろに付く（memo-insert.ts）。
 */
export function buildClipMemoText(clip: Pick<WebClip, "url" | "title" | "text">): string {
  return `${(clip.text ?? "").trim()}\n\n— ${clipTitle(clip)}`;
}

/** ノートの先頭に置くブックマーク（素材の usedIn は bookmark の url で同期される） */
function buildBookmarkBlock(clip: Pick<WebClip, "url" | "title">, domain: string) {
  return {
    id: crypto.randomUUID(),
    type: "bookmark",
    props: { url: clip.url, title: clip.title.trim(), description: "", ogImage: "", domain },
    content: undefined,
    children: [],
  };
}

function buildQuoteBlock(memo: CaptureEntry, blockId: string) {
  const block = buildMemoInsertBlock(memo);
  if (!block) return null;
  return { id: blockId, type: "quote", props: {}, content: block.content, children: [] };
}

/**
 * クリップ用の新しいノートを組み立てる（保存はしない）。
 * memo があれば 1 つ目の引用として入れ、memoQuotes に紐づけを書く。
 */
export function buildClipNoteDocument(args: {
  clip: Pick<WebClip, "url" | "title">;
  domain: string;
  folder: string;
  memo?: CaptureEntry;
  now?: string;
}): GraphiumDocument {
  const now = args.now ?? new Date().toISOString();
  const title = clipTitle(args.clip);
  const blocks: any[] = [buildBookmarkBlock(args.clip, args.domain)];
  const memoQuotes: NonNullable<GraphiumDocument["pages"][number]["memoQuotes"]> = {};
  if (args.memo) {
    const blockId = crypto.randomUUID();
    const quote = buildQuoteBlock(args.memo, blockId);
    if (quote) {
      blocks.push(quote);
      memoQuotes[blockId] = buildMemoQuoteRef(args.memo, now);
    }
  }
  return {
    version: LATEST_DOCUMENT_VERSION,
    title,
    pages: [{
      id: crypto.randomUUID(),
      title,
      blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
      ...(Object.keys(memoQuotes).length > 0 ? { memoQuotes } : {}),
    }],
    createdAt: now,
    modifiedAt: now,
    source: "human",
    noteContexts: [args.folder],
  } as GraphiumDocument;
}

/**
 * 既存ノートの末尾にメモの引用を足した文書を返す（元の文書は変えない）。
 * 空のメモなら null。末尾が空の段落なら、その手前に入れる（書きかけの行の後ろに回さない）。
 */
export function appendClipQuote(
  doc: GraphiumDocument,
  memo: CaptureEntry,
  now: string = new Date().toISOString(),
): GraphiumDocument | null {
  const page = doc.pages[0];
  if (!page) return null;
  const blockId = crypto.randomUUID();
  const quote = buildQuoteBlock(memo, blockId);
  if (!quote) return null;
  const blocks = [...(page.blocks ?? [])];
  const last = blocks[blocks.length - 1];
  const lastIsEmptyParagraph =
    last?.type === "paragraph" &&
    (!Array.isArray(last.content) || last.content.length === 0) &&
    (!Array.isArray(last.children) || last.children.length === 0);
  if (lastIsEmptyParagraph) blocks.splice(blocks.length - 1, 0, quote);
  else blocks.push(quote);
  return {
    ...doc,
    modifiedAt: now,
    pages: [
      {
        ...page,
        blocks,
        memoQuotes: { ...(page.memoQuotes ?? {}), [blockId]: buildMemoQuoteRef(memo, now) },
      },
      ...doc.pages.slice(1),
    ],
  };
}
