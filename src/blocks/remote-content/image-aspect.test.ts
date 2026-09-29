// @vitest-environment jsdom
// 画像ブロックの高さ上限に使う縦横比（--graphium-image-ar）の回帰ガード。
//
// jsdom はレイアウトを計算しないので、ここで守るのは「変数が正しい値で・正しい要素に・
// 正しいタイミングで置かれる」ことまで。CSS が実際に効いてハンドルの位置が合うかは
// Storybook（Blocks/Image max height）と dev で見る。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { gatedImageBlock, gatedVideoBlock } from "./gated-media-spec";
import { allowRemoteContentFor, resetRemoteContentGate, setEditorRemoteScope } from "./store";
import { IMAGE_ASPECT_VAR, computeAspectRatio, trackImageAspectRatio } from "./image-aspect";

const REMOTE_URL = "https://example.test/pic.png";
const LOCAL_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("computeAspectRatio", () => {
  it("幅 ÷ 高さを返す", () => {
    expect(computeAspectRatio(800, 400)).toBe(2);
    expect(computeAspectRatio(300, 300)).toBe(1);
    expect(computeAspectRatio(300, 600)).toBe(0.5);
  });

  it("寸法が無い・0・負・非有限は null（上限を掛けない）", () => {
    expect(computeAspectRatio(0, 0)).toBeNull();
    expect(computeAspectRatio(100, 0)).toBeNull();
    expect(computeAspectRatio(0, 100)).toBeNull();
    expect(computeAspectRatio(-1, 100)).toBeNull();
    expect(computeAspectRatio(Number.NaN, 100)).toBeNull();
    expect(computeAspectRatio(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("極端な縦長・横長は丸める（幅が消えない・値が有限に収まる）", () => {
    expect(computeAspectRatio(1, 1000)).toBe(0.1);
    expect(computeAspectRatio(100000, 1)).toBe(100);
  });
});

/** 標準 render が触る最小限のエディタ（gate.test.ts と同じ形） */
function makeEditor(scope: string) {
  const editor = {
    isEditable: true,
    domElement: document.createElement("div"),
    updateBlock: vi.fn(),
    onUploadStart: () => () => {},
    resolveFileUrl: async (url: string) => url,
    dictionary: {
      file_blocks: {
        add_button_text: { file: "Add file", image: "Add image", video: "Add video", audio: "Add audio" },
      },
    },
  };
  setEditorRemoteScope(editor, scope);
  return editor;
}

function makeBlock(type: string, url: string) {
  return {
    id: `block-${type}`,
    type,
    props: { url, name: "", caption: "", showPreview: true, backgroundColor: "default" },
  };
}

function render(spec: any, block: any, editor: any) {
  return spec.implementation.render.call(
    { blockContentDOMAttributes: {}, renderType: "nodeView", props: undefined },
    block,
    editor,
  );
}

/** img の寸法を差し替える（jsdom は画像を読まないので naturalWidth / Height は常に 0） */
function setNatural(img: HTMLImageElement, width: number, height: number, complete = true) {
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  Object.defineProperty(img, "complete", { configurable: true, value: complete });
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function wrapperOf(dom: HTMLElement): HTMLElement {
  return dom.querySelector(".bn-file-block-content-wrapper") as HTMLElement;
}

beforeEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
});

afterEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
});

describe("trackImageAspectRatio（手組みの DOM）", () => {
  function build() {
    const root = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.className = "bn-file-block-content-wrapper";
    const img = document.createElement("img");
    img.className = "bn-visual-media";
    wrapper.appendChild(img);
    root.appendChild(wrapper);
    return { root, wrapper, img };
  }

  it("読み込み前は変数を置かない", () => {
    const { root, wrapper } = build();
    trackImageAspectRatio(root);
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("");
  });

  it("load で寸法から縦横比を置く", () => {
    const { root, wrapper, img } = build();
    trackImageAspectRatio(root);
    setNatural(img, 400, 800);
    img.dispatchEvent(new Event("load"));
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("0.5");
  });

  it("すでに読み込み済みならその場で置く", () => {
    const { root, wrapper, img } = build();
    setNatural(img, 300, 300);
    trackImageAspectRatio(root);
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("1");
  });

  it("src が変わって再び load したら測り直す（古い比率を残さない）", () => {
    const { root, wrapper, img } = build();
    trackImageAspectRatio(root);
    setNatural(img, 400, 800);
    img.dispatchEvent(new Event("load"));
    setNatural(img, 800, 400);
    img.dispatchEvent(new Event("load"));
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("2");
  });

  it("読み込み失敗では変数を外す（上限を掛けない）", () => {
    const { root, wrapper, img } = build();
    trackImageAspectRatio(root);
    setNatural(img, 400, 800);
    img.dispatchEvent(new Event("load"));
    setNatural(img, 0, 0);
    img.dispatchEvent(new Event("error"));
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("");
  });

  it("寸法が 0 の load（寸法を持たない SVG など）では置かない", () => {
    const { root, wrapper, img } = build();
    trackImageAspectRatio(root);
    setNatural(img, 0, 0);
    img.dispatchEvent(new Event("load"));
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("");
  });

  it("wrapper か img が無い DOM（未設定ブロックのボタン等）では何もしない", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="bn-file-block-content-wrapper"><button>Add image</button></div>';
    expect(() => trackImageAspectRatio(root)).not.toThrow();
  });
});

describe("画像ブロックの描画（gated spec 経由）", () => {
  it("ローカル参照の画像: load 後に層 2 へ縦横比が載る", async () => {
    const result = render(gatedImageBlock.spec, makeBlock("image", LOCAL_URL), makeEditor("n-local"));
    const dom = result.dom as HTMLElement;
    await tick(); // resolveFileUrl の then で src が入る
    const img = dom.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    const wrapper = wrapperOf(dom);
    expect(wrapper).not.toBeNull();
    // 層 2 は層 1（bn-block-content）の直接の子。app.css のセレクタ（`>`）が前提にしている
    expect(wrapper.parentElement).toBe(dom);
    expect(dom.getAttribute("data-content-type")).toBe("image");
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("");

    setNatural(img, 300, 600);
    img.dispatchEvent(new Event("load"));
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("0.5");
    result.destroy?.();
  });

  it("previewWidth があっても縦横比の変数は独立に置かれる", async () => {
    const block = makeBlock("image", LOCAL_URL);
    (block.props as any).previewWidth = 240;
    const result = render(gatedImageBlock.spec, block, makeEditor("n-pw"));
    const dom = result.dom as HTMLElement;
    await tick();
    const img = dom.querySelector("img") as HTMLImageElement;
    setNatural(img, 240, 90);
    img.dispatchEvent(new Event("load"));
    const wrapper = wrapperOf(dom);
    expect(wrapper.style.width).toBe("240px");
    expect(Number(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR))).toBeCloseTo(240 / 90);
    result.destroy?.();
  });

  it("外部 URL: 同意の前は img が無く、同意後（差し替え後）にも縦横比が載る", async () => {
    const result = render(gatedImageBlock.spec, makeBlock("image", REMOTE_URL), makeEditor("n-remote"));
    const dom = result.dom as HTMLElement;
    expect(dom.querySelector("img")).toBeNull();
    expect(wrapperOf(dom)).toBeNull();

    allowRemoteContentFor("n-remote");
    await tick();
    const img = dom.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    const wrapper = wrapperOf(dom);
    expect(wrapper.parentElement).toBe(dom);

    setNatural(img, 800, 400);
    img.dispatchEvent(new Event("load"));
    expect(wrapper.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("2");
    result.destroy?.();
  });

  it("同意済みの外部 URL でも、描画のあとの load で縦横比が載る", async () => {
    allowRemoteContentFor("n-allowed");
    const result = render(gatedImageBlock.spec, makeBlock("image", REMOTE_URL), makeEditor("n-allowed"));
    const dom = result.dom as HTMLElement;
    await tick();
    const img = dom.querySelector("img") as HTMLImageElement;
    setNatural(img, 100, 400);
    img.dispatchEvent(new Event("load"));
    expect(wrapperOf(dom).style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("0.25");
    result.destroy?.();
  });

  it("video には縦横比の変数を置かない（上限は画像だけ）", async () => {
    const result = render(gatedVideoBlock.spec, makeBlock("video", LOCAL_URL), makeEditor("n-video"));
    const dom = result.dom as HTMLElement;
    await tick();
    expect(dom.getAttribute("data-content-type")).toBe("video");
    for (const el of dom.querySelectorAll<HTMLElement>("*")) {
      expect(el.style.getPropertyValue(IMAGE_ASPECT_VAR)).toBe("");
    }
    result.destroy?.();
  });
});
