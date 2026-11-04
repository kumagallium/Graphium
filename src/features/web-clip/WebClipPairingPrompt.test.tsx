// @vitest-environment jsdom
// 拡張機能からの接続の申し込み: 番号を出し、許可・許可しない・閉じる（＝許可しない）を sidecar へ返す

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../i18n";
import { WebClipPairingPrompt } from "./WebClipPairingPrompt";
import type { ClipPairRequest } from "./api";

afterEach(() => cleanup());

const REQ: ClipPairRequest = {
  id: "r1",
  number: "0427",
  extensionId: "abcdefghijklmnopabcdefghijklmnop",
  requestedAt: "2026-11-04T00:00:00.000Z",
};

describe("WebClipPairingPrompt", () => {
  syncLocale("ja");

  const open = (requests: ClipPairRequest[] | null = [REQ]) => {
    const decide = vi.fn(async () => {});
    render(
      <LocaleProvider>
        <WebClipPairingPrompt loadRequests={async () => requests} decide={decide} />
      </LocaleProvider>,
    );
    return decide;
  };

  it("申し込みが無ければ何も出さない", async () => {
    open([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("web-clip-pair-number")).toBeNull();
  });

  it("番号を出し、許可すると approve=true を返して閉じる", async () => {
    const decide = open();
    expect((await screen.findByTestId("web-clip-pair-number")).textContent).toBe("0427");
    fireEvent.click(screen.getByRole("button", { name: t("webClip.pair.approve") }));
    expect(decide).toHaveBeenCalledWith("r1", true);
    await waitFor(() => expect(screen.queryByTestId("web-clip-pair-number")).toBeNull());
  });

  it("許可しない・Esc はどちらも approve=false", async () => {
    const decide = open();
    await screen.findByTestId("web-clip-pair-number");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(decide).toHaveBeenCalledWith("r1", false);
  });

  it("sidecar が無い（null）ときは何も出さない", async () => {
    open(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("web-clip-pair-number")).toBeNull();
  });
});
