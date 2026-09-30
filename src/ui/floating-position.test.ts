import { describe, expect, it } from "vitest";
import { placeFloating } from "./floating-position";

const vp = { width: 1000, height: 600 };
const rect = (top: number, left: number, w = 80, h = 30) => ({
  top,
  left,
  bottom: top + h,
  right: left + w,
});

describe("placeFloating", () => {
  it("収まるなら好みの側にそのまま置く", () => {
    const r = placeFloating({ anchor: rect(100, 100), size: { width: 200, height: 150 }, viewport: vp });
    expect(r).toMatchObject({ top: 134, left: 100, placement: "bottom-start" });
  });

  it("下端で収まらず上が広ければ上へ反転する", () => {
    const r = placeFloating({ anchor: rect(520, 100), size: { width: 200, height: 250 }, viewport: vp });
    expect(r.placement).toBe("top-start");
    expect(r.top).toBe(520 - 4 - 250);
  });

  it("右端では画面の内側へ押し戻す", () => {
    const r = placeFloating({ anchor: rect(100, 950, 40), size: { width: 200, height: 100 }, viewport: vp });
    expect(r.left).toBe(1000 - 200 - 8);
  });

  it("bottom-end は右端を起点の右に揃える", () => {
    const r = placeFloating({ anchor: rect(100, 500), size: { width: 200, height: 100 }, viewport: vp, placement: "bottom-end" });
    expect(r.left).toBe(580 - 200);
  });

  it("両側に収まらないときは広い側で maxHeight を縮める", () => {
    const r = placeFloating({ anchor: rect(200, 100), size: { width: 200, height: 900 }, viewport: vp });
    // 下の空き 600-230-4-8=358 ／ 上の空き 200-4-8=188
    expect(r.placement).toBe("bottom-start");
    expect(r.maxHeight).toBe(358);
    expect(r.top).toBe(234);
  });

  it("上に置くとき縮めた高さぶん起点に寄せる", () => {
    const r = placeFloating({ anchor: rect(400, 100), size: { width: 200, height: 900 }, viewport: vp });
    expect(r.placement).toBe("top-start");
    expect(r.maxHeight).toBe(388);
    expect(r.top).toBe(400 - 4 - 388);
  });

  it("右へ出す子メニューは右端で左へ反転する", () => {
    const r = placeFloating({ anchor: rect(100, 800, 150), size: { width: 200, height: 100 }, viewport: vp, placement: "right-start" });
    expect(r.placement).toBe("left-start");
    expect(r.left).toBe(800 - 4 - 200);
    expect(r.top).toBe(100);
  });

  it("子メニューは下端で上へ押し戻す", () => {
    const r = placeFloating({ anchor: rect(560, 100), size: { width: 200, height: 100 }, viewport: vp, placement: "right-start" });
    expect(r.placement).toBe("right-start");
    expect(r.top).toBe(600 - 100 - 8);
  });

  it("画面より大きい小窓は余白の位置に寄せる", () => {
    const r = placeFloating({ anchor: rect(100, 300), size: { width: 1200, height: 900 }, viewport: vp });
    expect(r.left).toBe(8);
  });

  it("幅 0 の点（右クリック）でも下端・右端を避ける", () => {
    const p = { top: 590, left: 995, bottom: 590, right: 995 };
    const r = placeFloating({ anchor: p, size: { width: 180, height: 120 }, viewport: vp, gap: 0 });
    expect(r.placement).toBe("top-start");
    expect(r.top).toBe(590 - 120);
    expect(r.left).toBe(1000 - 180 - 8);
  });
});
