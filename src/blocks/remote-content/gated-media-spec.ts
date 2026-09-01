// BlockNote 標準の image / video / audio ブロックに「外部 URL は既定で取りに行かない」
// ゲートを被せた spec。
//
// 標準の render は props.url を `<img>` / `<video>` / `<audio>` の src にそのまま入れる。
// つまり、他人から受け取ったノートを開いただけで、URL を書いた側は読み手の IP と
// 開いた時刻を知る。ノートを開く＝差出人に通知が飛ぶ、を既定にはしない。
//
// このファイルがしているのは 2 つ:
//   1. ローカル参照でない URL を持つブロックについて、同意が無い間は**標準の render を
//      呼ばない**。呼ばないので、その URL が DOM に載る経路自体が存在しない。
//      （src を代入してから隠す・CSS で消す、では取得はもう済んでいる。）
//   2. 書き出し・クリップボード用の toExternalHTML も、同意が無い間は `<img>` を
//      作らない形（BlockNote 自身の showPreview: false の出力）に倒す。
//
// 1. の render は画面の描画だけでなく、貼り付けの途中でも呼ばれる。BlockNote の
// 貼り付けは「外部 HTML → ブロック → 内部 HTML → 貼り付け」と往復し（ExportManager.
// pasteHTML）、その内部 HTML 化がブロックの render を renderType: "dom" で呼ぶため。
// つまり `<img src="https://…">` を含む HTML を貼った瞬間、ブロックが本文に入る前に
// 取得が始まり得る経路だった。ここも同じゲートを通る（gate.test.ts で確認）。
// ただし "dom" の呼び出しは画面に出ないので、バーの件数には数えない。
//
// このゲートが止めるのは「この spec の描画・書き出しが出す要求」だけ。ノートを開けば
// 外へ何も出ない、を保証するものではない。同じノートを開いたときに動く別経路として、
// 少なくとも次が残っている:
//   - sidecar の /url/image-proxy・/url/reader、OCR の wasm / 言語データ CDN
// bookmark ブロックと markdown 一括書き出しはかつてここに並んでいたが、いまは塞がって
// いる（bookmark は blocks/bookmark/view.tsx が同じ同意を見る、一括書き出しは
// markdown-export/inert-media-elements.ts が取得しない要素に差し替える）。
//
// spec は config を参照ごと引き継ぐので、保存されるドキュメントのスキーマ
// （ブロック型名・プロップ名・既定値）は標準と 1 ビットも変わらない。古いビルドで
// 開いても、このビルドで開いても同じノートとして読める。

import { defaultBlockSpecs } from "@blocknote/core";
import type { CustomBlockEntry } from "../../base/schema";
import { isLocalMediaRef } from "../../features/asset-browser/local-media-ref";
import { createBlockContentElement } from "./block-structure";
import { createBlockedMediaPlaceholder, type BlockedMediaKind } from "./placeholder";
import {
  allowRemoteContentFor,
  editorRemoteScope,
  isRemoteContentAllowed,
  registerBlockedRemoteBlock,
  subscribeRemoteContentChange,
  unregisterBlockedRemoteBlock,
} from "./store";

/** 標準 render が受け取る this（BlockNote が nodeView / dom 双方で渡す） */
type RenderContext = {
  blockContentDOMAttributes?: Record<string, string>;
  renderType?: "nodeView" | "dom";
  props?: unknown;
};

type RenderResult = {
  dom: HTMLElement | DocumentFragment;
  contentDOM?: HTMLElement;
  ignoreMutation?: (mutation: unknown) => boolean;
  destroy?: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;

type BaseRender = (this: RenderContext, block: AnyBlock, editor: AnyEditor) => RenderResult;

type BaseToExternalHTML = (
  this: RenderContext,
  block: AnyBlock,
  editor: AnyEditor,
  context: { nestingLevel: number },
) => RenderResult | undefined;

/**
 * 読み込む側の後始末。
 *
 * `<img>` は Referer に今開いている画面の URL を載せる。デスクトップ版はアプリ内部の
 * URL（ノート ID を含み得る）なので、読み込みに同意した後でも渡す理由が無い。
 *
 * 標準 render は editor.resolveFileUrl があると src の代入をその then まで遅らせる。
 * メインエディタ・SidePeek はどちらも resolveFileUrl を渡すので、ここで属性を足すのは
 * 代入より前になる。resolveFileUrl を渡さないエディタでは src が同期で入るため、
 * その 1 回は Referer 付きで出る（この関数は取得そのものは止めない）。
 */
function applyNoReferrer(dom: HTMLElement | DocumentFragment): void {
  const root = dom as HTMLElement;
  if (typeof root.querySelectorAll !== "function") return;
  for (const el of root.querySelectorAll("img, video, audio, iframe")) {
    el.setAttribute("referrerpolicy", "no-referrer");
  }
}

/** ブロックの url プロップ（無ければ空文字） */
function blockUrl(block: AnyBlock): string {
  const url = block?.props?.url;
  return typeof url === "string" ? url : "";
}

/**
 * 標準 render を「同意が無い間は呼ばない」render に包む。
 *
 * ローカル参照（プロバイダのスキーム・blob:・data: など）と URL 未設定は素通し。
 * ユーザー自身が貼った画像はすべてこちらを通るので、見た目も挙動も従来どおり。
 */
function gateRender(baseRender: BaseRender, kind: BlockedMediaKind, spec: AnyBlock): BaseRender {
  const type: string = spec.config.type;
  const propSchema = spec.config.propSchema as Record<string, { default: unknown }>;
  const isFileBlock = spec.implementation?.meta?.fileBlockAccept !== undefined;

  return function gatedRender(this: RenderContext, block: AnyBlock, editor: AnyEditor): RenderResult {
    const url = blockUrl(block);
    if (!url || isLocalMediaRef(url)) return baseRender.call(this, block, editor);

    const scope = editorRemoteScope(editor);
    if (isRemoteContentAllowed(scope)) {
      const rendered = baseRender.call(this, block, editor);
      applyNoReferrer(rendered.dom);
      return rendered;
    }

    // ── ここから先は標準 render を呼ばない経路 ──
    const blockId: string = block?.id ?? "";
    const context = this;
    const dom = createBlockContentElement({
      type,
      props: block?.props ?? {},
      propSchema,
      isFileBlock,
      blockContentDOMAttributes: this?.blockContentDOMAttributes,
      child: createBlockedMediaPlaceholder(kind, url, () => allowRemoteContentFor(scope)),
    });

    // renderType が "dom" のときは画面に出る nodeView ではなく、HTML への書き出し
    // （blocksToFullHTML）。貼り付けとブロックのコピーがここを通る —— BlockNote は
    // 貼り付けを「外部 HTML → ブロック → 内部 HTML → 貼り付け」と往復させるため。
    //
    // 書き出しは 1 回きりで destroy が呼ばれないので、ここで件数に足すと減らす者が
    // いなくなり、バーが「まだ読み込んでいないメディアが N 件」を出したまま戻らない
    // （購読も外れずに残る）。数えるのは画面に出ているブロックだけにする。
    if (this?.renderType === "dom") return { dom };

    registerBlockedRemoteBlock(scope, blockId);

    let swapped = false;
    let delegateDestroy: (() => void) | undefined;
    let unsubscribe = () => {};
    const onGateChange = () => {
      if (swapped || !isRemoteContentAllowed(scope)) return;
      swapped = true;
      unsubscribe();
      unregisterBlockedRemoteBlock(scope, blockId);
      // 同意後は標準の描画に差し替える。ブロックの外側（bn-block-content）は
      // 作り直せないので、標準 render が返した外側の属性と子要素をこちらへ移す。
      // 子要素は移動なので、リサイズハンドル等に付いたイベントもそのまま生きる。
      const rendered = baseRender.call(context, block, editor);
      applyNoReferrer(rendered.dom);
      const renderedDom = rendered.dom as HTMLElement;
      if (typeof renderedDom.getAttributeNames === "function") {
        for (const name of dom.getAttributeNames()) dom.removeAttribute(name);
        for (const name of renderedDom.getAttributeNames()) {
          dom.setAttribute(name, renderedDom.getAttribute(name) ?? "");
        }
      }
      dom.replaceChildren(...Array.from(rendered.dom.childNodes));
      delegateDestroy = rendered.destroy;
    };
    unsubscribe = subscribeRemoteContentChange(onGateChange);

    return {
      dom,
      // このブロックは content: "none"（contentDOM を持たない）ので、DOM の入れ替えを
      // ProseMirror に本文の変更として読ませない。読ませるとドキュメントが汚れる。
      ignoreMutation: () => true,
      destroy: () => {
        unsubscribe();
        if (!swapped) unregisterBlockedRemoteBlock(scope, blockId);
        delegateDestroy?.();
      },
    };
  };
}

/**
 * 書き出し・クリップボード用 HTML も同じゲートに通す。
 *
 * 標準の toExternalHTML は showPreview が true のとき `<img src>` を作る。この要素は
 * document に挿さっていなくても src を入れた時点で取りに行くので、「Markdown で
 * 書き出す」「ブロックをコピーする」だけで、画面では読み込んでいない URL へ要求が
 * 出る。画面が無言のまま外に出る点は PDF 書き出しと同じ。
 *
 * ブロック中は showPreview: false で標準の実装を呼ぶ。BlockNote 自身がその場合に
 * 出す形（`<a href>`）は要素を取りに行かず、URL は書き出しにそのまま残る。
 * 独自のマークアップを作らずに済むので、BlockNote 側の変更にも追従する。
 * 見た目の代償として、読み込んでいない画像は Markdown で `![...]` ではなく
 * `[...]`（リンク）になる。読み込んだ後の書き出しは従来どおり。
 *
 * ここを画面と同じプレースホルダに倒してはいけない。ゲートが変えてよいのは
 * 「何を取りに行くか」だけで、「何が書き出されるか」ではない。既定がブロックである
 * 以上、書き出しから URL が消えれば、ユーザーは何も気付かないまま中身の欠けた
 * ファイルを受け取ることになる（bookmark ブロックで実際に起きた。view.tsx の
 * BookmarkExternalHTML 参照）。落としてよいのは表示の作りだけで、URL は残す。
 */
function gateToExternalHTML(base: BaseToExternalHTML): BaseToExternalHTML {
  return function gatedToExternalHTML(this: RenderContext, block, editor, context) {
    const url = blockUrl(block);
    if (!url || isLocalMediaRef(url)) return base.call(this, block, editor, context);
    if (isRemoteContentAllowed(editorRemoteScope(editor))) {
      return base.call(this, block, editor, context);
    }
    return base.call(
      this,
      { ...block, props: { ...block.props, showPreview: false } },
      editor,
      context,
    );
  };
}

/**
 * 標準 spec を「描画まわりだけ差し替えた spec」にする。
 * config は同じオブジェクトをそのまま渡すので、スキーマは一切変わらない。
 * parse / meta / runsBefore / extensions は素通し。
 */
function gateMediaSpec(spec: AnyBlock, kind: BlockedMediaKind): AnyBlock {
  return {
    ...spec,
    implementation: {
      ...spec.implementation,
      render: gateRender(spec.implementation.render as BaseRender, kind, spec),
      toExternalHTML: gateToExternalHTML(
        spec.implementation.toExternalHTML as BaseToExternalHTML,
      ),
    },
  };
}

export const gatedImageBlock: CustomBlockEntry = {
  type: "image",
  spec: gateMediaSpec(defaultBlockSpecs.image, "image"),
};

export const gatedVideoBlock: CustomBlockEntry = {
  type: "video",
  spec: gateMediaSpec(defaultBlockSpecs.video, "video"),
};

export const gatedAudioBlock: CustomBlockEntry = {
  type: "audio",
  spec: gateMediaSpec(defaultBlockSpecs.audio, "audio"),
};

/** 標準ブロックの差し替え一式（registry.ts が展開する） */
export const gatedMediaBlockEntries: CustomBlockEntry[] = [
  gatedImageBlock,
  gatedVideoBlock,
  gatedAudioBlock,
];
