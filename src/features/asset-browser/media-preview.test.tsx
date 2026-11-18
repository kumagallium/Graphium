// @vitest-environment jsdom
// MediaPreview の url 分岐。控えが壊れた置き場の URL は、Web として取りに行かない（UrlReaderView を描かない）。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { MediaIndexEntry } from "./media-index";
import { buildPlaceUrl } from "../linked-files/link-url";

vi.mock("./PdfViewer", () => ({ PdfViewer: () => null }));
vi.mock("./UrlReaderView", () => ({ UrlReaderView: () => <div data-testid="url-reader" /> }));
vi.mock("../linked-files/LinkedFileView", () => ({ LinkedFileView: () => <div data-testid="linked-view" /> }));

import { MediaPreview } from "./media-preview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => cleanup());

function entry(over: Partial<MediaIndexEntry>): MediaIndexEntry {
  return {
    fileId: "u1",
    name: "a.xlsx",
    type: "url",
    mimeType: "text/x-uri",
    url: buildPlaceUrl("p1", "a.xlsx"),
    thumbnailUrl: "",
    uploadedAt: "2026-11-18T00:00:00.000Z",
    usedIn: [],
    ...over,
  };
}
const renderIt = (e: MediaIndexEntry) =>
  render(
    <LocaleProvider>
      <MediaPreview entry={e} />
    </LocaleProvider>,
  );

describe("MediaPreview url 分岐", () => {
  it("控えが壊れた置き場の URL: UrlReaderView も LinkedFileView も描かず、読めない旨を出す", () => {
    renderIt(entry({ link: {} as never }));
    expect(screen.queryByTestId("url-reader")).toBeNull();
    expect(screen.queryByTestId("linked-view")).toBeNull();
    expect(screen.getByTestId("broken-link-notice")).toBeTruthy();
  });

  it("控えが正しければ LinkedFileView", () => {
    renderIt(
      entry({ link: { placeId: "p1", relPath: "a.xlsx", size: 1, mtimeMs: 1, recordedAt: "x" } }),
    );
    expect(screen.getByTestId("linked-view")).toBeTruthy();
  });

  it("Web の URL は UrlReaderView", () => {
    renderIt(entry({ url: "https://example.com/" }));
    expect(screen.getByTestId("url-reader")).toBeTruthy();
  });
});
