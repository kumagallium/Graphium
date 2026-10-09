// Word（.docx）の本文を 1 本の文字列にする共通処理
//
// AI に渡す本文（取り込み・手順抽出）・出典照合の原文・MCP の get_source_text が使う。
// 以前はどれも mammoth.extractRawText を直接呼んでいたが、extractRawText は書式を全部捨てるので
// Word の上付き・下付きが消え、「1×10⁵」が「1×105」、「H₂O」が「H2O」になっていた
// （出典照合の根拠に「1×105[eV]」と出て、何が食い違っているのか読めなかった）。
//
// 出力は extractRawText と同じ（段落の後ろに空行、タブは \t）で、上付き・下付きの run だけ
// <sup> / <sub> で包む。ノート本文を AI に渡すときの表記（inlineContentToText の scripts: true）と
// 揃えている。上付き・下付きの無い文書の出力は extractRawText と 1 文字も変わらない。
//
// mammoth の公開 API には「文書ツリーを取り出す」口が無いので、convertToHtml の transformDocument で
// ツリーを受け取り、HTML 変換に進む前に打ち切る（画像の読み込みや HTML 生成はしない）。
// mammoth はブラウザでは import("mammoth")、MCP サーバー（Node）では bundle の外から動的 import で
// 読むので、モジュールは呼び出し側から渡す。

import { scriptStyleTag, type ScriptStyle } from "./script-styles";

/** mammoth モジュール（ESM の名前空間でも CJS の default 越しでもよい） */
export type MammothModule = {
  // 引数の型は mammoth 本体の型定義（Input / Options）と両立させるため any で受ける
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  convertToHtml?: (input: any, options?: any) => Promise<unknown>;
  default?: MammothModule;
};

/** ブラウザは { arrayBuffer }、Node は { buffer }（Node の mammoth は { arrayBuffer } を受けない） */
export type DocxInput = { arrayBuffer: ArrayBuffer } | { buffer: Uint8Array };

type DocxElement = {
  type?: string;
  value?: string;
  verticalAlignment?: string;
  children?: DocxElement[];
};

/** HTML 変換に進ませないための目印（transformDocument から投げて、ここで受け止める） */
const STOP = Symbol("docx-text-stop");

/**
 * .docx の本文を文字列にする。戻り値の形は mammoth.extractRawText に合わせる（{ value }）。
 */
export async function extractDocxText(mammothModule: MammothModule, input: DocxInput): Promise<{ value: string }> {
  const mammoth = mammothModule.convertToHtml ? mammothModule : mammothModule.default;
  if (!mammoth?.convertToHtml) throw new Error("mammoth.convertToHtml is not available");
  let tree: DocxElement | undefined;
  try {
    await mammoth.convertToHtml(input, {
      transformDocument: (element: unknown) => {
        tree = element as DocxElement;
        throw STOP;
      },
    });
  } catch (err) {
    if (err !== STOP) throw err;
  }
  return { value: tree ? joinAdjacentScriptTags(docxElementToText(tree)) : "" };
}

/**
 * Word は 1 つの上付きを複数の run に割ることがある（「-」と「5」が別 run など）。
 * 隣り合う同じタグを 1 つにまとめ、「10<sup>-</sup><sup>5</sup>」を「10<sup>-5</sup>」にする。
 */
export function joinAdjacentScriptTags(text: string): string {
  return text.replace(/<\/sup><sup>/g, "").replace(/<\/sub><sub>/g, "");
}

/**
 * mammoth の文書ツリーを文字列にする（mammoth/lib/raw-text.js と同じ規則＋上付き・下付き）。
 * テストから直接呼べるように export する。
 */
export function docxElementToText(element: DocxElement): string {
  if (element.type === "text") return element.value ?? "";
  if (element.type === "tab") return "\t";
  const inner = (element.children ?? []).map(docxElementToText).join("");
  if (element.type === "run") {
    const style = scriptStyleOf(element.verticalAlignment);
    // 中身が空の run（書式だけ残った run）はタグも出さない
    if (style && inner) {
      const tag = scriptStyleTag(style);
      return `<${tag}>${inner}</${tag}>`;
    }
    return inner;
  }
  return element.type === "paragraph" ? `${inner}\n\n` : inner;
}

function scriptStyleOf(verticalAlignment: string | undefined): ScriptStyle | null {
  if (verticalAlignment === "superscript") return "superscript";
  if (verticalAlignment === "subscript") return "subscript";
  return null;
}
