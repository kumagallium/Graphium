// エディタを作れない保存内容を、開ける形に直す（最後の安全網）。
//
// BlockNote は initialContent のどこか 1 か所でもスキーマに合わないと
// 「Error creating document from blocks passed as `initialContent`」で丸ごと throw する。
// 読込時のサニタイズ（blocks/registry.ts の sanitizeBlocksForLoad）は既知の型だけを
// 直すので、知らない壊れ方が来るとノートが開けず、再読み込みしても同じノートを開いて
// 落ち続ける（md の取り込みで起きた）。
//
// ここではブロックを 1 つずつ ProseMirror のノードに変換して検査し、通らないものだけを
// 中の文字を残した段落に置き換える。通常の読み込みでは呼ばない（エディタの生成が
// 失敗したときだけ editor.tsx の境界から呼ぶ）。

import { BlockNoteEditor, blockToNode } from "@blocknote/core";

export type RepairResult = {
  blocks: any[];
  /** 文字だけの段落に置き換えたブロックの数 */
  replaced: number;
};

/** 例外が initialContent の読み込み失敗か */
export function isInitialContentError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("initialContent");
}

export function repairBlocksForSchema(schema: any, blocks: any[]): RepairResult {
  const probe = BlockNoteEditor.create({ schema } as any);
  const pmSchema = probe.pmSchema;
  const styleSchema = (probe.schema as any).styleSchema;
  let replaced = 0;

  const fits = (block: any): boolean => {
    try {
      blockToNode(block, pmSchema, styleSchema).check();
      return true;
    } catch {
      return false;
    }
  };

  const repair = (list: any[]): any[] =>
    (list ?? []).map((block) => {
      if (fits(block)) return block;
      const children = Array.isArray(block?.children) ? repair(block.children) : [];
      // 子が原因なら、そのブロック自身は残す
      const withRepairedChildren = { ...block, children };
      if (children.length > 0 && fits(withRepairedChildren)) return withRepairedChildren;
      replaced++;
      const text = plainTextOf(block);
      const paragraph = {
        id: typeof block?.id === "string" ? block.id : undefined,
        type: "paragraph",
        content: text ? [{ type: "text", text, styles: {} }] : [],
        children,
      };
      return fits(paragraph) ? paragraph : { ...paragraph, children: [] };
    });

  return { blocks: repair(blocks), replaced };
}

/**
 * ブロックの中の文字を集める（読み取り専用で見せるための写し）。
 * 装飾の境目に空白は足さない・改行は残す（コードブロック）。表は行ごとに「 | 」で
 * つなぎ、画像などのメディアは名前と URL を残す（どこを指していたか分かるように）。
 */
function plainTextOf(block: any): string {
  const inline = (items: any): string => {
    if (!Array.isArray(items)) return typeof items === "string" ? items : "";
    let out = "";
    for (const c of items) {
      if (!c || typeof c !== "object") continue;
      if (typeof c.text === "string") out += c.text;
      else if (c.type === "inlineMath" && c.props?.latex) out += `$${c.props.latex}$`;
      if (Array.isArray(c.content)) out += inline(c.content);
    }
    return out;
  };
  const content = block?.content;
  let text: string;
  if (content && Array.isArray(content.rows)) {
    text = content.rows
      .map((row: any) =>
        (row?.cells ?? []).map((cell: any) => inline(Array.isArray(cell) ? cell : cell?.content)).join(" | "),
      )
      .join("\n");
  } else {
    text = inline(content);
  }
  if (!text) {
    const p = block?.props ?? {};
    text = [p.latex, p.name, p.caption, p.url].filter((v) => typeof v === "string" && v.trim()).join(" ");
  }
  return text.trim();
}
