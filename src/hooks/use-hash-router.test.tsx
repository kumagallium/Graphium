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
    setShowChatList: vi.fn(),
    openChatFull: vi.fn(),
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
  // state も空に戻す（前のテストが積んだ連番が残ると、マウント時の復元で canGoBack が立つ）
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
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

// ページの読み直し（reload・アプリの再起動・HMR の full reload）では useRef が 0 に戻る一方、
// history.state は残る。連番を復元しないと戻り先があるのに戻るボタンだけ押せなくなる。
describe("useHashRouter の読み直し後の復元", () => {
  it("history.state に連番があればマウント時から canGoBack が true", () => {
    window.history.replaceState({ __seq: 2 }, "", "#assets/image");
    const { result } = renderHook(() => useHashRouter(noopActions(), true));
    expect(result.current.canGoBack).toBe(true);
  });

  it("連番が無い・0・数値でない state は戻れない扱い", () => {
    for (const state of [null, {}, { __seq: 0 }, { __seq: "3" }]) {
      window.history.replaceState(state, "", "#notes");
      const { result, unmount } = renderHook(() => useHashRouter(noopActions(), true));
      expect(result.current.canGoBack).toBe(false);
      unmount();
    }
  });

  it("復元した連番の続きから積む（同じ場所への再遷移は連番を保つ）", () => {
    window.history.replaceState({ __seq: 2 }, "", "#notes");
    const { result } = renderHook(() => useHashRouter(noopActions(), true));

    // 同じ URL は積まず、連番を保ったまま replace する
    act(() => result.current.navigate({ view: "notes" }));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenLastCalledWith({ __seq: 2 }, "", "#notes");

    // 別の場所へは 3 段目として積む
    act(() => result.current.navigate({ view: "editor", fileId: "a" }));
    expect(pushSpy).toHaveBeenLastCalledWith({ __seq: 3 }, "", "#note/a");
  });

  it("復元後の back() は履歴を 1 段戻す", () => {
    window.history.replaceState({ __seq: 1 }, "", "#assets/image");
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result } = renderHook(() => useHashRouter(noopActions(), true));
    act(() => result.current.back());
    expect(backSpy).toHaveBeenCalledTimes(1);
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

  it("共有エントリの全画面を #shared-entry/<id> として往復できる", async () => {
    const actions = { ...noopActions(), openSharedEntryView: vi.fn() };
    const { result } = renderHook(() => useHashRouter(actions, true));

    act(() => result.current.navigate({ view: "shared-entry", id: "e-1" }));
    expect(window.location.hash).toBe("#shared-entry/e-1");
    expect(result.current.parseHash()).toEqual({ view: "shared-entry", id: "e-1" });

    await flushNavigate();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 1 } }));
    });
    expect(actions.clearViews).toHaveBeenCalled();
    expect(actions.openSharedEntryView).toHaveBeenCalledWith("e-1");
  });

  // 引用カードの #shared/<id> は router に登録しない口。全画面のパスと混ざらないこと
  it("#shared/<id> は shared-entry として解決しない", () => {
    const { result } = renderHook(() => useHashRouter(noopActions(), true));
    window.location.hash = "#shared/e-1";
    expect(result.current.parseHash()).toEqual({ view: "home" });
  });

  // 全画面のハンドラを持たない環境（デスクトップ以外など）で空画面にしない
  it("openSharedEntryView が無ければ Library にフォールバックする", async () => {
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));

    act(() => result.current.navigate({ view: "shared-entry", id: "e-1" }));
    await flushNavigate();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 1 } }));
    });
    expect(actions.setShowSharedLibrary).toHaveBeenCalledWith(true);
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

describe("ノートに紐づかないチャットのルート", () => {
  it("一覧を #chats として往復できる", async () => {
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));

    act(() => result.current.navigate({ view: "chats" }));
    expect(window.location.hash).toBe("#chats");
    expect(result.current.parseHash()).toEqual({ view: "chats" });

    await flushNavigate();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 1 } }));
    });
    expect(actions.setShowChatList).toHaveBeenCalledWith(true);
    expect(actions.setPeek).toHaveBeenLastCalledWith(null, "chats");
  });

  it("個別の会話を #chats/<id> として全画面で往復できる", async () => {
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));

    act(() => result.current.navigate({ view: "chat", chatId: "c1" }));
    expect(window.location.hash).toBe("#chats/c1");
    expect(result.current.parseHash()).toEqual({ view: "chat", chatId: "c1" });

    await flushNavigate();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 1 } }));
    });
    expect(actions.setShowChatList).toHaveBeenCalledWith(true);
    expect(actions.openChatFull).toHaveBeenCalledWith("c1");
  });

  it("一覧上のピーク会話を #chats?peek=<id> として往復できる", async () => {
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));

    act(() => result.current.navigate({ view: "chats", peek: "c1" }));
    expect(window.location.hash).toBe("#chats?peek=c1");
    expect(result.current.parseHash()).toEqual({ view: "chats", peek: "c1" });

    await flushNavigate();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __seq: 1 } }));
    });
    expect(actions.setShowChatList).toHaveBeenCalledWith(true);
    // ピークはビューを立て終えたあとに当てる（一覧の row peek と同じ順序）
    expect(actions.setPeek).toHaveBeenLastCalledWith("c1", "chats");
  });
});

describe("backBy / getSeq（入った時点まで履歴をまとめて戻す）", () => {
  it("getSeq は積んだ段数を返し、同じ URL の差し替えでは増えない", () => {
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));
    expect(result.current.getSeq()).toBe(0);
    act(() => result.current.navigate({ view: "assets", mediaType: "image" }));
    expect(result.current.getSeq()).toBe(1);
    act(() => result.current.navigate({ view: "assets", mediaType: "image" }));
    expect(result.current.getSeq()).toBe(1);
    act(() => result.current.navigate({ view: "assets", mediaType: "image", peek: "n1" }));
    expect(result.current.getSeq()).toBe(2);
  });

  it("backBy(n) は history.go(-n) を 1 回だけ呼ぶ", () => {
    const goSpy = vi.spyOn(window.history, "go").mockImplementation(() => {});
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));
    act(() => result.current.navigate({ view: "assets", mediaType: "image" }));
    act(() => result.current.navigate({ view: "assets", mediaType: "image", peek: "n1" }));
    act(() => result.current.navigate({ view: "assets", mediaType: "image", peek: "n2" }));
    act(() => result.current.backBy(3));
    expect(goSpy).toHaveBeenCalledOnce();
    expect(goSpy).toHaveBeenCalledWith(-3);
  });

  it("履歴の深さを超えては戻らず、0 以下・非数は何もしない", () => {
    const goSpy = vi.spyOn(window.history, "go").mockImplementation(() => {});
    const actions = noopActions();
    const { result } = renderHook(() => useHashRouter(actions, true));
    act(() => result.current.backBy(2)); // 深さ 0
    expect(goSpy).not.toHaveBeenCalled();
    act(() => result.current.navigate({ view: "assets", mediaType: "image" }));
    act(() => result.current.backBy(5));
    expect(goSpy).toHaveBeenLastCalledWith(-1);
    goSpy.mockClear();
    act(() => result.current.backBy(0));
    act(() => result.current.backBy(Number.NaN));
    expect(goSpy).not.toHaveBeenCalled();
  });
});
