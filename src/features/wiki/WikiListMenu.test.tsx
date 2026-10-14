// @vitest-environment jsdom
// 一覧の「…」メニュー — 項目の出し分け・Esc で閉じる・busy 時の無効化
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { WikiListMenu, type WikiListMenuProps } from "./WikiListMenu";

afterEach(cleanup);

const setup = (props: WikiListMenuProps) =>
  render(
    <LocaleProvider>
      <WikiListMenu {...props} />
    </LocaleProvider>,
  );
const trigger = () => screen.getByRole("button", { expanded: false });

describe("WikiListMenu", () => {
  it("項目が無いときは何も出さない", () => {
    const { container } = setup({});
    expect(container.querySelector("button")).toBeNull();
  });
  it("渡した項目だけが並ぶ", () => {
    setup({ onFrameBackfill: () => {} });
    fireEvent.click(trigger());
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });
  it("項目を選ぶと呼ばれてメニューが閉じる", () => {
    const onAsterismExport = vi.fn();
    setup({ onFrameBackfill: () => {}, onShowLastBackfillResult: () => {}, onAsterismExport });
    fireEvent.click(trigger());
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("menuitem")[2]);
    expect(onAsterismExport).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("Esc で閉じる", () => {
    setup({ onFrameBackfill: () => {} });
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("実行中は付け直しの項目が無効", () => {
    setup({ onFrameBackfill: () => {}, frameBackfillBusy: true });
    fireEvent.click(trigger());
    expect((screen.getByRole("menuitem") as HTMLButtonElement).disabled).toBe(true);
  });
});
