import { describe, expect, it } from "vitest";
import { escapeHtml } from "../../lib/escape-html";
import { crossPanelTooltipFormatter, safeMarkerColor, stackTooltipFormatter, timeTooltipFormatter } from "./tooltip-formatters";

const EVIL = `<img src=x onerror=alert(1)>`;

describe("チャートのツールチップは差し込む値を HTML エスケープする", () => {
  it("escapeHtml は < > & ' \" を実体参照にする", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("時間軸: 系列名と値", () => {
    const f = timeTooltipFormatter("en" as never);
    const html = f([{ seriesName: EVIL, value: [0, EVIL], marker: "<span>m</span>" }]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    // ECharts の p.marker は色をそのまま差すので使わず、検査済みの丸印を自前で出す
    expect(html).not.toContain("<span>m</span>");
    expect(html).toContain("border-radius:50%");
  });

  it("スタック: 系列名と軸の値", () => {
    const f = stackTooltipFormatter("en" as never, "category" as XAxisKindT, [null, {} as never]);
    const html = f([{ seriesIndex: 1, seriesName: EVIL, axisValue: EVIL, value: 1 }]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("枠連結: 系列名・軸の値・色", () => {
    const f = crossPanelTooltipFormatter(
      "en" as never,
      "category" as XAxisKindT,
      [{ column: 0, name: EVIL, color: `red"><img src=x onerror=1>`, points: [[0, 1]], source: {} as never }],
      new Map([[0, 0]]),
    );
    const html = f([{ seriesIndex: 0, axisValue: EVIL, value: [0, 1] }]);
    expect(html).not.toContain("<img");
  });
});

describe("ツールチップの丸印の色（CSS 注入）", () => {
  const EVIL_COLOR = "red;position:fixed;inset:0;width:100vw;height:100vh;background-image:url(https://t.example/x)";
  it("安全な色だけ通し、宣言を足せる文字列は既定色に落とす", () => {
    expect(safeMarkerColor("#1f77b4")).toBe("#1f77b4");
    expect(safeMarkerColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(safeMarkerColor("hsla(120, 50%, 50%, 0.5)")).toBe("hsla(120, 50%, 50%, 0.5)");
    expect(safeMarkerColor("steelblue")).toBe("steelblue");
    expect(safeMarkerColor(EVIL_COLOR)).toBe("#888888");
    expect(safeMarkerColor("red;position:fixed")).toBe("#888888");
    expect(safeMarkerColor({ type: "linear" })).toBe("#888888");
  });
  it("3 つの formatter とも色の宣言注入が出力に残らない", () => {
    const a = timeTooltipFormatter("en" as never)([{ seriesName: "s", value: [0, 1], color: EVIL_COLOR }]);
    const b = stackTooltipFormatter("en" as never, "category" as XAxisKindT, [{} as never])([
      { seriesIndex: 0, seriesName: "s", axisValue: "x", value: 1, color: EVIL_COLOR },
    ]);
    const c = crossPanelTooltipFormatter(
      "en" as never,
      "category" as XAxisKindT,
      [{ column: 0, name: "s", color: EVIL_COLOR, points: [[0, 1]], source: {} as never }],
      new Map([[0, 0]]),
    )([{ seriesIndex: 0, axisValue: "x", value: [0, 1] }]);
    for (const html of [a, b, c]) {
      expect(html).not.toContain("position:fixed");
      expect(html).not.toContain("url(");
    }
  });
});

type XAxisKindT = Parameters<typeof stackTooltipFormatter>[1];
