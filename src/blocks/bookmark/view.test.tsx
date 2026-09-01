// @vitest-environment jsdom
// ブックマークカードの外部リクエストの回帰ガード
//
// このブロックは「ノートを開いた」だけで 2 つの外向きリクエストを出していた:
// メタデータ取得（url をパス・クエリごと GET）と favicon（<img> で
// https://<host>/favicon.ico）。受け取ったノートに 1 個入れておけば、開いた瞬間に
// 差出人へ IP と時刻が渡る —— 画像ブロックのゲートを入れても、ここが空いていれば
// 意味が無い。ここでは「同意するまで何も出ない」「同意したら出る」「props に
// メタデータがあるカードは何も出さずに描ける」の 3 点を実際に描いて確かめる。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { BookmarkCard } from "./view";
import { insertBookmarkBlockFromPaste } from "../../features/asset-browser/url-paste";
import {
  allowRemoteContentFor,
  blockedRemoteCount,
  resetRemoteContentGate,
  setEditorRemoteScope,
} from "../remote-content/store";
import { t } from "../../i18n";

// hero（ローカルキャッシュの data URL）はこのテストの対象外。素材インデックスを
// 読みに行かせないためにフックごと差し替える。url-paste.ts が使う
// ensureCachedPreviewImage も同じモジュールなので、ここでまとめて無効化する。
vi.mock("../../features/asset-browser/preview-image", () => ({
  useBookmarkPreviewImage: () => null,
  ensureCachedPreviewImage: vi.fn(async () => "skipped"),
}));

const REMOTE = "https://recipient-7f3a.tracker.example/read/abc123?u=me";
const HOST = "recipient-7f3a.tracker.example";

const fetchMock = vi.fn();

/** ブロック props の既定。テストごとに要る分だけ上書きする */
function bookmarkBlock(props: Partial<{
  url: string; title: string; description: string; domain: string;
}> = {}) {
  return {
    id: "bm-1",
    props: {
      url: REMOTE,
      title: "",
      description: "",
      domain: "",
      ...props,
    },
  };
}

/** scope を刻んだ最小のエディタ */
function makeEditor(scope: string) {
  const editor = { updateBlock: vi.fn() };
  setEditorRemoteScope(editor, scope);
  return editor;
}

/** fetchUrlMetadata の Promise がブロックへ書き戻されるまで進める */
async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
  fetchMock.mockReset();
  // 実運用でも大半の配信元は CORS で弾く。弾かれた側の分岐（ドメイン名だけ返す）
  // を通しつつ、「呼ばれたかどうか」を見る
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // globals: false の vitest では RTL の自動 cleanup が入らない。前のテストの
  // カードが残っていると、同意を出した瞬間にそれらもまとめて取得に行き、
  // 「何回取りに行ったか」の判定が狂う
  cleanup();
  vi.unstubAllGlobals();
  resetRemoteContentGate();
  localStorage.clear();
});

describe("BookmarkCard の外部リクエスト", () => {
  it("メタデータの無いカードは、開いただけでは何も取りに行かない", () => {
    const editor = makeEditor("n1");
    const { container } = render(<BookmarkCard block={bookmarkBlock()} editor={editor} />);

    // メタデータ取得も favicon も出ていない
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    // 画像・動画・音声と同じ枠が出て、バーの件数にも入る
    const placeholder = container.querySelector("[data-remote-content-blocked]");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain(t("block.remoteContent.why"));
    expect(placeholder?.textContent).toContain(t("block.remoteContent.action"));
    expect(blockedRemoteCount("n1")).toBe(1);
  });

  it("枠に出すのはホスト名だけで、パスとクエリは出さない", () => {
    const editor = makeEditor("n1");
    const { container } = render(<BookmarkCard block={bookmarkBlock()} editor={editor} />);
    const text = container.querySelector("[data-remote-content-blocked]")?.textContent ?? "";
    expect(text).toContain(HOST);
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("u=me");
  });

  it("props の domain が URL と食い違っていても、枠は URL のホストを出す", () => {
    // domain は差出人が書ける値なので、「どこへ取りに行くのか」の表示には使えない
    const editor = makeEditor("n1");
    const { container } = render(
      <BookmarkCard block={bookmarkBlock({ domain: "wikipedia.org" })} editor={editor} />,
    );
    const text = container.querySelector("[data-remote-content-blocked]")?.textContent ?? "";
    expect(text).toContain(HOST);
    expect(text).not.toContain("wikipedia.org");
  });

  it("同意すると取得に行き、その場でカードに切り替わる（再マウント無し）", async () => {
    const editor = makeEditor("n1");
    const { container } = render(<BookmarkCard block={bookmarkBlock()} editor={editor} />);
    expect(fetchMock).not.toHaveBeenCalled();

    // ノート上部のバー（や設定）からの同意。ブロックを作り直さずに解除される
    await act(async () => {
      allowRemoteContentFor("n1");
      await settle();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(REMOTE);
    expect(container.querySelector("[data-remote-content-blocked]")).toBeNull();
    // 取得結果はブロック props に書き戻す（次に開くときは取りに行かない）
    expect(editor.updateBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bm-1" }),
      { props: { title: HOST, description: "", ogImage: "", domain: HOST } },
    );
    // 同意後は favicon もサイト自身から取りに行く
    expect(container.querySelector("img")?.getAttribute("src"))
      .toBe(`https://${HOST}/favicon.ico`);
    expect(blockedRemoteCount("n1")).toBe(0);
  });

  it("メタデータが props にあるカードは、1 リクエストも出さずに描ける", () => {
    const editor = makeEditor("n1");
    const { container } = render(
      <BookmarkCard
        block={bookmarkBlock({ title: "記事タイトル", description: "説明文", domain: HOST })}
        editor={editor}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    // favicon はホスト名だけでも受信者を見分けられるので、同意前は描かない。
    // 見た目は Favicon が候補を出し尽くしたとき（null を返す）と同じ
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelector("[data-remote-content-blocked]")).toBeNull();
    // 本文は props から出る
    expect(container.textContent).toContain("記事タイトル");
    expect(container.textContent).toContain("説明文");
    expect(container.textContent).toContain(HOST);
    // 枠を出していないカードはバーの件数にも入れない（自分で貼ったブックマークの
    // あるノートでバーが出っぱなしになると、消したい人が「読み込む」を押して
    // そのノートの他の外部メディアまで許可してしまう）
    expect(blockedRemoteCount("n1")).toBe(0);
  });

  it("scope の無いエディタ（stories 等）でもブロック側に倒れる", () => {
    const editor = { updateBlock: vi.fn() };
    const { container } = render(<BookmarkCard block={bookmarkBlock()} editor={editor} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("[data-remote-content-blocked]")).not.toBeNull();
  });

  it("URL が空なら従来どおりの入力プレースホルダ", () => {
    const editor = makeEditor("n1");
    const { container } = render(
      <BookmarkCard block={bookmarkBlock({ url: "" })} editor={editor} />,
    );
    expect(container.textContent).toBe(t("block.bookmark.placeholder"));
    expect(blockedRemoteCount("n1")).toBe(0);
  });
});

describe("貼り付け経路", () => {
  it("insertBookmarkBlockFromPaste は従来どおりブロックを挿入する", () => {
    const source = { id: "p1", content: [{ text: REMOTE }], children: [] };
    const editor = {
      getBlock: () => source,
      insertBlocks: vi.fn(() => [{ id: "bm-new" }]),
      removeBlocks: vi.fn(),
    };
    const insertedId = insertBookmarkBlockFromPaste(editor, REMOTE, "p1");

    expect(insertedId).toBe("bm-new");
    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [{ type: "bookmark", props: { url: REMOTE, title: "", description: "", ogImage: "", domain: HOST } }],
      source,
      "after",
    );
    // 挿入そのものはネットワークに触らない（メタデータ取得は registerUrlAsset 側）
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
