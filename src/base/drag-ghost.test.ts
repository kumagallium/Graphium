// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDragGhost, primeDragGhost } from "./drag-ghost";

function ghost(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>('img[data-drag-ghost="true"]');
}

/** jsdom は画像を読み込まないので、読み込み済みの状態を作る */
function markLoaded(img: HTMLImageElement, loaded: boolean) {
  Object.defineProperty(img, "complete", { configurable: true, get: () => loaded });
  Object.defineProperty(img, "naturalWidth", { configurable: true, get: () => (loaded ? 800 : 0) });
}

function fakeDataTransfer() {
  return { setDragImage: vi.fn() } as unknown as DataTransfer & { setDragImage: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  const g = ghost();
  if (g) {
    markLoaded(g, false);
    g.removeAttribute("src");
  }
});

describe("drag-ghost", () => {
  it("分身は表示範囲の中（左上）に置き、見えないようにする", () => {
    primeDragGhost("blob:http://localhost/a");
    const g = ghost();
    expect(g).not.toBeNull();
    // WebKit は表示範囲外の要素からドラッグ画像を作れない
    expect(g!.style.top).toBe("0px");
    expect(g!.style.left).toBe("0px");
    expect(g!.style.position).toBe("fixed");
    // opacity 0 だとドラッグ画像まで消える
    expect(Number(g!.style.opacity)).toBeGreaterThan(0);
    expect(Number(g!.style.opacity)).toBeLessThan(0.01);
    expect(g!.style.pointerEvents).toBe("none");
  });

  it("何度呼んでも分身は 1 個だけ（dragstart 中に DOM を増やさない）", () => {
    primeDragGhost("blob:http://localhost/a");
    primeDragGhost("blob:http://localhost/b");
    expect(document.querySelectorAll('img[data-drag-ghost="true"]').length).toBe(1);
  });

  it("読み込み済みの分身だけをドラッグ画像にする", () => {
    primeDragGhost("blob:http://localhost/a");
    markLoaded(ghost()!, true);
    const dt = fakeDataTransfer();
    expect(applyDragGhost(dt, "blob:http://localhost/a")).toBe(true);
    expect(dt.setDragImage).toHaveBeenCalledWith(ghost(), 24, 24);
  });

  it("読み込みが間に合っていなければ差し替えない（既定のゴーストで続ける）", () => {
    primeDragGhost("blob:http://localhost/a");
    markLoaded(ghost()!, false);
    const dt = fakeDataTransfer();
    expect(applyDragGhost(dt, "blob:http://localhost/a")).toBe(false);
    expect(dt.setDragImage).not.toHaveBeenCalled();
  });

  it("掴んだ画像と分身の画像が違えば差し替えない", () => {
    primeDragGhost("blob:http://localhost/a");
    markLoaded(ghost()!, true);
    const dt = fakeDataTransfer();
    expect(applyDragGhost(dt, "blob:http://localhost/other")).toBe(false);
    expect(dt.setDragImage).not.toHaveBeenCalled();
  });

  it("dragstart では src を差し替えない（先回りの読み込みを前提にする）", () => {
    primeDragGhost("blob:http://localhost/a");
    const before = ghost()!.src;
    applyDragGhost(fakeDataTransfer(), "blob:http://localhost/b");
    expect(ghost()!.src).toBe(before);
  });
});
