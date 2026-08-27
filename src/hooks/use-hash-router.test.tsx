// @vitest-environment jsdom
// use-hash-router のテスト
// 「戻る」が直感どおりに効くための不変条件を守る:
//   1. 画面が変わる遷移は必ず 1 段だけ履歴を積む
//   2. 同じ場所への再遷移は積まない（戻っても画面が変わらない空振り段を作らない）
//   3. popstate で着地したエントリの深さから canGoBack を復元する
// 実際の history.back() は jsdom では非同期なので、pushState / replaceState の
// 呼び分けを spy で観測し、popstate は手で発火させて検証する。

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHashRouter, type RouteActions } from "./use-hash-router";

// React 18 の act() 警告を抑止（テストランナーが act 環境であることを明示）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function noopActions(): RouteActions {
  return {
    openFile: vi.fn(),
    openWikiFile: vi.fn(),
    setShowNoteList: vi.fn(),
    setActiveWikiKind: vi.fn(),
    setActiveWikiView: vi.fn(),
    setActiveAssetType: vi.fn(),
    setActiveLabel: vi.fn(),
    setShowMemos: vi.fn(),
    setShowMobile: vi.fn(),
    setShowSharedLibrary: vi.fn(),
    clearViews: vi.fn(),
    setPeek: vi.fn(),
  };
}

/** navigate 直後の 1 フレームは自前の pushState を popstate と誤認しないよう抑止されている。
 *  ユーザーの「戻る」相当を発火させる前に、その解除を待つ。 */
async function flushNavigate() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

let pushSpy: ReturnType<typeof vi.spyOn>;
let replaceSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.location.hash = "";
  // 実装と同じく URL も動かす（同一 URL 判定が location.hash を見るため）
  pushSpy = vi.spyOn(window.history, "pushState");
  replaceSpy = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useHashRouter の履歴", () => {
  it("別のノートへ移るたびに 1 段ずつ積み、戻れる状態になる", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));
    expect(result.current.canGoBack).toBe(false);

    act(() => result.current.navigate({ view: "editor", fileId: "a" }));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(result.current.canGoBack).toBe(true);

    act(() => result.current.navigate({ view: "editor", fileId: "b" }));
    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe("#note/b");
  });

  it("同じノートを開き直しても履歴を積まない", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    act(() => result.current.navigate({ view: "editor", fileId: "a" }));
    pushSpy.mockClear();

    act(() => result.current.navigate({ view: "editor", fileId: "a" }));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();
  });

  // home はハッシュが空文字なので、同一 URL 判定から漏れて積み放題になっていた。
  // 一覧を閉じるたびに空振りの履歴段が増え、「戻っても画面が変わらない」原因になる。
  it("home に居るときに home へ遷移しても履歴を積まない", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    act(() => result.current.navigate({ view: "home" }));
    expect(pushSpy).not.toHaveBeenCalled();

    act(() => result.current.navigate({ view: "home" }));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(result.current.canGoBack).toBe(false);
  });

  it("ノートから home へ戻る遷移は 1 段だけ積む", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    act(() => result.current.navigate({ view: "editor", fileId: "a" }));
    pushSpy.mockClear();

    act(() => result.current.navigate({ view: "home" }));
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // 連続で home を押しても増えない
    act(() => result.current.navigate({ view: "home" }));
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it("popstate で着地した深さから canGoBack を復元する", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    act(() => result.current.navigate({ view: "editor", fileId: "a" }));
    act(() => result.current.navigate({ view: "editor", fileId: "b" }));
    expect(result.current.canGoBack).toBe(true);

    // 最初のエントリ（seq 0）に着地 = もう戻る先が無い
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 0 } }));
    });
    expect(result.current.canGoBack).toBe(false);
  });
});

describe("useHashRouter のハッシュ解決", () => {
  it("Knowledge ノートを #note/wiki:<id> として往復できる", async () => {
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));

    act(() => result.current.navigate({ view: "editor", fileId: "wiki:k1" }));
    expect(window.location.hash).toBe("#note/wiki:k1");
    expect(result.current.parseHash()).toEqual({ view: "editor", fileId: "wiki:k1" });

    await flushNavigate();
    // popstate 経由の復元では wiki: を剥がして Knowledge ノートとして開く
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 1 } }));
    });
    expect(actions.openWikiFile).toHaveBeenCalledWith("k1");
  });

  it("旧 #wiki/ ルートも Knowledge として解決する", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));
    window.location.hash = "#wiki/claim/k9";
    expect(result.current.parseHash()).toEqual({ view: "wiki-editor", kind: "claim", wikiId: "k9" });
  });
});

describe("サイドピークの履歴", () => {
  it("ピークを開くと 1 段積み、切り替えでもう 1 段積む", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    act(() => result.current.navigate({ view: "editor", fileId: "a" }));
    pushSpy.mockClear();

    act(() => result.current.navigate({ view: "editor", fileId: "a", peek: "p1" }));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#note/a?peek=p1");

    act(() => result.current.navigate({ view: "editor", fileId: "a", peek: "p2" }));
    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe("#note/a?peek=p2");
  });

  it("同じピークを開き直しても積まない", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    act(() => result.current.navigate({ view: "editor", fileId: "a", peek: "p1" }));
    pushSpy.mockClear();

    act(() => result.current.navigate({ view: "editor", fileId: "a", peek: "p1" }));
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("ピークを閉じる遷移も 1 段積む（戻れば開いていた状態に帰る）", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    act(() => result.current.navigate({ view: "editor", fileId: "a", peek: "p1" }));
    pushSpy.mockClear();

    act(() => result.current.navigate({ view: "editor", fileId: "a" }));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#note/a");
  });

  it("ピーク付き URL を往復でき、popstate でビューの後にピークが当たる", async () => {
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));

    act(() => result.current.navigate({ view: "editor", fileId: "a", peek: "wiki:k1" }));
    expect(result.current.parseHash()).toEqual({ view: "editor", fileId: "a", peek: "wiki:k1" });

    await flushNavigate();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 1 } }));
    });
    // ピークはビューを立て終えたあとに当てる（先に当てると畳まれて消える）
    expect(actions.clearViews).toHaveBeenCalled();
    expect(actions.setPeek).toHaveBeenLastCalledWith("wiki:k1", "editor");
  });

  it("ピークの無いルートでは setPeek に null が渡る", async () => {
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));

    act(() => result.current.navigate({ view: "notes" }));
    await flushNavigate();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 1 } }));
    });
    expect(actions.setPeek).toHaveBeenLastCalledWith(null, "notes");
  });

  it("一覧やギャラリーの上でもピークを表現できる", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    act(() => result.current.navigate({ view: "notes", peek: "n1" }));
    expect(window.location.hash).toBe("#notes?peek=n1");
    expect(result.current.parseHash()).toEqual({ view: "notes", peek: "n1" });
  });
});
