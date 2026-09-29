// 画像ブロック → 素材のサイドピーク入口（image-peek）のテスト。
//
// - 出す条件の純関数 pickImagePeekFileId: 正常 / 外部 URL / 索引に無い / 索引が null /
//   開き手なし / url なし / extractFileId が投げる
// - 登録口 setImagePeekCallback / openImagePeek / hasImagePeek: 登録・未登録・解除・エディタ別

import { describe, it, expect, vi } from "vitest";
import {
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
    const cb = vi.fn();
    setImagePeekCallback(editor, cb);
    expect(hasImagePeek(editor)).toBe(true);
    expect(openImagePeek(editor, "abc")).toBe(true);
    expect(cb).toHaveBeenCalledWith("abc");
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
