// .docx を Graphium ノートに変換する。
// 流れ: docx → mammoth で HTML 抽出 → BlockNote の HTML パーサでブロック化 → GraphiumDocument を組み立てる。
// uploadImage コールバックを渡すと、Word 内の画像はメディア層に分離される（base64 埋め込みではなくなる）。

import mammoth from "mammoth";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  RENDERABLE_IMAGE_EXTS,
  convertNonRenderableImage,
  isRenderableImageMime,
} from "./renderable-image";

export type DocxImportOptions = {
  /** 画像を Graphium のメディア層にアップロードする処理。返り値は ブロックに埋め込む URL */
  uploadImage?: (file: File) => Promise<string>;
  /** Word 内のハイパーリンクを URL ブックマークとして登録する処理（重複は受け側で吸収する想定） */
  addUrlBookmark?: (url: string, anchorText: string) => void;
  /**
   * 親素材 (.docx 本体) の MediaIndexEntry fileId。
   * 素材ライブラリ経由の取り込みで指定すると、生成ノートに `sourceDocumentFileId`
   * を埋め込み、PROV-DM 的に素材 → ノートの派生関係を保持する。
   */
  parentAssetFileId?: string;
};

/** docx ファイル 1 個を Graphium ノートに変換する */
export async function importDocxToGraphiumDoc(
  file: File,
  options: DocxImportOptions = {},
): Promise<GraphiumDocument> {
  const arrayBuffer = await file.arrayBuffer();

  // 画像処理: uploadImage が渡されていればメディア層にアップロード、無ければ mammoth デフォルト（base64）
  const baseTitle = file.name.replace(/\.docx$/i, "") || "Untitled";

  // 設計メモ:
  // mammoth の convertImage 段階では File を作るだけで、メディア層への upload はしない。
  // 理由: BlockNote の HTMLToBlocks は <img> を必ずしも image ブロックとして残さない
  // （表組み・ヘッダー・インライン文脈などで drop されるケースがある）。先に upload して
  // しまうと、ノートに表示されない画像がメディア層に堆積してゴミになる。
  // そこで、まずプレースホルダ data URL に idx を埋めて HTML を作り、ブロック化したあと
  // 「実際に image ブロックとして生き残った idx」だけをまとめて upload する。
  //
  // また、プレースホルダを data URL にすることで、独自スキームで `imageElement.src` が
  // 空文字に潰れる事故も避けている（detached document の baseURI=about:blank 問題）。
  let nextIdx = 0;
  const stats = { attempted: 0, succeeded: 0, skipped: 0, failed: 0 };
  type Pending =
    | { kind: "renderable"; file: File }
    | { kind: "fallback"; dataUrl: string }
    | { kind: "skipped" };
  const pending: Pending[] = [];
  const placeholderFor = (idx: number) =>
    `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' data-graphium-idx='${idx}'/>`;

  const mammothOptions = options.uploadImage
    ? {
        convertImage: mammoth.images.imgElement(async (image) => {
          const idx = nextIdx++;
          stats.attempted++;
          // ブラウザで表示できない形式（EMF / TIFF 等）は PNG / SVG への変換を試み、
          // 変換できないもの（WMF / 不明形式 など）だけメディア層に保存せずスキップする。
          if (!isRenderableImageMime(image.contentType)) {
            try {
              const base64 = await image.readAsBase64String();
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const converted = await convertNonRenderableImage(
                image.contentType,
                bytes.buffer,
                `${baseTitle}-${crypto.randomUUID().slice(0, 8)}`,
              );
              if (converted) {
                console.info(
                  `[docx-import] #${idx} 非対応画像形式を変換:`,
                  image.contentType,
                  "→",
                  converted.type,
                );
                pending[idx] = { kind: "renderable", file: converted };
                return { src: placeholderFor(idx) };
              }
            } catch (err) {
              console.warn(`[docx-import] #${idx} 非対応画像形式の変換失敗:`, err);
            }
            stats.skipped++;
            console.warn(`[docx-import] #${idx} 非対応画像形式をスキップ:`, image.contentType);
            pending[idx] = { kind: "skipped" };
            return { src: "" };
          }
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
            pending[idx] = { kind: "renderable", file: imgFile };
            return { src: placeholderFor(idx) };
          } catch (err) {
            console.error(`[docx-import] #${idx} 画像読み出し失敗、base64 にフォールバック:`, err);
            const base64 = await image.readAsBase64String();
            const fallback = `data:${image.contentType};base64,${base64}`;
            pending[idx] = { kind: "fallback", dataUrl: fallback };
            return { src: fallback };
          }
        }),
      }
    : undefined;

  const { value: html } = await mammoth.convertToHtml({ arrayBuffer }, mammothOptions);

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

  // ここで「ブロック化を生き残った image ブロック」を出現順に並べる。
  // 各ブロックの url から idx を抽出（プレースホルダ data URL に埋め込んである）し、
  // idx が取れなかったブロック（url が detached document で空文字に潰れた等）には
  // 出現順に余っている renderable Pending を順に当てて救済する。
  const imageBlocksInOrder = collectImageBlocksInOrder(blocks as any[]);
  const usedIdxs = new Set<number>();
  const fallbackQueue: number[] = [];
  pending.forEach((p, i) => {
    if (p && p.kind === "renderable") fallbackQueue.push(i);
  });
  const blockToIdx = new Map<any, number>();
  for (const block of imageBlocksInOrder) {
    const url: string = block?.props?.url ?? "";
    const m = /data-graphium-idx=['"]?(\d+)/.exec(url);
    let idx: number | null = m ? Number(m[1]) : null;
    if (idx !== null && pending[idx]?.kind !== "renderable" && pending[idx]?.kind !== "fallback") {
      idx = null; // 既に消化済 or 不正
    }
    if (idx === null) {
      // 出現順 fallback: 未使用の renderable を頭から取る
      while (fallbackQueue.length > 0) {
        const candidate = fallbackQueue[0];
        if (usedIdxs.has(candidate)) {
          fallbackQueue.shift();
          continue;
        }
        idx = candidate;
        fallbackQueue.shift();
        break;
      }
    }
    if (idx === null) continue;
    usedIdxs.add(idx);
    blockToIdx.set(block, idx);
  }

  // 実際に block で参照される idx だけ upload する。表示されないものはメディア層を汚さない。
  const uploadedUrls = new Map<number, string>();
  if (options.uploadImage) {
    for (const idx of usedIdxs) {
      const slot = pending[idx];
      if (!slot) continue;
      if (slot.kind === "fallback") {
        uploadedUrls.set(idx, slot.dataUrl);
        continue;
      }
      if (slot.kind !== "renderable") continue;
      try {
        console.debug(`[docx-import] #${idx} アップロード開始`, {
          mime: slot.file.type,
          size: slot.file.size,
        });
        const url = await options.uploadImage(slot.file);
        stats.succeeded++;
        console.debug(`[docx-import] #${idx} アップロード成功`, { url });
        uploadedUrls.set(idx, url);
      } catch (err) {
        stats.failed++;
        console.error(`[docx-import] #${idx} アップロード失敗:`, err);
        // upload 失敗時は base64 を埋めてノート上だけでも画像が見えるようにする
        try {
          const buf = await slot.file.arrayBuffer();
          const u8 = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
          uploadedUrls.set(idx, `data:${slot.file.type};base64,${btoa(bin)}`);
        } catch (e2) {
          console.error(`[docx-import] #${idx} base64 フォールバックも失敗:`, e2);
        }
      }
    }
    console.info(`[docx-import] 画像処理完了`, {
      ...stats,
      blocksKept: imageBlocksInOrder.length,
      uploaded: uploadedUrls.size,
      droppedByBlockNote: pending.filter((p) => p?.kind === "renderable").length - usedIdxs.size,
    });
  }

  // 各 image ブロックの url を確定値で書き戻す
  const fixedBlocks = rewriteImageBlocks(blocks as any[], blockToIdx, uploadedUrls);

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
    ...(options.parentAssetFileId
      ? { sourceDocumentFileId: options.parentAssetFileId, sourceDocumentName: file.name }
      : {}),
  };
}

/** 出現順に image ブロックを集める（children も再帰）。同一参照を後段で書き戻すのに使う */
function collectImageBlocksInOrder(blocks: any[]): any[] {
  const out: any[] = [];
  const visit = (b: any) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "image") out.push(b);
    if (Array.isArray(b.children)) for (const c of b.children) visit(c);
  };
  for (const b of blocks) visit(b);
  return out;
}

/** image ブロックの url を確定値で書き戻す。引き当てが無いブロックは props.url を空文字に揃える */
function rewriteImageBlocks(
  blocks: any[],
  blockToIdx: Map<any, number>,
  uploadedUrls: Map<number, string>,
): any[] {
  const visit = (b: any): any => {
    if (!b || typeof b !== "object") return b;
    let next = b;
    if (b.type === "image") {
      const idx = blockToIdx.get(b);
      const url = idx !== undefined ? uploadedUrls.get(idx) : undefined;
      next = { ...b, props: { ...(b.props ?? {}), url: url ?? "" } };
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
