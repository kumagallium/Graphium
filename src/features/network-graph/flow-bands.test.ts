import { describe, expect, it } from "vitest";
import { BAND_PADDING, fitBandsToMembers, toAbsoluteLayout } from "./flow-bands";

type N = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  style?: { width?: number; height?: number };
  band?: string;
};

const bandOf = (n: N) => n.band ?? null;

describe("fitBandsToMembers", () => {
  it("帯を中の工程の外接矩形 + 余白に合わせる", () => {
    const nodes: N[] = [
      { id: "group:t1", type: "band", position: { x: 0, y: 0 }, style: { width: 240, height: 120 } },
      { id: "a", type: "step", position: { x: 100, y: 200 }, measured: { width: 150, height: 50 }, band: "group:t1" },
      { id: "b", type: "step", position: { x: 400, y: 260 }, measured: { width: 120, height: 40 }, band: "group:t1" },
    ];
    const out = fitBandsToMembers(nodes, bandOf);
    const band = out[0];
    expect(band.position).toEqual({ x: 100 - BAND_PADDING.left, y: 200 - BAND_PADDING.top });
    expect(band.style).toEqual({
      width: 520 - 100 + BAND_PADDING.left + BAND_PADDING.right,
      height: 300 - 200 + BAND_PADDING.top + BAND_PADDING.bottom,
    });
    // 工程ノードは動かさない
    expect(out[1]).toBe(nodes[1]);
    expect(out[2]).toBe(nodes[2]);
  });

  it("どの帯も変わらなければ配列ごと同じ参照を返す（ドラッグ中の無駄な再描画を防ぐ）", () => {
    const nodes: N[] = [
      { id: "group:t1", type: "band", position: { x: 0, y: 0 }, style: { width: 240, height: 120 } },
      { id: "a", type: "step", position: { x: 50, y: 50 }, measured: { width: 100, height: 40 }, band: "group:t1" },
    ];
    const once = fitBandsToMembers(nodes, bandOf);
    expect(once).not.toBe(nodes);
    expect(fitBandsToMembers(once, bandOf)).toBe(once);
  });

  it("実測前のノードは仮の大きさで囲む", () => {
    const nodes: N[] = [
      { id: "group:t1", type: "band", position: { x: 0, y: 0 } },
      { id: "a", type: "step", position: { x: 0, y: 0 }, band: "group:t1" },
    ];
    const band = fitBandsToMembers(nodes, bandOf)[0];
    expect(band.style).toEqual({
      width: 180 + BAND_PADDING.left + BAND_PADDING.right,
      height: 48 + BAND_PADDING.top + BAND_PADDING.bottom,
    });
  });

  it("所属ノードの無い帯と、帯に属さないノードは触らない", () => {
    const nodes: N[] = [
      { id: "group:empty", type: "band", position: { x: 5, y: 5 }, style: { width: 10, height: 10 } },
      { id: "out", type: "entity", position: { x: 900, y: 900 } },
    ];
    expect(fitBandsToMembers(nodes, bandOf)).toBe(nodes);
  });

  it("帯ごとに別々に囲む", () => {
    const nodes: N[] = [
      { id: "group:t1", type: "band", position: { x: 0, y: 0 } },
      { id: "group:t2", type: "band", position: { x: 0, y: 0 } },
      { id: "a", type: "step", position: { x: 0, y: 0 }, measured: { width: 100, height: 40 }, band: "group:t1" },
      { id: "b", type: "step", position: { x: 0, y: 300 }, measured: { width: 100, height: 40 }, band: "group:t2" },
    ];
    const out = fitBandsToMembers(nodes, bandOf);
    expect(out[0].position.y).toBe(0 - BAND_PADDING.top);
    expect(out[1].position.y).toBe(300 - BAND_PADDING.top);
  });
});

describe("toAbsoluteLayout", () => {
  it("帯の子の相対座標に帯の位置を足す。帯と帯の外のノードはそのまま", () => {
    const positions = new Map([
      ["group:t1", { x: 10, y: 20, width: 300, height: 100 }],
      ["a", { x: 16, y: 40 }],
      ["out", { x: 500, y: 500 }],
    ]);
    const parentOf = (id: string) => (id === "a" ? "group:t1" : null);
    const abs = toAbsoluteLayout(positions, parentOf);
    expect(abs.get("a")).toEqual({ x: 26, y: 60 });
    expect(abs.get("group:t1")).toEqual({ x: 10, y: 20, width: 300, height: 100 });
    expect(abs.get("out")).toEqual({ x: 500, y: 500 });
  });
});
