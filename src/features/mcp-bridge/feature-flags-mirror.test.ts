// feature-flags の写しのテスト（変更時だけ書く・書けない provider は何もしない・失敗しても止まらない）
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { claims: true, insights: true };
vi.mock("../settings/store", () => ({
  isClaimsEnabled: () => state.claims,
  isAtomLayerEnabled: () => state.claims && state.insights,
  SETTINGS_SAVED_EVENT: "graphium:settings-saved",
}));

import { writeFeatureFlagsIfChanged } from "./feature-flags-mirror";

describe("writeFeatureFlagsIfChanged", () => {
  beforeEach(() => {
    state.claims = true;
    state.insights = true;
  });

  it("初回は書き、同じ値なら書き直さない", async () => {
    const writeAppData = vi.fn(async () => {});
    const last = { current: null };
    expect(await writeFeatureFlagsIfChanged({ writeAppData }, last, () => "T1")).toBe(true);
    expect(writeAppData).toHaveBeenCalledWith("feature-flags", { claims: true, insights: true, updatedAt: "T1" });
    expect(await writeFeatureFlagsIfChanged({ writeAppData }, last, () => "T2")).toBe(false);
    expect(writeAppData).toHaveBeenCalledTimes(1);
  });

  it("値が変わったら書く。知見 OFF なら洞察も false", async () => {
    const writeAppData = vi.fn(async () => {});
    const last = { current: null };
    await writeFeatureFlagsIfChanged({ writeAppData }, last, () => "T1");
    state.claims = false;
    expect(await writeFeatureFlagsIfChanged({ writeAppData }, last, () => "T2")).toBe(true);
    expect(writeAppData).toHaveBeenLastCalledWith("feature-flags", { claims: false, insights: false, updatedAt: "T2" });
  });

  it("writeAppData が無い provider では何もしない", async () => {
    expect(await writeFeatureFlagsIfChanged({}, { current: null })).toBe(false);
    expect(await writeFeatureFlagsIfChanged(null, { current: null })).toBe(false);
  });

  it("書き込みに失敗しても投げず、次回また書く", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeAppData = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    const last = { current: null };
    expect(await writeFeatureFlagsIfChanged({ writeAppData }, last)).toBe(false);
    expect(await writeFeatureFlagsIfChanged({ writeAppData }, last)).toBe(true);
    warn.mockRestore();
  });
});
