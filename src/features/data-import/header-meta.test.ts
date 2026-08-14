import { describe, it, expect } from "vitest";
import { extractHeaderMeta } from "./header-meta";

describe("extractHeaderMeta", () => {
  it("コメント記号付きの key: value を拾う", () => {
    const entries = extractHeaderMeta([
      "# [INSTRUMENT SETTINGS & METADATA]",
      "# Device Model: ENV-MONITOR-X9",
      "# Location: Site B (地点B)",
      "# Sampling Interval: 1 Day",
      "# --------------------------",
      "# [DATA START]",
    ]);
    expect(entries).toEqual([
      { key: "Device Model", value: "ENV-MONITOR-X9" },
      { key: "Location", value: "Site B (地点B)" },
      { key: "Sampling Interval", value: "1 Day" },
    ]);
  });

  it("key = value 形式も拾う", () => {
    expect(extractHeaderMeta(["; GAIN = 2.5"])).toEqual([{ key: "GAIN", value: "2.5" }]);
  });

  it("区切り線と空行は無視する", () => {
    expect(extractHeaderMeta(["=====", "   ", "*****"])).toEqual([]);
  });

  it("キーが長すぎる行は説明文とみなして拾わない", () => {
    const long = "この行は測定条件ではなく注意書きの長い説明が延々と続くもので".repeat(2);
    expect(extractHeaderMeta([`# ${long}: 値`])).toEqual([]);
  });

  it("値が空の行は拾わない", () => {
    expect(extractHeaderMeta(["# Operator:"])).toEqual([]);
  });
});
