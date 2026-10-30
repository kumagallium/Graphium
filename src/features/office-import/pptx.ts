// PowerPoint (.pptx) を展開して「スライドの文字」と「埋め込み画像」を取り出す。
//
// .pptx は OOXML（zip の中に XML 一式）。fflate の unzipSync でメモリ上に展開し、
// DOMParser（ブラウザ API）で必要な XML だけを読む。docx と違って専用の
// パーサライブラリ（mammoth 相当）は使わず、ここで直接読む。
//
// スライド順は ppt/presentation.xml の <p:sldIdLst> と
// ppt/_rels/presentation.xml.rels（rId → ファイルパス）から求める。
// どちらかが壊れている／読めない場合は ppt/slides/slideN.xml の N を
// 数値順に並べたものにフォールバックする。
//
// 画像は ppt/media/* を列挙する。ブラウザで表示できない形式（EMF/WMF/TIFF）は
// docx-import/renderable-image.ts の変換に回し、変換できたものだけ PNG/SVG として
// 返す。変換できなかったものは件数だけ skippedImages に積んで捨てる
// （docx の埋め込み画像抽出と同じ方針）。

import { unzipSync } from "fflate";
import { isRenderableImageMime, convertNonRenderableImage, RENDERABLE_IMAGE_EXTS } from "../docx-import/renderable-image";

export type PptxSlide = { index: number; text: string };
export type PptxImage = { name: string; bytes: Uint8Array; mimeType: string };

export type PptxReadResult = {
  slides: PptxSlide[];
  images: PptxImage[];
  /** ブラウザで表示できず、変換にも失敗して捨てた画像の数 */
  skippedImages: number;
};

// 拡張子 → MIME（ppt/media 配下は拡張子で判別する。Content_Types.xml は見ない）
const MEDIA_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
};

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

/** ppt/slides/slideN.xml の N を取り出す。取れなければ null */
export function slideNumberOf(path: string): number | null {
  const m = path.match(/ppt\/slides\/slide(\d+)\.xml$/i);
  return m ? Number(m[1]) : null;
}

/**
 * ppt/presentation.xml の <p:sldIdLst><p:sldId r:id="rIdN"/>...</p:sldIdLst> から
 * rId の並び順を取り、ppt/_rels/presentation.xml.rels で rId → "slides/slideN.xml"
 * を解決してスライドファイルの並び順（フルパス）を返す。読めなければ null。
 */
export function resolveSlideOrder(
  entries: Record<string, Uint8Array>,
  parser: DOMParser,
): string[] | null {
  const presentationXml = entries["ppt/presentation.xml"];
  const relsXml = entries["ppt/_rels/presentation.xml.rels"];
  if (!presentationXml || !relsXml) return null;
  try {
    const presDoc = parser.parseFromString(new TextDecoder().decode(presentationXml), "application/xml");
    const relsDoc = parser.parseFromString(new TextDecoder().decode(relsXml), "application/xml");

    // rId → Target（"slides/slideN.xml" 相対パス）
    const relMap = new Map<string, string>();
    for (const rel of Array.from(relsDoc.getElementsByTagName("Relationship"))) {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) relMap.set(id, target);
    }

    const sldIds = Array.from(presDoc.getElementsByTagName("p:sldId"));
    const order: string[] = [];
    for (const sldId of sldIds) {
      // 名前空間プレフィックスが r: とは限らない（xmlns:r の別名を使う文書もある）ため
      // 属性名の末尾一致で拾う。p:sldId は無名前空間の id（スライド ID）も持つため、
      // 先に ":id"（例: "r:id"）を探し、見つからないときだけ無印の "id" を使う
      let rId: string | null = null;
      for (const attr of Array.from(sldId.attributes)) {
        if (attr.name.endsWith(":id")) {
          rId = attr.value;
          break;
        }
      }
      if (!rId) rId = sldId.getAttribute("id");
      if (!rId) continue;
      const target = relMap.get(rId);
      if (!target) continue;
      // Target は "slides/slideN.xml" のような ppt/ からの相対パス
      const normalized = target.startsWith("slides/") ? `ppt/${target}` : target;
      order.push(normalized);
    }
    return order.length > 0 ? order : null;
  } catch (err) {
    console.warn("[office-import/pptx] スライド順の解決に失敗（数値順にフォールバック）:", err);
    return null;
  }
}

/** slide の XML から <a:t> のテキストを空白区切りで連結する */
function extractSlideText(xml: Uint8Array, parser: DOMParser): string {
  const doc = parser.parseFromString(new TextDecoder().decode(xml), "application/xml");
  const nodes = Array.from(doc.getElementsByTagName("a:t"));
  return nodes.map((n) => n.textContent ?? "").filter((s) => s.length > 0).join(" ");
}

/** .pptx の bytes を読み、スライドの文字と埋め込み画像を取り出す */
export async function readPptx(bytes: Uint8Array): Promise<PptxReadResult> {
  const entries = unzipSync(bytes);
  const parser = new DOMParser();

  // スライド順を決める。resolveSlideOrder が取れなければ slideN.xml の N で数値順
  let slidePaths = resolveSlideOrder(entries, parser);
  if (!slidePaths) {
    slidePaths = Object.keys(entries)
      .filter((p) => slideNumberOf(p) !== null)
      .sort((a, b) => (slideNumberOf(a) ?? 0) - (slideNumberOf(b) ?? 0));
  }

  // 欠落パス（rels が指すスライドの実体が zip に無い等）はスキップするが、
  // 連番は「実際に出力するスライドの数」で振る（元の配列位置だと歯抜けになる）
  const slides: PptxSlide[] = [];
  for (const path of slidePaths) {
    const xml = entries[path];
    if (!xml) continue;
    slides.push({ index: slides.length + 1, text: extractSlideText(xml, parser) });
  }

  // 埋め込み画像: ppt/media/* を列挙
  const images: PptxImage[] = [];
  let skippedImages = 0;
  const mediaPaths = Object.keys(entries).filter((p) => p.startsWith("ppt/media/"));
  for (const path of mediaPaths) {
    const raw = entries[path];
    const ext = extOf(path);
    const mime = MEDIA_EXT_TO_MIME[ext];
    if (!mime) {
      skippedImages++;
      continue;
    }
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (isRenderableImageMime(mime)) {
      images.push({ name, bytes: raw, mimeType: mime });
      continue;
    }
    // EMF / WMF / TIFF は変換を試み、ダメなら捨てる
    try {
      const converted = await convertNonRenderableImage(mime, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), name.replace(/\.[^.]+$/, ""));
      if (converted) {
        const convertedBytes = new Uint8Array(await converted.arrayBuffer());
        images.push({ name: converted.name, bytes: convertedBytes, mimeType: converted.type });
        continue;
      }
    } catch (err) {
      console.warn(`[office-import/pptx] 画像変換に失敗: ${path}`, err);
    }
    skippedImages++;
  }

  return { slides, images, skippedImages };
}

/** 表紙の縮小画像としてそのまま表示できる形式（EMF/WMF は変換せず「無し」に倒す） */
const THUMBNAIL_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

/**
 * .pptx に保存されている表紙の縮小画像（1 枚目のスライドの絵）を取り出す。無ければ null。
 *
 * PowerPoint は保存時に 1 枚目のスライドを描いた縮小画像を docProps/thumbnail.jpeg に入れる
 * （「縮小版を保存する」設定や作ったアプリによっては入っていない）。スライドを自前で
 * 描くエンジンは持たないので、見た目が正確な絵はこれだけ。場所はパッケージの
 * _rels/.rels の thumbnail 関係から引き、読めなければ docProps/thumbnail.* を探す。
 * 必要なファイルだけを展開する（スライドや画像は展開しない）。
 */
export function readPptxThumbnail(bytes: Uint8Array): PptxImage | null {
  // 1 回目: 関係ファイルだけ展開して、縮小画像の場所を引く
  let relTarget: string | null = null;
  try {
    const rels = unzipSync(bytes, { filter: (file) => file.name === "_rels/.rels" })["_rels/.rels"];
    if (rels) {
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(rels), "application/xml");
      for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
        const type = rel.getAttribute("Type") ?? "";
        const target = rel.getAttribute("Target");
        if (type.endsWith("/metadata/thumbnail") && target) {
          relTarget = target.replace(/^\//, "");
          break;
        }
      }
    }
  } catch {
    return null;
  }

  // 2 回目: 縮小画像だけ展開する（関係で引けなければ docProps/thumbnail.* を探す）
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => file.name === relTarget || file.name.startsWith("docProps/thumbnail"),
    });
  } catch {
    return null;
  }
  const path =
    (relTarget && entries[relTarget] ? relTarget : null)
    ?? Object.keys(entries).find((p) => p.startsWith("docProps/thumbnail"))
    ?? null;
  if (!path) return null;
  const mimeType = THUMBNAIL_MIME[extOf(path)];
  const raw = entries[path];
  if (!mimeType || !raw || raw.byteLength === 0) return null;
  return { name: path.slice(path.lastIndexOf("/") + 1), bytes: raw, mimeType };
}

/** 拡張子から画像 File 名を組み立てるときに使う拡張子表（呼び出し側の参考用） */
export { RENDERABLE_IMAGE_EXTS };
