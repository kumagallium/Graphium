// 画像ブロック → 素材のサイドピーク入口（image-peek）のテスト。
//
// - 出す条件の純関数 pickImagePeekFileId: 正常 / 外部 URL / 索引に無い / 索引が null /
//   開き手なし / url なし / extractFileId が投げる
// - 登録口 setImagePeekCallback / openImagePeek / hasImagePeek: 登録・未登録・解除・エディタ別

import { describe, it, expect, vi } from "vitest";

// resolveImagePeekFileId が引くプロバイダと索引を差し替える（dblclick のテスト用）
vi.mock("../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    extractFileId: (url: string) => (url.startsWith("local-media://") ? url.replace("local-media://", "") : null),
  }),
}));
vi.mock("../features/asset-browser/media-index", () => ({
  getLatestMediaIndex: () => ({ media: [{ fileId: "abc" }] }),
}));

import {
  handleImageDblclick,
  hasImagePeek,
  openImagePeek,
  pickImagePeekFileId,
  setImagePeekCallback,
} from "./image-peek";

// プロバイダの代役: local-media:// だけ fileId にする（外部 URL は null）
const extractFileId = (url: string) =>
  url.startsWith("local-media://") ? url.replace("local-media://", "") : null;

const index = { media: [{ fileId: "abc" }, { fileId: "def" }] };

describe("pickImagePeekFileId", () => {
  it("開き手があり、素材として索引にある画像なら fileId を返す", () => {
    expect(
      pickImagePeekFileId({ url: "local-media://abc", registered: true, extractFileId, mediaIndex: index }),
    ).toBe("abc");
  });

  it("外部 URL の画像（fileId が取れない）は null", () => {
    expect(
      pickImagePeekFileId({ url: "https://example.com/a.png", registered: true, extractFileId, mediaIndex: index }),
    ).toBeNull();
  });

  it("索引にその fileId が無いときは null（押して何も起きない入口を作らない）", () => {
    expect(
      pickImagePeekFileId({ url: "local-media://zzz", registered: true, extractFileId, mediaIndex: index }),
    ).toBeNull();
  });

  it("索引がまだ読み込まれていない（null / undefined）ときは null", () => {
    expect(
      pickImagePeekFileId({ url: "local-media://abc", registered: true, extractFileId, mediaIndex: null }),
    ).toBeNull();
    expect(
      pickImagePeekFileId({ url: "local-media://abc", registered: true, extractFileId, mediaIndex: undefined }),
    ).toBeNull();
  });

  it("開き手の無いエディタ（サイドピーク内・共有閲覧など）は null", () => {
    expect(
      pickImagePeekFileId({ url: "local-media://abc", registered: false, extractFileId, mediaIndex: index }),
    ).toBeNull();
  });

  it("url が空・文字列でない（アップロード前）は null", () => {
    for (const url of ["", undefined, null, 42]) {
      expect(pickImagePeekFileId({ url, registered: true, extractFileId, mediaIndex: index })).toBeNull();
    }
  });

  it("extractFileId が投げても（プロバイダ未初期化）null で落ちない", () => {
    const boom = () => {
      throw new Error("no provider");
    };
    expect(
      pickImagePeekFileId({ url: "local-media://abc", registered: true, extractFileId: boom, mediaIndex: index }),
    ).toBeNull();
  });
});

describe("画像ピークの登録口", () => {
  it("登録したエディタでは開き手が呼ばれ true を返す", () => {
    const editor = {};
    const cb = vi.fn(() => true);
    setImagePeekCallback(editor, cb);
    expect(hasImagePeek(editor)).toBe(true);
    expect(openImagePeek(editor, "abc")).toBe(true);
    expect(cb).toHaveBeenCalledWith("abc");
  });

  it("開き手が開けなかった（false を返した）ときは false を伝える", () => {
    const editor = {};
    setImagePeekCallback(editor, vi.fn(() => false));
    expect(openImagePeek(editor, "abc")).toBe(false);
  });

  it("未登録のエディタでは false を返し何も起きない", () => {
    const editor = {};
    expect(hasImagePeek(editor)).toBe(false);
    expect(openImagePeek(editor, "abc")).toBe(false);
  });

  it("登録はエディタごと（別のエディタには効かない）", () => {
    const a = {};
    const b = {};
    const cb = vi.fn();
    setImagePeekCallback(a, cb);
    expect(openImagePeek(b, "abc")).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("null で解除できる", () => {
    const editor = {};
    const cb = vi.fn();
    setImagePeekCallback(editor, cb);
    setImagePeekCallback(editor, null);
    expect(hasImagePeek(editor)).toBe(false);
    expect(openImagePeek(editor, "abc")).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("editor / fileId が空なら false（落ちない）", () => {
    expect(openImagePeek(null, "abc")).toBe(false);
    const editor = {};
    setImagePeekCallback(editor, vi.fn());
    expect(openImagePeek(editor, "")).toBe(false);
    setImagePeekCallback(null, vi.fn());
    expect(hasImagePeek(null)).toBe(false);
  });
});

// DOM の代役: closest(selector) を selectors に列挙したものだけ返す
function fakeEl(tagName: string, closestMap: Record<string, any>) {
  return {
    tagName,
    closest: (sel: string) => closestMap[sel] ?? null,
  };
}
const container = (id: string) => ({ getAttribute: (n: string) => (n === "data-id" ? id : null) });
const BLOCK = '[data-node-type="blockContainer"]';

describe("handleImageDblclick", () => {
  const setup = (block: any) => {
    const editor: any = { getBlock: vi.fn(() => block) };
    const open = vi.fn(() => true);
    setImagePeekCallback(editor, open);
    return { editor, open };
  };
  const ev = (target: any) => ({ target, preventDefault: vi.fn() });

  it("画像ブロックの IMG なら開いて preventDefault し true", () => {
    const { editor, open } = setup({ type: "image", props: { url: "local-media://abc" } });
    const e = ev(fakeEl("IMG", { [BLOCK]: container("b1") }));
    expect(handleImageDblclick(e, editor)).toBe(true);
    expect(open).toHaveBeenCalledWith("abc");
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("IMG でない要素（プレースホルダ・キャプション・ハンドル）は何もしない", () => {
    const { editor, open } = setup({ type: "image", props: { url: "local-media://abc" } });
    const e = ev(fakeEl("DIV", { [BLOCK]: container("b1") }));
    expect(handleImageDblclick(e, editor)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("表のセル内の画像（inline-image）は除外", () => {
    const { editor, open } = setup({ type: "image", props: { url: "local-media://abc" } });
    const e = ev(fakeEl("IMG", { '[data-test="inline-image"]': {}, [BLOCK]: container("b1") }));
    expect(handleImageDblclick(e, editor)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("リサイズハンドルの中は除外", () => {
    const { editor, open } = setup({ type: "image", props: { url: "local-media://abc" } });
    const e = ev(fakeEl("IMG", { ".bn-resize-handle": {}, [BLOCK]: container("b1") }));
    expect(handleImageDblclick(e, editor)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("画像ブロックでない（動画など）・ブロックが引けないときは何もしない", () => {
    const a = setup({ type: "video", props: { url: "local-media://abc" } });
    expect(handleImageDblclick(ev(fakeEl("IMG", { [BLOCK]: container("b1") })), a.editor)).toBe(false);
    expect(a.open).not.toHaveBeenCalled();
    const b = setup(null);
    expect(handleImageDblclick(ev(fakeEl("IMG", {})), b.editor)).toBe(false);
    expect(b.open).not.toHaveBeenCalled();
  });

  it("外部 URL・索引に無い画像は既定の動作を残す（false・preventDefault なし）", () => {
    const ext = setup({ type: "image", props: { url: "https://example.com/a.png" } });
    const e1 = ev(fakeEl("IMG", { [BLOCK]: container("b1") }));
    expect(handleImageDblclick(e1, ext.editor)).toBe(false);
    expect(e1.preventDefault).not.toHaveBeenCalled();
    const miss = setup({ type: "image", props: { url: "local-media://zzz" } });
    expect(handleImageDblclick(ev(fakeEl("IMG", { [BLOCK]: container("b1") })), miss.editor)).toBe(false);
    expect(miss.open).not.toHaveBeenCalled();
  });

  it("開き手が開けなかったときは preventDefault せず false", () => {
    const editor: any = { getBlock: () => ({ type: "image", props: { url: "local-media://abc" } }) };
    setImagePeekCallback(editor, () => false);
    const e = ev(fakeEl("IMG", { [BLOCK]: container("b1") }));
    expect(handleImageDblclick(e, editor)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("開き手の無いエディタ（ピーク内・共有閲覧）では何もしない", () => {
    const editor: any = { getBlock: () => ({ type: "image", props: { url: "local-media://abc" } }) };
    expect(handleImageDblclick(ev(fakeEl("IMG", { [BLOCK]: container("b1") })), editor)).toBe(false);
  });
});
