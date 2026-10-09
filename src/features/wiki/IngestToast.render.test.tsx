// @vitest-environment jsdom
// 件数に数えない項目（補完など）だけのときの IngestToast の見出し・ピル・エラー表示のテスト。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { IngestToast, type IngestToastItem } from "./IngestToast";
import { LocaleProvider, t } from "../../i18n";
import type { ReactElement } from "react";

afterEach(cleanup);

const renderToast = (ui: ReactElement) => render(<LocaleProvider>{ui}</LocaleProvider>);

const base: IngestToastItem = { id: "bf", status: "generating", noteTitle: "補完タイトル", excludeFromCount: true };

function minimize() {
  fireEvent.click(screen.getByLabelText(t("ingest.minimize")));
}

describe("IngestToast（件数に数えない項目だけ）", () => {
  it("展開表示の見出しは項目のタイトルになる", () => {
    renderToast(<IngestToast state={{ items: [base] }} onDismiss={() => {}} />);
    expect(screen.getAllByText("補完タイトル").length).toBeGreaterThan(0);
  });

  it("実行中のピルは 0/0 ではなくタイトルを出す", () => {
    const { container } = renderToast(<IngestToast state={{ items: [base] }} onDismiss={() => {}} />);
    minimize();
    expect(container.textContent).not.toContain("0/0");
    expect(container.textContent).toContain("補完タイトル");
  });

  it("エラーで終わったときのピルはエラーアイコン（チェックではない）で赤系", () => {
    const { container } = renderToast(
      <IngestToast state={{ items: [{ ...base, status: "error", result: "boom" }] }} onDismiss={() => {}} />,
    );
    minimize();
    expect(container.querySelector("button")?.className).toContain("destructive");
    expect(container.querySelector("svg.text-destructive")).not.toBeNull();
    expect(container.querySelector("svg.text-emerald-600")).toBeNull();
  });

  it("success の action ボタンを押せる", () => {
    const onClick = vi.fn();
    renderToast(
      <IngestToast
        state={{ items: [{ ...base, status: "success", action: { label: "詳細", onClick } }] }}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("詳細"));
    expect(onClick).toHaveBeenCalled();
  });
});
