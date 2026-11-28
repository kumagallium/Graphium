// @vitest-environment jsdom
// 新しい版の知らせの帯。読み込み直しは利用者のタップでだけ起きる。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UpdateReadyBanner } from "./UpdateReadyBanner";
import { LocaleProvider } from "../../i18n";

afterEach(() => cleanup());

describe("UpdateReadyBanner", () => {
  it("announces the new version and reloads only on tap", () => {
    const onReload = vi.fn();
    render(
      <LocaleProvider>
        <UpdateReadyBanner onReload={onReload} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("A new version is ready");
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
