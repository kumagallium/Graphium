// @vitest-environment jsdom
// まとめて共有モーダルのテスト。
//
// 対象の不変条件（§24）:
// - マウントしただけでは共有が走らない（確認画面が先。件数が出る）
// - チェックボックスの初期値は設定から来る
// - 切り替えると設定にも書き戻る（次回の既定になる）
// - 開始したときの値が bulkShare の deps にそのまま渡る
// - 途中でキャンセルしたら共有は始まらない
//
// bulkShare 本体は bulk-share.test.ts が押さえているので、ここではモックして
// 「何が渡されたか」だけを見る。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";

const bulkShareMock = vi.hoisted(() => vi.fn());

vi.mock("./bulk-share", () => ({
  bulkShare: bulkShareMock,
}));

import { BulkShareModal } from "./BulkShareModal";
import { LocaleProvider, t } from "../../i18n";
import {
  getShareIncludesPrivateHistory,
  setShareIncludesPrivateHistory,
} from "../../lib/storage/shared";
import type { BulkShareSummary, BulkShareTarget } from "./bulk-share";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const targets: BulkShareTarget[] = [
  { kind: "note", id: "n1" },
  { kind: "note", id: "n2" },
];

const emptySummary: BulkShareSummary = {
  shared: 0,
  updated: 0,
  failed: 0,
  cancelled: false,
  results: [],
};

/** 共有に必要な deps のダミー（モックした bulkShare は中身を使わない） */
const deps = {
  root: "/shared",
  author: { name: "Ada", email: "a@b.co" },
  loadNote: async () => null,
  saveNote: async () => {},
  loadKnowledge: async () => null,
  saveKnowledge: async () => {},
  loadMedia: () => null,
  saveMediaSharedRef: async () => {},
} as unknown as React.ComponentProps<typeof BulkShareModal>["deps"];

function renderModal(onClose = () => {}, list: BulkShareTarget[] = targets) {
  return render(
    <LocaleProvider>
      <BulkShareModal targets={list} deps={deps} onClose={onClose} />
    </LocaleProvider>,
  );
}

/** 表示テキストでボタンを引く */
function button(container: HTMLElement, label: string): HTMLButtonElement {
  const hit = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!hit) throw new Error(`ボタンが見つかりません: ${label}`);
  return hit as HTMLButtonElement;
}

function checkbox(container: HTMLElement): HTMLInputElement {
  const hit = container.querySelector('input[type="checkbox"]');
  if (!hit) throw new Error("チェックボックスが見つかりません");
  return hit as HTMLInputElement;
}

describe("BulkShareModal — 開始前の確認画面", () => {
  beforeEach(() => {
    localStorage.clear();
    bulkShareMock.mockReset();
    bulkShareMock.mockResolvedValue(emptySummary);
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("マウントしただけでは共有を始めず、対象件数を出す", () => {
    const { container } = renderModal();
    expect(bulkShareMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      t("share.bulk.confirmIntro", { count: "2" }),
    );
    // 開始ボタンがある
    expect(button(container, t("share.bulk.start"))).toBeTruthy();
  });

  it("チェックボックスの初期値は設定から来る（既定はオフ）", () => {
    const { container } = renderModal();
    expect(checkbox(container).checked).toBe(false);
    cleanup();

    setShareIncludesPrivateHistory(true);
    const second = renderModal();
    expect(checkbox(second.container).checked).toBe(true);
  });

  it("チェックを付けると設定にも書き戻る（次回の既定になる）", () => {
    const { container } = renderModal();
    expect(getShareIncludesPrivateHistory()).toBe(false);

    fireEvent.click(checkbox(container));

    expect(checkbox(container).checked).toBe(true);
    expect(getShareIncludesPrivateHistory()).toBe(true);
  });

  it("既定のまま開始すると includePrivateHistory: false で共有する", async () => {
    const { container } = renderModal();
    await act(async () => {
      fireEvent.click(button(container, t("share.bulk.start")));
    });

    expect(bulkShareMock).toHaveBeenCalledTimes(1);
    const [passedTargets, passedDeps] = bulkShareMock.mock.calls[0];
    expect(passedTargets).toEqual(targets);
    expect(passedDeps.includePrivateHistory).toBe(false);
  });

  it("チェックを付けて開始すると includePrivateHistory: true で共有する", async () => {
    const { container } = renderModal();
    fireEvent.click(checkbox(container));
    await act(async () => {
      fireEvent.click(button(container, t("share.bulk.start")));
    });

    expect(bulkShareMock).toHaveBeenCalledTimes(1);
    expect(bulkShareMock.mock.calls[0][1].includePrivateHistory).toBe(true);
  });

  it("素材だけの選択ではチェックボックスを出さない（chats も来歴も無いので）", () => {
    const { container } = renderModal(() => {}, [
      { kind: "media", id: "m1" },
      { kind: "media", id: "m2" },
    ]);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(button(container, t("share.bulk.start"))).toBeTruthy();
  });

  it("確認画面でキャンセルすると共有せずに閉じる", () => {
    const onClose = vi.fn();
    const { container } = renderModal(onClose);
    fireEvent.click(button(container, t("common.cancel")));

    expect(bulkShareMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("開始後は確認画面に戻らず、完了サマリまで進む", async () => {
    bulkShareMock.mockResolvedValue({
      ...emptySummary,
      shared: 2,
    } satisfies BulkShareSummary);
    const { container } = renderModal();
    await act(async () => {
      fireEvent.click(button(container, t("share.bulk.start")));
    });

    expect(container.textContent).toContain(
      t("share.bulk.summary", { shared: "2", updated: "0", failed: "0" }),
    );
    expect(button(container, t("common.close"))).toBeTruthy();
  });
});
