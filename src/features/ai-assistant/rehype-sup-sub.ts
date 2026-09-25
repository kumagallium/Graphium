// AI チャットの回答に書かれた <sup>…</sup> / <sub>…</sub> を上付き・下付きとして描画する rehype プラグイン
//
// react-markdown は Markdown 中の生の HTML を raw ノードにして、描画の直前に文字列へ戻す
// （rehype-raw を入れない限りタグが文字のまま出る）。rehype-raw は任意の HTML を通してしまうので
// 入れず、属性の無い <sup> / <sub> の開き・閉じの対だけを要素に組み直す。
// 段落の中では「10<sup>5</sup>」が text "10"・raw "<sup>"・text "5"・raw "</sup>" の兄弟として
// 並ぶので、同じ親の中で開きと閉じを対にして、間の兄弟を新しい要素で包む。
//
// - 属性付きのタグ（<sup class="x">）、対にならないタグ、別の親（強調の内外・表の別のセル）に
//   分かれたタグは raw のまま残し、react-markdown が従来どおり文字として出す
// - コード（pre / code）の中には入らない。Markdown のコードは中身を文字として持つので raw は
//   現れないが、HTML のサンプルコードを書き換えないことを構造でも保証しておく
// - 作る要素には属性を持たせない（生の HTML からは何も引き継がない）

/** このプラグインが読む範囲の hast ノード（@types/hast は直接の依存に無いので必要な形だけ持つ） */
type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

type ScriptTag = "sup" | "sub";

// 属性の無い開き・閉じタグだけ。大文字や「>」の前の空白は HTML として同じタグなので受け付ける
const OPEN_TAG = /^<(sup|sub)\s*>$/i;
const CLOSE_TAG = /^<\/(sup|sub)\s*>$/i;

/** 中に入らない要素 */
const SKIP_TAGS = new Set(["pre", "code"]);

function matchTag(node: HastNode, pattern: RegExp): ScriptTag | null {
  if (node.type !== "raw" || typeof node.value !== "string") return null;
  const m = pattern.exec(node.value);
  return m ? (m[1].toLowerCase() as ScriptTag) : null;
}

/** node 以下の <sup> / <sub> の対を要素に組み直す（node をその場で書き換える） */
export function wrapSupSub(node: HastNode): void {
  if (!Array.isArray(node.children)) return;
  if (node.type === "element" && SKIP_TAGS.has(node.tagName ?? "")) return;
  // 子を先に処理しておけば、包んだ中身をもう一度たどらずに済む
  for (const child of node.children) wrapSupSub(child);
  if (node.children.some((child) => child.type === "raw")) {
    node.children = pairTags(node.children);
  }
}

function pairTags(children: HastNode[]): HastNode[] {
  const out: HastNode[] = [];
  // まだ閉じていない開きタグ（out 上の位置）。閉じタグは同じ名前の直近の開きと対にする
  const opens: { tag: ScriptTag; at: number }[] = [];
  for (const child of children) {
    const openTag = matchTag(child, OPEN_TAG);
    if (openTag) {
      opens.push({ tag: openTag, at: out.length });
      out.push(child);
      continue;
    }
    const closeTag = matchTag(child, CLOSE_TAG);
    let k = opens.length - 1;
    while (closeTag && k >= 0 && opens[k].tag !== closeTag) k--;
    if (!closeTag || k < 0) {
      out.push(child);
      continue;
    }
    // 間に残った閉じていない開きタグは、raw のまま（= 文字として）中身に入る
    const inner = out.splice(opens[k].at).slice(1);
    opens.length = k;
    out.push({ type: "element", tagName: closeTag, properties: {}, children: inner });
  }
  return out;
}

/** ReactMarkdown の rehypePlugins に渡す */
export function rehypeSupSub() {
  return (tree: HastNode) => {
    wrapSupSub(tree);
  };
}
