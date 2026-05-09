// .docx を Graphium ノートに変換する。
// 流れ: docx → mammoth で HTML 抽出 → BlockNote の HTML パーサでブロック化 → GraphiumDocument を組み立てる。
// uploadImage コールバックを渡すと、Word 内の画像はメディア層に分離される（base64 埋め込みではなくなる）。

import mammoth from "mammoth";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import type { GraphiumDocument } from "../../lib/document-types";

/** ブラウザで表示できる画像 MIME → 拡張子。リスト外は「非対応」として扱う */
const RENDERABLE_IMAGE_EXTS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

/** ブラウザで表示できる画像か（EMF/WMF/TIFF など `<img>` で映らない形式は false） */
function isRenderableImageMime(mime: string): boolean {
  return mime.toLowerCase() in RENDERABLE_IMAGE_EXTS;
}

export type DocxImportOptions = {
  /** 画像を Graphium のメディア層にアップロードする処理。返り値は ブロックに埋め込む URL */
  uploadImage?: (file: File) => Promise<string>;
  /** Word 内のハイパーリンクを URL ブックマークとして登録する処理（重複は受け側で吸収する想定） */
  addUrlBookmark?: (url: string, anchorText: string) => void;
};

/** docx ファイル 1 個を Graphium ノートに変換する */
export async function importDocxToGraphiumDoc(
  file: File,
  options: DocxImportOptions = {},
): Promise<GraphiumDocument> {
  const arrayBuffer = await file.arrayBuffer();

  // 画像処理: uploadImage が渡されていればメディア層にアップロード、無ければ mammoth デフォルト（base64）
  const baseTitle = file.name.replace(/\.docx$/i, "") || "Untitled";

  // 画像アップロードを直列化する。多数同時アップロードの取りこぼしを防ぐ
  let uploadChain: Promise<unknown> = Promise.resolve();
  let uploadIndex = 0;
  const stats = { attempted: 0, succeeded: 0, skipped: 0, failed: 0 };

  // mammoth が出力する <img> の src に最終 URL（例: `media-server://...`）を入れても、
  // BlockNote の HTMLToBlocks は detached document（baseURI=about:blank）上で
  // `imageElement.src` を読むため、独自スキームが空文字に正規化されてしまい、
  // 画像ブロックの url が空になる事故が起きる（"空の画像ブロック" 現象）。
  // そのため <img> には parse を通過させるためのプレースホルダ data URL を入れ、
  // 出現順に対応する実 URL を別配列で持ち回し、parse 後のブロック木で差し替える。
  const PLACEHOLDER_PREFIX = "data:image/svg+xml;utf8,";
  const placeholderFor = (idx: number) =>
    `${PLACEHOLDER_PREFIX}<svg xmlns='http://www.w3.org/2000/svg' data-graphium-idx='${idx}'/>`;
  const orderedSrcs: (string | null)[] = [];

  const mammothOptions = options.uploadImage
    ? {
        convertImage: mammoth.images.imgElement(async (image) => {
          const idx = uploadIndex++;
          stats.attempted++;
          // ブラウザで表示できない形式（EMF / WMF / 不明形式 など）はメディア層に保存しない。
          if (!isRenderableImageMime(image.contentType)) {
            stats.skipped++;
            console.warn(`[docx-import] #${idx} 非対応画像形式をスキップ:`, image.contentType);
            orderedSrcs[idx] = null;
            return { src: "" };
          }
          // 直列化: 前のアップロード完了を待つ
          const prev = uploadChain;
          let release: () => void;
          uploadChain = new Promise<void>((r) => { release = r; });
          await prev;
          try {
            const base64 = await image.readAsBase64String();
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const ext = RENDERABLE_IMAGE_EXTS[image.contentType.toLowerCase()];
            const blob = new Blob([bytes], { type: image.contentType });
            const imgFile = new File(
              [blob],
              `${baseTitle}-${crypto.randomUUID().slice(0, 8)}.${ext}`,
              { type: image.contentType },
            );
            console.debug(`[docx-import] #${idx} アップロード開始`, {
              mime: image.contentType,
              size: bytes.length,
            });
            const url = await options.uploadImage!(imgFile);
            stats.succeeded++;
            console.debug(`[docx-import] #${idx} アップロード成功`, { url });
            orderedSrcs[idx] = url;
            return { src: placeholderFor(idx) };
          } catch (err) {
            stats.failed++;
            console.error(`[docx-import] #${idx} アップロード失敗、base64 にフォールバック:`, err);
            const base64 = await image.readAsBase64String();
            const fallback = `data:${image.contentType};base64,${base64}`;
            orderedSrcs[idx] = fallback;
            return { src: fallback };
          } finally {
            release!();
          }
        }),
      }
    : undefined;

  const { value: html } = await mammoth.convertToHtml({ arrayBuffer }, mammothOptions);
  if (options.uploadImage) {
    await uploadChain; // 全アップロード完了を待つ
    console.info(`[docx-import] 画像処理完了`, stats);
  }

  // ハイパーリンク抽出: Word 内の外部 URL を URL ブックマークとして登録する
  if (options.addUrlBookmark) {
    const seen = new Set<string>();
    try {
      const parser = new DOMParser();
      const dom = parser.parseFromString(html, "text/html");
      dom.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        if (!/^https?:\/\//i.test(href)) return; // 外部 URL のみ。アンカー (#) や mailto は除外
        if (seen.has(href)) return;
        seen.add(href);
        const text = (a.textContent ?? "").trim() || href;
        options.addUrlBookmark!(href, text);
      });
    } catch (err) {
      console.warn("[docx-import] URL ブックマーク抽出失敗:", err);
    }
  }

  // パース専用の headless エディタ。スキーマはデフォルト＋codeBlock 等を含めず最小構成
  // にする（Graphium のカスタムブロックは編集中に追加されるため、import 時は不要）。
  const schema = BlockNoteSchema.create({
    blockSpecs: defaultBlockSpecs,
    styleSpecs: defaultStyleSpecs,
  });
  const editor = BlockNoteEditor.create({ schema });
  const blocks = editor.tryParseHTMLToBlocks(html);

  // プレースホルダ data URL → 実 URL へ差し替え。
  // BlockNote 側で url が空になった image ブロックも、出現順に対応する url を割り当てて救済する。
  const fixedBlocks = options.uploadImage
    ? rewriteImageUrls(blocks as any[], orderedSrcs)
    : (blocks as any[]);

  const title = baseTitle;
  const now = new Date().toISOString();

  return {
    version: 5,
    title,
    pages: [{
      id: crypto.randomUUID(),
      title,
      blocks: fixedBlocks as unknown[] as any[],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    }],
    createdAt: now,
    modifiedAt: now,
    source: "human",
  };
}

/**
 * BlockNote の image ブロックを書類の出現順に走査し、URL を差し替える。
 * - props.url がプレースホルダ data URL なら orderedSrcs から復元
 * - props.url が空（detached document の URL 解決で消えたケース）でも、
 *   image ブロックの出現順位に対応する src を割り当てる
 * 引き当てに使えない (null = skip) 要素は飛ばす。
 */
function rewriteImageUrls(blocks: any[], orderedSrcs: (string | null)[]): any[] {
  let cursor = 0;
  const nextSrc = (): string | null => {
    while (cursor < orderedSrcs.length) {
      const v = orderedSrcs[cursor++];
      if (v) return v;
    }
    return null;
  };
  const visit = (b: any): any => {
    if (!b || typeof b !== "object") return b;
    let next = b;
    if (b.type === "image") {
      const src = nextSrc();
      if (src) {
        next = { ...b, props: { ...(b.props ?? {}), url: src } };
      }
    }
    if (Array.isArray(b.children) && b.children.length > 0) {
      next = { ...next, children: b.children.map(visit) };
    }
    return next;
  };
  return blocks.map(visit);
}

/** 拡張子から docx 判定 */
export function isDocxFile(file: File): boolean {
  return /\.docx$/i.test(file.name);
}
