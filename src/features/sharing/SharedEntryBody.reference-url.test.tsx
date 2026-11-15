// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-pdf", () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock("../../lib/pdfjs-config", () => ({}));
import { SharedEntryBody } from "./SharedEntryBody";

const entry = (url: string) =>
  ({ type: "reference", extra: { url, description: "d" } }) as never;

describe("共有フォルダの reference エントリの URL（監査 #37）", () => {
  it("javascript: はリンクの href に載らない", () => {
    const html = renderToStaticMarkup(
      <SharedEntryBody entry={entry("javascript:alert(1)")} body="" bodyError={null} />,
    );
    expect(html).not.toMatch(/href="javascript/i);
  });

  it("https は href になる", () => {
    const html = renderToStaticMarkup(
      <SharedEntryBody entry={entry("https://example.com/a")} body="" bodyError={null} />,
    );
    expect(html).toContain('href="https://example.com/a"');
  });
});
