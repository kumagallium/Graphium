// 書き出し用エディタが「取得を行う要素」を作らないようにするための差し替え。
//
// 背景: BlockNote 標準の image / video / audio は、HTML 化（toExternalHTML）の中で
// `document.createElement("img")` してから `.src = props.url` を代入する。この要素は
// 画面の document に属するので、DOM に挿さっていなくても代入した時点で取りに行く
// （`new Image().src = url` と同じ）。一括 Markdown 書き出しは画面を持たないため、
// 誰にも見えないまま、全ノートに書かれた外部 URL へ一斉に要求が出ることになる。
// 本文のゲート（blocks/remote-content）は spec の描画を差し替える作りなので、
// 素の defaultBlockSpecs で組んだヘッドレスエディタには効かない。
//
// ここでの対処は「同じ HTML を、取得の仕組みを持たない要素で組み立てる」。
// createElementNS に HTML 以外の名前空間を渡すと、要素名が img でも
// HTMLImageElement ではない素の Element になる。src は属性が付くだけで、画像の
// 読み込みアルゴリズムを持たない。HTML への直列化では要素名がそのまま出るため
// （`<img src="…"></img>`）、そこから作られる Markdown は従来と同じ文字列になる
// （doc-to-markdown.test.ts が標準 spec の出力と 1 文字ずつ突き合わせている）。
//
// 差し替えは spec 1 個の HTML 生成 1 回分に限り、finally で必ず戻す。包む対象は
// BlockNote の toExternalHTML / render＝同期関数なので、この窓の中で他のコードが
// createElement を呼ぶことはない。書き出し以外の経路には触らない。

/** HTML 名前空間の外に要素を作るための URI。実在の語彙ではなく、識別のためだけの文字列 */
const INERT_NAMESPACE = "urn:graphium:markdown-export";

/**
 * 標準 spec が要素を作った直後に代入する IDL プロパティ。
 * 素の Element にはこれらの受け皿が無く、代入しても属性にならない（HTML に出ない）ので、
 * 属性へ落とすアクセサを足す。ここに載っていないプロパティを標準 spec が使い始めれば
 * その属性は HTML から落ちる。突き合わせテストが対象にしているブロック・プロップの
 * 範囲では、それは標準 spec との差分として出る。
 */
const REFLECTED_PROPERTIES = ["src", "alt", "width", "height", "title", "poster"] as const;

/** この名前で createElement されたら差し替える（要素自身が取得を行うもの） */
const FETCHING_TAG_NAMES: ReadonlySet<string> = new Set([
  "img",
  "video",
  "audio",
  "source",
  "track",
  "iframe",
  "embed",
]);

/**
 * 取得を行わない、名前だけ同じ要素を作る。
 * HTMLElement ではないので dataset / style などは生えていない。標準 spec が
 * それらを触り始めると変換は例外になるが、doc-to-markdown 側が 1 ノート単位で
 * 捕まえてプレーンテキストに落とす（外へ要求が出るよりは落ちる方を選ぶ）。
 */
function createInertElement(tagName: string): Element {
  const element = document.createElementNS(INERT_NAMESPACE, tagName);
  for (const name of REFLECTED_PROPERTIES) {
    Object.defineProperty(element, name, {
      configurable: true,
      get: () => element.getAttribute(name) ?? "",
      set: (value: unknown) => element.setAttribute(name, String(value)),
    });
  }
  return element;
}

/** run の実行中だけ、取得を行う要素名の createElement を差し替える */
function withInertMediaElements<T>(run: () => T): T {
  const original = document.createElement;
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(document, "createElement");
  document.createElement = function (
    this: Document,
    tagName: string,
    options?: ElementCreationOptions,
  ) {
    if (FETCHING_TAG_NAMES.has(tagName.toLowerCase())) {
      return createInertElement(tagName) as HTMLElement;
    }
    return original.call(this, tagName, options);
  } as typeof document.createElement;
  try {
    return run();
  } finally {
    // 元が prototype 側のメソッドだったなら、document 自身に残さず消して戻す
    if (hadOwnProperty) document.createElement = original;
    else delete (document as Partial<Document>).createElement;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => unknown;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpec = any;

/** spec の HTML 生成関数（あるものだけ）を、上の差し替え下で走る関数に包む */
function wrapSpec(spec: AnySpec): AnySpec {
  const implementation = spec?.implementation;
  if (!implementation) return spec;

  const wrapped: Record<string, unknown> = { ...implementation };
  // 書き出しは toExternalHTML を使い、それを持たない spec では render に落ちる
  // （BlockNote の serializeBlocksExternalHTML）。どちらも要素を作るので両方包む。
  for (const key of ["toExternalHTML", "render"] as const) {
    const base = implementation[key] as AnyFn | undefined;
    if (typeof base !== "function") continue;
    wrapped[key] = function (this: unknown, ...args: unknown[]) {
      return withInertMediaElements(() => base.apply(this, args));
    };
  }
  return { ...spec, implementation: wrapped };
}

/**
 * blockSpecs 一式を「HTML 化のあいだ取得を行う要素を作らない」spec 一式に変換する。
 * config はそのまま引き継ぐので、スキーマ（ブロック型・プロップ）は変わらない。
 * メディア系だけでなく全 spec を包むのは、どの spec が `<img>` を作るかを
 * こちら側で列挙しないため（BlockNote 側の変更で漏れが出ないように）。
 */
export function inertMediaBlockSpecs<T extends Record<string, unknown>>(specs: T): T {
  const out: Record<string, unknown> = {};
  for (const [type, spec] of Object.entries(specs)) {
    out[type] = wrapSpec(spec);
  }
  return out as T;
}
