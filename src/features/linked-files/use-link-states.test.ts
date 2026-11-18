// @vitest-environment jsdom
// リンクした素材の状態を、一覧の分まとめて 1 回で取るフック。
// - 対象が複数でも statLinks は 1 回。リンクでない素材は渡さない
// - ウィンドウにフォーカスが戻ったら引き直す
// - デスクトップ版でなければ呼ばない

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import type { MediaIndexEntry } from "../asset-browser/media-index";

const h = vi.hoisted(() => ({ isTauri: vi.fn(() => true), statLinks: vi.fn() }));
vi.mock("../../lib/platform", async (orig) => ({
  ...(await orig<typeof import("../../lib/platform")>()),
  isTauri: () => h.isTauri(),
}));
vi.mock("./places", () => ({ statLinks: (items: unknown) => h.statLinks(items) }));
const isTauriMock = h.isTauri;
const statLinksMock = h.statLinks;

import { useLinkStates } from "./use-link-states";
import { buildPlaceUrl } from "./link-url";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function linked(fileId: string, relPath: string, size = 10, mtimeMs = 1000): MediaIndexEntry {
  return {
    fileId,
    name: relPath,
    type: "url",
    mimeType: "text/x-uri",
    url: buildPlaceUrl("p1", relPath),
    thumbnailUrl: "",
    uploadedAt: "2026-11-18T00:00:00.000Z",
    usedIn: [],
    link: { placeId: "p1", relPath, size, mtimeMs, recordedAt: "2026-11-18T00:00:00.000Z" },
  };
}
const web: MediaIndexEntry = {
  fileId: "w1",
  name: "web",
  type: "url",
  mimeType: "text/html",
  url: "https://example.com/",
  thumbnailUrl: "",
  uploadedAt: "2026-11-18T00:00:00.000Z",
  usedIn: [],
};

afterEach(() => cleanup());

beforeEach(() => {
  isTauriMock.mockReturnValue(true);
  statLinksMock.mockReset();
});

describe("useLinkStates", () => {
  it("リンクした素材だけを statLinks 1 回でまとめて見て、fileId ごとの状態を返す", async () => {
    statLinksMock.mockResolvedValue([
      { state: "ok", size: 10, mtimeMs: 1000 },
      { state: "ok", size: 99, mtimeMs: 1000 },
    ]);
    const entries = [linked("a", "a.xlsx"), web, linked("b", "b.docx")];
    const { result } = renderHook(() => useLinkStates(entries));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(statLinksMock).toHaveBeenCalledTimes(1);
    expect(statLinksMock.mock.calls[0][0]).toEqual([
      { placeId: "p1", relPath: "a.xlsx" },
      { placeId: "p1", relPath: "b.docx" },
    ]);
    expect(result.current.get("a")).toBe("ok");
    expect(result.current.get("b")).toBe("changed");
    expect(result.current.has("w1")).toBe(false);
  });

  it("ウィンドウにフォーカスが戻ったら引き直す", async () => {
    statLinksMock.mockResolvedValue([{ state: "ok", size: 10, mtimeMs: 1000 }]);
    const entries = [linked("a", "a.xlsx")];
    const { result } = renderHook(() => useLinkStates(entries));
    await waitFor(() => expect(result.current.get("a")).toBe("ok"));
    statLinksMock.mockResolvedValue([{ state: "missing" }]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.get("a")).toBe("missing"));
    expect(statLinksMock).toHaveBeenCalledTimes(2);
  });

  it("デスクトップ版でなければ呼ばない", async () => {
    isTauriMock.mockReturnValue(false);
    const entries = [linked("a", "a.xlsx")];
    const { result } = renderHook(() => useLinkStates(entries));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(statLinksMock).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("リンクした素材が無ければ呼ばない", () => {
    renderHook(() => useLinkStates([web]));
    expect(statLinksMock).not.toHaveBeenCalled();
  });

  it("細工した控えのエントリが混ざっても、正しいエントリだけで statLinks を呼ぶ", async () => {
    statLinksMock.mockResolvedValue([{ state: "ok", size: 10, mtimeMs: 1000 }]);
    const bad1 = { ...linked("x", "x.txt"), link: {} } as unknown as MediaIndexEntry;
    const bad2 = { ...linked("y", "y.txt"), link: { placeId: "p1", relPath: 5, size: 1, mtimeMs: 1, recordedAt: "" } } as unknown as MediaIndexEntry;
    const bad3 = { ...linked("z", "z.txt"), url: buildPlaceUrl("p1", "other.txt") };
    const entries = [bad1, linked("a", "a.xlsx"), bad2, bad3];
    const { result } = renderHook(() => useLinkStates(entries));
    await waitFor(() => expect(result.current.get("a")).toBe("ok"));
    expect(statLinksMock).toHaveBeenCalledTimes(1);
    expect(statLinksMock.mock.calls[0][0]).toEqual([{ placeId: "p1", relPath: "a.xlsx" }]);
  });

  it("進行中に 3 回フォーカスが戻っても、呼び出しは進行中の 1 回と終わったあとの 1 回だけ", async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    statLinksMock.mockImplementation(() => new Promise((res) => resolvers.push(res)));
    const entries = [linked("a", "a.xlsx")];
    const { result } = renderHook(() => useLinkStates(entries));
    expect(statLinksMock).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(statLinksMock).toHaveBeenCalledTimes(1);
    await act(async () => resolvers[0]([{ state: "ok", size: 10, mtimeMs: 1000 }]));
    await waitFor(() => expect(statLinksMock).toHaveBeenCalledTimes(2));
    await act(async () => resolvers[1]([{ state: "missing" }]));
    await waitFor(() => expect(result.current.get("a")).toBe("missing"));
    expect(statLinksMock).toHaveBeenCalledTimes(2);
  });

  it("アンマウント後に結果が届いても状態を更新せず、呼び直しもしない", async () => {
    let resolve: (v: unknown) => void = () => {};
    statLinksMock.mockImplementation(() => new Promise((res) => (resolve = res)));
    const { unmount } = renderHook(() => useLinkStates([linked("a", "a.xlsx")]));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    unmount();
    await act(async () => resolve([{ state: "ok", size: 10, mtimeMs: 1000 }]));
    expect(statLinksMock).toHaveBeenCalledTimes(1);
  });
});
