// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { TableSource } from "../../lib/document-types";

vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("./linked-import", () => ({
  linkedSnapshotOf: () => ({ size: 1, mtimeMs: 2 }),
  isLinkedSourceChanged: vi.fn(async () => true),
}));

import { LinkedSourceChangedNote } from "./LinkedSourceChangedNote";

const source = { fileId: "f", fileName: "a.csv" } as unknown as TableSource;

describe("LinkedSourceChangedNote の配置", () => {
  it("line は題の行と別の div、inline は行の中の span で、どちらも縮んで省略される", async () => {
    const { unmount } = render(<LinkedSourceChangedNote source={source} layout="line" />);
    const line = await waitFor(() => screen.getByTestId("linked-source-changed"));
    expect(line.tagName).toBe("DIV");
    expect(line.getAttribute("data-layout")).toBe("line");
    expect(line.style.textOverflow).toBe("ellipsis");
    unmount();
    render(<LinkedSourceChangedNote source={source} />);
    const inline = await waitFor(() => screen.getByTestId("linked-source-changed"));
    expect(inline.tagName).toBe("SPAN");
    expect(inline.style.minWidth).toBe("0px");
    expect(inline.style.overflow).toBe("hidden");
  });
});
