// @vitest-environment jsdom
// 設定 → 点検・整理「資料からトピックを作る」のカード。文言は既定の en で照合する。
// - 対象が無ければ何も出さない
// - 本数と、飛ばす本数を先に見せる
// - 確かめの窓で断れば走らせない。受ければ走らせ、結果の行を出す
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { __setConfirmResponderForTest } from "../../ui/confirm-dialog";
import { SourceTopicBackfillCard, type SourceTopicBackfillHandlers } from "./SourceTopicBackfillCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  __setConfirmResponderForTest(null);
});

function setup(sources: number, alreadySettled = 0) {
  let left = sources;
  const handlers: SourceTopicBackfillHandlers = {
    plan: vi.fn(async () => ({ sources: left, alreadySettled })),
    run: vi.fn(async (onProgress) => {
      onProgress({ done: 1, total: left, topicsTouched: 2 });
      const total = left;
      left = 0;
      return {
        done: total, total, topicsTouched: 3, created: 2, noTopic: 1, unreadable: 0,
        failedSources: 0, aborted: false, stoppedByFailures: false,
      };
    }),
  };
  const view = render(
    <LocaleProvider>
      <SourceTopicBackfillCard handlers={handlers} />
    </LocaleProvider>,
  );
  return { handlers, view };
}

describe("SourceTopicBackfillCard", () => {
  it("対象が無ければ何も出さない", async () => {
    const { handlers, view } = setup(0);
    await waitFor(() => expect(handlers.plan).toHaveBeenCalled());
    expect(view.container.textContent).toBe("");
  });

  it("本数と飛ばす本数を見せる", async () => {
    setup(291, 4);
    expect(await screen.findByText(/291 source\(s\) have Claims but no Topics yet/)).toBeTruthy();
    expect(screen.getByText(/4 source\(s\) with nothing to make a Topic of are skipped/)).toBeTruthy();
  });

  it("確かめの窓で断れば走らせない", async () => {
    const { handlers } = setup(2);
    __setConfirmResponderForTest(() => false);
    fireEvent.click(await screen.findByRole("button", { name: "Build Topics" }));
    await waitFor(() => expect(handlers.plan).toHaveBeenCalledTimes(2));
    expect(handlers.run).not.toHaveBeenCalled();
  });

  it("受ければ走らせて結果の行を出し、対象が無くなってもカードは結果ごと残る", async () => {
    const { handlers } = setup(2);
    const confirm = vi.fn(() => true);
    __setConfirmResponderForTest(confirm);
    fireEvent.click(await screen.findByRole("button", { name: "Build Topics" }));
    expect(await screen.findByText(/Done\. 3 Topic\(s\) created or updated from 2 source\(s\) \(2 new\)/)).toBeTruthy();
    expect(screen.getByText(/1 source\(s\) had nothing to make a Topic of/)).toBeTruthy();
    expect(handlers.run).toHaveBeenCalledTimes(1);
    expect(String((confirm.mock.calls[0] as unknown[])[0])).toContain("Build Topics from 2 source(s)?");
    // 対象が無くなったので、押す口は消える
    await waitFor(() => expect(screen.queryByRole("button", { name: "Build Topics" })).toBeNull());
  });
});
