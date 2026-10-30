// @vitest-environment jsdom
// 設定 › 使用量タブのテスト。
//
// GET /api/usage の応答を受け取り口で揃えていることの回帰防止。raw / summary が
// 配列でない 200（Storybook の API スタブが `{}` を返していた）を受けると、以前は
// 集計の `for (const ev of raw)` が描画中に `raw is not iterable` で落ちていた。
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { UsageTab } from "./UsageTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubUsageResponse(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
}

function renderTab() {
  return render(
    <LocaleProvider>
      <UsageTab />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("UsageTab", () => {
  it("raw / summary を欠いた応答でも落ちずに「記録なし」を出す", async () => {
    stubUsageResponse({});
    renderTab();
    expect(await screen.findByText("No AI calls recorded in this range yet.")).toBeTruthy();
  });

  it("raw / summary が配列でない応答でも落ちずに「記録なし」を出す", async () => {
    stubUsageResponse({ raw: null, summary: "oops", mode: "node" });
    renderTab();
    expect(await screen.findByText("No AI calls recorded in this range yet.")).toBeTruthy();
  });

  it("記録があれば合計に反映する", async () => {
    stubUsageResponse({
      raw: [
        {
          ts: new Date().toISOString(),
          feature: "agent.chat",
          provider: "anthropic",
          modelId: "claude-sonnet-5",
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          cost: 0.5,
          costCurrency: "usd",
        },
      ],
      summary: [],
      mode: "node",
    });
    renderTab();
    // 合計と機能別の行の両方に出る
    expect((await screen.findAllByText("1.5K")).length).toBeGreaterThan(0);
    expect(screen.queryByText("No AI calls recorded in this range yet.")).toBeNull();
  });

  // 月表示の横軸は「今日」から 1 か月ずつ戻して 12 本切る。月末の日付のまま戻すと
  // 存在しない日（2/30 など）が翌月に溢れ、同じ月が 2 本並んで前の月が欠けていた。
  it.each([
    ["2026-10-30T12:00:00Z", "25-11", "26-10"],
    ["2026-03-31T12:00:00Z", "25-04", "26-03"],
  ])("月表示の 12 本は月末（%s）でも重複・欠けなく並ぶ", async (now, first, last) => {
    vi.useFakeTimers({ now: new Date(now), toFake: ["Date"] });
    // 記録が 1 件も無いとグラフ自体を出さないので、今日の分を 1 件入れる
    stubUsageResponse({
      raw: [
        {
          ts: now,
          feature: "agent.chat",
          provider: "anthropic",
          modelId: "claude-sonnet-5",
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
        },
      ],
      summary: [],
      mode: "node",
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Month" }));
    const labels = screen
      .getAllByText(/^\d{2}-\d{2}$/)
      .map((el) => el.textContent);
    expect(labels).toHaveLength(12);
    expect(new Set(labels).size).toBe(12);
    expect(labels[0]).toBe(first);
    expect(labels[11]).toBe(last);
  });
});
