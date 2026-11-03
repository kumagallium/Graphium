// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { LocaleProvider } from "../../i18n";

// 縮小は jsdom で動かないので、終わるタイミングをテストから決められるようにする
const pending: Array<(v: unknown) => void> = [];
vi.mock("./encode", async (orig) => {
  const actual = await orig<typeof import("./encode")>();
  return {
    ...actual,
    encodeChatImage: () => new Promise((resolve) => pending.push(resolve)),
  };
});

const { useChatImageInput } = await import("./use-chat-image-input");
const { MAX_IMAGES_PER_MESSAGE } = await import("./encode");

const wrapper = ({ children }: { children: ReactNode }) => createElement(LocaleProvider, null, children);
const file = (n: number) => new File([new Uint8Array([n])], `photo-${n}.png`, { type: "image/png" });
const done = () => ({ dataUrl: "data:image/jpeg;base64,AAAA", mimeType: "image/jpeg", width: 1, height: 1 });

async function finishNext() {
  await act(async () => {
    pending.shift()?.(done());
    await Promise.resolve();
  });
}

describe("useChatImageInput", () => {
  beforeEach(() => {
    pending.length = 0;
  });

  it("縮小中は busy で、終わると並ぶ", async () => {
    const { result } = renderHook(() => useChatImageInput(), { wrapper });
    act(() => void result.current.addFiles([file(1)]));
    expect(result.current.busy).toBe(true);
    await finishNext();
    expect(result.current.busy).toBe(false);
    expect(result.current.images).toHaveLength(1);
  });

  it("縮小中に 1 枚目を外しても、上限の数え方がずれない", async () => {
    const { result } = renderHook(() => useChatImageInput(), { wrapper });
    act(() => void result.current.addFiles([file(1), file(2)]));
    await finishNext(); // 1 枚目が並び、2 枚目が縮小中
    act(() => result.current.remove(result.current.images[0].id));
    await finishNext();
    expect(result.current.images).toHaveLength(1);
    // あと 3 枚まで（合計 4 枚）。5 枚目はエラーになる
    act(() => void result.current.addFiles([file(3), file(4), file(5), file(6)]));
    for (let i = 0; i < 3; i++) await finishNext();
    expect(result.current.images).toHaveLength(MAX_IMAGES_PER_MESSAGE);
    expect(result.current.error).toBeTruthy();
  });

  it("空にした後に終わった縮小は並べない", async () => {
    const { result } = renderHook(() => useChatImageInput(), { wrapper });
    act(() => void result.current.addFiles([file(1)]));
    act(() => result.current.clear());
    await finishNext();
    expect(result.current.images).toHaveLength(0);
    expect(result.current.busy).toBe(false);
  });
});
