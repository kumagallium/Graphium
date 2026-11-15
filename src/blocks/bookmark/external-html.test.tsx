import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookmarkExternalHTML } from "./view";

describe("BookmarkExternalHTML の href（監査 #37）", () => {
  const render = (url: string) =>
    renderToStaticMarkup(
      <BookmarkExternalHTML block={{ props: { url, title: "t", description: "" } } as never} />,
    );
  it("javascript: は href にしない", () => {
    expect(render("javascript:alert(1)")).not.toMatch(/href=/);
  });
  it("https は href に残る", () => {
    expect(render("https://example.com/")).toContain('href="https://example.com/"');
  });
});
