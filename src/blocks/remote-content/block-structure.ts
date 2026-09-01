// BlockNote の「ブロックコンテンツ要素」を組み立てる。
//
// BlockNote 標準の image / video / audio は、render の戻り値を wrapInBlockStructure
// （@blocknote/core 内部）で `<div class="bn-block-content" data-content-type="image">`
// に包んでから返す。ゲートがブロック側に倒れたときは元の render を**呼ばない**ので、
// その包みが手に入らない。呼ばないこと自体が「外部ホストへ要求を出さない」の根拠
// （URL を DOM に載せる経路が存在しない）なので、包みのほうをこちらで組み立てる。
//
// 内部実装の写しである以上ズレ得るため、gate.test.ts が実物の spec を jsdom で
// 描画して「読み込み済みブロックの外側」と「ブロック中の外側」の class・属性が
// 一致することを確かめている。BlockNote 側が変わればそのテストが落ちる。

/** camelCase のプロップ名 → `data-kebab-case` 属性名 */
function propAttrName(prop: string): string {
  return "data-" + prop.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

/** 空要素と重複を落として class 文字列を組む */
function mergeClasses(...classes: (string | undefined)[]): string {
  return [...new Set(classes.filter(Boolean).join(" ").split(" "))]
    .filter(Boolean)
    .join(" ");
}

/**
 * ブロックコンテンツ要素を作り、中身を入れて返す。
 *
 * - class は `bn-block-content` +（あれば）呼び出し側の class
 * - `data-content-type` にブロック型
 * - 既定値と異なるプロップだけを `data-*` 属性として載せる
 * - ファイル系ブロック（meta.fileBlockAccept を持つ）は `data-file-block`
 */
export function createBlockContentElement({
  type,
  props,
  propSchema,
  isFileBlock,
  blockContentDOMAttributes,
  child,
}: {
  type: string;
  props: Record<string, unknown>;
  propSchema: Record<string, { default: unknown }>;
  isFileBlock: boolean;
  blockContentDOMAttributes?: Record<string, string>;
  child: HTMLElement;
}): HTMLElement {
  const dom = document.createElement("div");
  for (const [name, value] of Object.entries(blockContentDOMAttributes ?? {})) {
    if (name !== "class") dom.setAttribute(name, value);
  }
  dom.className = mergeClasses("bn-block-content", blockContentDOMAttributes?.class);
  dom.setAttribute("data-content-type", type);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === propSchema?.[name]?.default) continue;
    dom.setAttribute(propAttrName(name), String(value));
  }
  if (isFileBlock) dom.setAttribute("data-file-block", "");
  dom.appendChild(child);
  return dom;
}
