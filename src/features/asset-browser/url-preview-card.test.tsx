// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UrlPreviewCard } from "./url-preview-card";
import type { MediaIndexEntry } from "./media-index";

vi.mock("./preview-image", () => ({ usePreviewImage: () => undefined }));
vi.mock("./favicon", () => ({ Favicon: () => null }));
vi.mock("../../i18n", () => ({ useT: () => (k: string) => k }));

function entry(url: string): MediaIndexEntry {
  return { name: "n", url, urlMeta: { domain: "example.com" } } as unknown as MediaIndexEntry;
}

describe("UrlPreviewCard の「開く」", () => {
  it("javascript: の url では出ない", () => {
    render(<UrlPreviewCard entry={entry("javascript:alert(1)")} />);
    expect(screen.queryByText("asset.urlOpen")).toBeNull();
  });
  it("http(s) では出る", () => {
    render(<UrlPreviewCard entry={entry("https://example.com/a")} />);
    const a = screen.getByText("asset.urlOpen").closest("a");
    expect(a?.getAttribute("href")).toBe("https://example.com/a");
  });
});
