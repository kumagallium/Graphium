import { describe, expect, it, vi } from "vitest";
import { buildMixdownGraph, MIXDOWN_GAIN } from "./mixdown-playback";

const node = () => ({ connect: vi.fn(), gain: { value: 1 } });

describe("buildMixdownGraph", () => {
  it("L と R を半分の音量で両方の出力チャンネルへ送り、destination につなぐ", () => {
    const splitter = node();
    const merger = node();
    const gains = [node(), node()];
    const ctx = {
      destination: { id: "dest" },
      createChannelSplitter: vi.fn(() => splitter),
      createChannelMerger: vi.fn(() => merger),
      createGain: vi.fn().mockReturnValueOnce(gains[0]).mockReturnValueOnce(gains[1]),
    };
    const source = node();
    buildMixdownGraph(ctx, source);
    expect(ctx.createChannelSplitter).toHaveBeenCalledWith(2);
    expect(ctx.createChannelMerger).toHaveBeenCalledWith(2);
    expect(gains[0].gain.value).toBe(MIXDOWN_GAIN);
    expect(gains[1].gain.value).toBe(MIXDOWN_GAIN);
    expect(source.connect).toHaveBeenCalledWith(splitter);
    expect(splitter.connect).toHaveBeenCalledWith(gains[0], 0);
    expect(splitter.connect).toHaveBeenCalledWith(gains[1], 1);
    for (const g of gains) {
      expect(g.connect).toHaveBeenCalledWith(merger, 0, 0);
      expect(g.connect).toHaveBeenCalledWith(merger, 0, 1);
    }
    expect(merger.connect).toHaveBeenCalledWith(ctx.destination);
  });
});
